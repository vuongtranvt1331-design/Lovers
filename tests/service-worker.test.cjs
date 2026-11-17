const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Execute the actual worker with in-memory browser APIs; no server or network.
const app = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(app, 'sw.js'), 'utf8');
const mime = name => name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css'
  : name.endsWith('.html') ? 'text/html' : name.endsWith('.webmanifest') ? 'application/manifest+json'
    : name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
const urlKey = request => typeof request === 'string' ? request : request.url ?? request.href;

function fixture(scope) {
  const stores = new Map(), handlers = new Map(), network = [], state = { offline: false, windows: [], skip: 0, updates: 0 };
  const scopeURL = new URL(scope);
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (state.failImageCache && name.endsWith(':images')) throw new Error('Storage blocked');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(urlKey(request))?.clone(); },
        async put(request, response) {
          if (state.failPut && name.includes(':' + state.version + ':')) throw new Error('Quota');
          store.set(urlKey(request), response.clone());
        },
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async delete(request) { return store.delete(urlKey(request)); },
      };
    },
  };
  async function fetch(request, options = {}) {
    const url = new URL(urlKey(request));
    network.push(url.href);
    if (state.offline) throw new Error('Offline');
    if (state.hangBody) return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => {
          state.bodyAborts = (state.bodyAborts ?? 0) + 1;
          controller.error(Object.assign(new Error('Body download aborted'), { name: 'AbortError' }));
        }, { once: true });
      },
    }), { headers: { 'content-type': 'text/javascript' } });
    if (state.emptyStatus) return new Response(null, { status: state.emptyStatus });
    if (state.decodedBody) return new Response(state.decodedBody, { headers: {
      'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': '999',
    } });
    if (url.pathname.endsWith(state.failPath ?? '\u0000')) return new Response('Unavailable', { status: 503 });
    if (url.origin === 'https://www.gstatic.com') return new Response('export const cachedSDK = true;', { headers: { 'content-type': 'text/javascript' } });
    assert.equal(url.origin, scopeURL.origin);
    assert.ok(url.pathname.startsWith(scopeURL.pathname), 'scope never escapes into another project');
    let name = url.pathname.slice(scopeURL.pathname.length) || 'index.html';
    if (name === 'index.html' && state.nextHTML) return new Response(state.nextHTML, { headers: { 'content-type': 'text/html' } });
    const file = path.join(app, name);
    const body = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!body) return new Response('Missing', { status: 404 });
    return new Response(body, { headers: { 'content-type': mime(name) } });
  }
  const self = {
    registration: { scope, async update() { state.updates++; } },
    clients: { async matchAll() { return state.windows; }, claim() { throw new Error('must not claim'); } },
    async skipWaiting() { state.skip++; }, addEventListener(name, handler) { handlers.set(name, handler); },
  };
  const env = { self, caches, fetch, Request, Response, URL, Headers, AbortController, setTimeout, clearTimeout, console };
  vm.createContext(env);
  vm.runInContext(source + '\nglobalThis.swTest={SHELL_CACHE,IMAGE_CACHE,PREFIX,VERSION,dependencies,fetchWithTimeout};', env);
  state.version = env.swTest.VERSION;
  async function event(type, extra = {}) {
    const promises = [];
    const item = { waitUntil(value) { promises.push(Promise.resolve(value)); }, ...extra };
    handlers.get(type)(item);
    await Promise.all(promises);
    return item;
  }
  async function request(url, extra = {}) {
    const pending = [];
    const item = { request: { url: new URL(url, scope).href, method: 'GET', mode: 'cors', headers: new Headers(), referrer: '', ...extra },
      waitUntil(value) { pending.push(Promise.resolve(value)); }, respondWith(value) { item.response = Promise.resolve(value); } };
    handlers.get('fetch')(item);
    const response = item.response ? await item.response : undefined;
    await Promise.all(pending);
    return response;
  }
  return { env, state, stores, caches, network, event, request, ...env.swTest };
}

for (const scope of ['https://example.test/Lovers/', 'http://127.0.0.1:8787/']) {
  test('offline shell, safe updates and data isolation at ' + scope, async () => {
    const f = fixture(scope);
    await f.event('install');
    assert.equal(f.state.skip, 0, 'install never skips waiting');
    const shell = f.stores.get(f.SHELL_CACHE);
    for (const directory of ['js', 'css']) {
      for (const name of fs.readdirSync(path.join(app, directory)).filter(name => name.endsWith('.' + directory))) {
        const url = new URL(directory + '/' + name, scope);
        assert.ok(shell.has(url.href), name + ' canonical module');
        url.searchParams.set('v', f.VERSION);
        assert.ok(shell.has(url.href), name + ' release-versioned module');
      }
    }
    for (const name of ['firebase-app.js', 'firebase-firestore.js']) assert.ok(shell.has('https://www.gstatic.com/firebasejs/10.14.1/' + name));
    f.state.offline = true;
    const html = await (await f.request('?emulator=1', { mode: 'navigate' })).text();
    assert.ok(html.includes('Pocket Space'));
    assert.ok((await (await f.request('js/audio.js')).text()).includes('AudioEngine'));
    assert.ok((await (await f.request('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')).text()).includes('cachedSDK'));
    assert.equal(f.state.skip, 0);

    f.state.offline = false;
    f.state.nextHTML = '<!doctype html><title>Different future release</title>';
    assert.equal(await (await f.request('./', { mode: 'navigate' })).text(), html);
    assert.equal(f.state.updates, 1);
    for (const name of ['quest_hug_5s.png', 'quest_tbv_kiss_ppa.png', 'quest_ppa_kiss_tbv.png']) {
      assert.ok((await f.request('assets/quests/' + name)).ok);
      assert.ok(f.stores.get(f.IMAGE_CACHE).has(new URL('assets/quests/' + name, scope).href));
      f.state.offline = true;
      assert.ok((await f.request('assets/quests/' + name)).ok, 'viewed pair quest works offline');
      f.state.offline = false;
    }
    const oldName = f.PREFIX + 'older:shell';
    const old = await f.caches.open(oldName);
    await old.put(new URL('js/app.js?v=older', scope).href, new Response('old app'));
    await old.put(new URL('js/audio.js', scope).href, new Response('old audio'));
    assert.equal(await (await f.request('js/audio.js', { referrer: new URL('js/app.js?v=older', scope).href })).text(), 'old audio');
    f.state.windows = [{ url: scope }];
    await f.event('activate');
    assert.ok(f.stores.has(oldName), 'open old tab keeps its cache');
    const messages = [];
    await f.event('message', { data: { type: 'SKIP_WAITING' }, ports: [{ postMessage(value) { messages.push(value); } }] });
    assert.equal(f.state.skip, 1); assert.equal(messages[0].type, 'SKIP_WAITING_ACK');

    for (const [url, extra] of [
      ['https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?database=x', {}],
      ['https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js', {}],
      ['https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js', {}],
      ['v1/projects/demo-pocket-space/databases/(default)/documents', {}],
      ['some-user-data.json', {}], ['FIREBASE-SETUP.md', { mode: 'navigate' }],
      ['js/app.js', { method: 'POST' }], ['assets/sprites/ppa/ppa_home_idle_sheet.png', { headers: new Headers({ Range: 'bytes=0-100' }) }],
    ]) assert.equal(await f.request(url, extra), undefined, 'must not intercept ' + url);
    f.state.failImageCache = true;
    assert.ok((await f.request('assets/sprites/ppa/ppa_home_idle_sheet.png')).ok, 'storage failure still fetches image');
    f.state.failImageCache = false;
    f.state.windows = [];
    await f.event('activate');
    assert.equal(f.stores.has(oldName), false);
    assert.ok(f.stores.has(f.SHELL_CACHE));
  });
}

test('failed mandatory shell download or cache write preserves the installed release', async () => {
  const bad = fixture('https://example.test/Lovers/');
  const oldName = bad.PREFIX + 'stable:shell';
  await (await bad.caches.open(oldName)).put('https://example.test/Lovers/index.html', new Response('stable'));
  bad.state.failPath = '/js/state.js';
  await assert.rejects(bad.event('install'));
  assert.equal(bad.stores.has(bad.SHELL_CACHE), false);
  assert.ok(bad.stores.has(oldName));
  bad.state.failPath = null;
  bad.state.failPut = true;
  await assert.rejects(bad.event('install'));
  assert.equal(bad.stores.has(bad.SHELL_CACHE), false);
  assert.ok(bad.stores.has(oldName));
});

test('optional image cache failure does not prevent shell installation', async () => {
  const optional = fixture('https://example.test/Lovers/');
  optional.state.failImageCache = true;
  await optional.event('install');
  assert.ok(optional.stores.has(optional.SHELL_CACHE));
});

test('fetch deadline stays active after headers until the full body is read', { timeout: 2000 }, async () => {
  const f = fixture('https://example.test/Lovers/');
  f.state.hangBody = true;
  await assert.rejects(f.fetchWithTimeout(new Request('https://example.test/Lovers/js/app.js'), 15), { name: 'AbortError' });
  assert.equal(f.state.bodyAborts, 1);
});

test('buffered responses remove stale transfer headers and preserve bodyless statuses', async () => {
  const f = fixture('https://example.test/Lovers/');
  const request = new Request('https://example.test/Lovers/js/app.js');
  f.state.decodedBody = 'export const ready = true;';
  const response = await f.fetchWithTimeout(request, 1000);
  assert.equal(await response.text(), f.state.decodedBody);
  assert.equal(response.headers.has('content-encoding'), false);
  assert.equal(response.headers.has('content-length'), false);
  f.state.decodedBody = null;
  for (const status of [204, 205, 304]) {
    f.state.emptyStatus = status;
    const empty = await f.fetchWithTimeout(request, 1000);
    assert.equal(empty.status, status);
    assert.equal(empty.body, null);
  }
});
