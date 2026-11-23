/* Pocket Space offline shell.
 * RELEASE INVARIANT: every published HTML/JS/CSS change must bump VERSION here
 * AND the app's ?v= token together. Update SHELL_JS/CSS when adding a module.
 * Never reuse a cache version for different bytes. A waiting worker must only
 * replace an active one after the UI sends the explicit SKIP_WAITING message.
 */
'use strict';

const VERSION = 'pocket-ios-5';
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'pocket-space:' + encodeURIComponent(SCOPE.pathname) + ':';
const SHELL_CACHE = PREFIX + VERSION + ':shell';
const IMAGE_CACHE = PREFIX + VERSION + ':images';
const NAVIGATION_TIMEOUT = 3500;
const INSTALL_TIMEOUT = 20000;
const IMAGE_LIMIT = 96;
const SHELL_JS = ['app', 'audio', 'canvasRenderer', 'catalog', 'db', 'focusNote',
  'gameTime', 'notes', 'pwa', 'quests', 'state', 'timeline'].map(name => 'js/' + name + '.js');
const SHELL_CSS = ['style', 'components', 'modals', 'notes', 'pwa'].map(name => 'css/' + name + '.css');
const SHELL_FILES = ['index.html', 'manifest.webmanifest', ...SHELL_JS, ...SHELL_CSS,
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png'];
const OPTIONAL_IMAGES = ['assets/notes/ppa.png', 'assets/notes/tbv.png',
  'assets/sprites/ppa/ppa_home_idle_sheet.png', 'assets/sprites/tbv/tbv_home_idle_sheet.png',
  'assets/sprites/bonsai/bonsai_stage_01_healthy_strip.png', 'assets/sprites/bonsai/bonsai_stage_01_dry.png'];
const FIREBASE_MODULES = new Set(['firebase-app.js', 'firebase-firestore.js']
  .map(name => 'https://www.gstatic.com/firebasejs/10.14.1/' + name));
const shellPaths = new Set(SHELL_FILES.map(path => localURL(path).pathname));

function localURL(path) { return new URL(path, SCOPE); }
function inScope(url) { return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname); }
function appNavigation(url) {
  return inScope(url) && [SCOPE.pathname, localURL('index.html').pathname].includes(url.pathname);
}
function isFirebase(url) { return FIREBASE_MODULES.has(url.href); }
function isImage(url) {
  if (!inScope(url) || url.search) return false;
  const path = url.pathname.slice(SCOPE.pathname.length);
  return /^assets\/sprites\/(ppa|tbv|bonsai)\/[a-z0-9_-]+\.png$/.test(path)
    || /^assets\/quests\/(ppa|tbv)_quest_[a-z0-9_]+\.png$/.test(path)
    || ['assets/quests/quest_hug_5s.png', 'assets/quests/quest_tbv_kiss_ppa.png',
      'assets/quests/quest_ppa_kiss_tbv.png'].includes(path)
    || /^assets\/notes\/(ppa|tbv)\.png$/.test(path)
    || /^assets\/icons\/(icon\.svg|icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/.test(path);
}
function shellRequest(url) {
  return inScope(url) && shellPaths.has(url.pathname) && url.pathname !== localURL('index.html').pathname;
}
async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.status === 0) return response;
    // Drain the body while its deadline is active. Retaining many unread fetch
    // responses can stall browser connection slots before the atomic cache phase.
    const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
    const headers = new Headers(response.headers);
    // Fetch already decoded the bytes; do not describe the buffered body using
    // the network transfer's compressed encoding or content length.
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
  finally { clearTimeout(timer); }
}
function requestFor(url) {
  return new Request(url, { cache: 'reload', credentials: url.origin === SCOPE.origin ? 'same-origin' : 'omit',
    mode: url.origin === SCOPE.origin ? 'same-origin' : 'cors' });
}
function usable(response) { return response && response.ok && response.type !== 'opaque'; }
function executable(response, url) {
  if (!usable(response)) return false;
  const type = response.headers.get('content-type') || '';
  if (url.pathname.endsWith('.js')) return /(?:javascript|ecmascript)/i.test(type);
  if (url.pathname.endsWith('.css')) return /text\/css/i.test(type);
  if (url.pathname.endsWith('.html')) return /text\/html/i.test(type);
  return true;
}
function dependencies(body, url) {
  const found = [];
  const patterns = url.pathname.endsWith('.html')
    ? [/(?:src|href)\s*=\s*["']([^"']+)["']/g]
    : url.pathname.endsWith('.js')
      ? [/\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]
      : [/@import\s+(?:url\(\s*)?["']([^"']+)["']/g];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const item = new URL(match[1], url);
      if (!inScope(item)) continue;
      if (/\.(?:js|css)$/.test(item.pathname)) {
        // Fail installation for a missing manifest entry instead of installing
        // a shell that cannot boot without the network.
        if (!shellPaths.has(item.pathname)) throw new Error('Unlisted shell module: ' + item.pathname);
        found.push(item);
      }
    }
  }
  return found;
}

async function installShell() {
  const responses = new Map();
  const queued = new Map();
  for (const path of SHELL_FILES) {
    const url = localURL(path);
    queued.set(url.href, url);
    if (/\.(js|css)$/.test(path)) {
      const versioned = new URL(url);
      versioned.searchParams.set('v', VERSION);
      queued.set(versioned.href, versioned);
    }
  }
  for (const href of FIREBASE_MODULES) queued.set(href, new URL(href));
  // Build the complete import graph before publishing any cache. Imported query
  // strings are retained; v= is never ignored when choosing a script response.
  while (queued.size) {
    const batch = [...queued.values()];
    queued.clear();
    await Promise.all(batch.map(async url => {
      if (responses.has(url.href)) return;
      const response = await fetchWithTimeout(requestFor(url), INSTALL_TIMEOUT);
      if (!executable(response, url)) throw new Error('Offline shell unavailable: ' + url.href);
      responses.set(url.href, response);
      if (inScope(url) && /\.(html|js|css)$/.test(url.pathname)) {
        for (const dependency of dependencies(await response.clone().text(), url)) {
          if (!responses.has(dependency.href)) queued.set(dependency.href, dependency);
        }
      }
    }));
  }
  try {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all([...responses].map(([url, response]) => cache.put(url, response)));
  } catch (error) {
    // The unique version is not served until installation succeeds. A failed
    // install cannot touch the active release's cache.
    await caches.delete(SHELL_CACHE);
    throw error;
  }
}
async function warmImages() {
  const cache = await caches.open(IMAGE_CACHE);
  await Promise.all(OPTIONAL_IMAGES.map(async path => {
    try {
      const url = localURL(path), response = await fetchWithTimeout(requestFor(url), 7000);
      if (usable(response)) await cache.put(url.href, response);
    } catch { /* CanvasRenderer supplies a pixel fallback when art is absent. */ }
  }));
}
self.addEventListener('install', event => {
  event.waitUntil(installShell().then(() => warmImages().catch(() => {})));
  // Deliberately no skipWaiting(): existing tabs keep their installed release.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Explicit updates may leave another tab open on the previous release.
    // Keep its exact cached URLs until no app window is open.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some(client => inScope(new URL(client.url)))) return;
    await Promise.all((await caches.keys()).filter(name => name.startsWith(PREFIX)
      && ![SHELL_CACHE, IMAGE_CACHE].includes(name)).map(name => caches.delete(name)));
  })().catch(() => {}));
  // No clients.claim(): activation never swaps scripts into an existing tab.
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.ports?.[0]?.postMessage({ type: 'SKIP_WAITING_ACK', version: VERSION });
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'SW_VERSION', version: VERSION, scope: SCOPE.href });
  }
});

async function shellCaches() {
  const names = await caches.keys();
  return [SHELL_CACHE, ...names.filter(name => name.startsWith(PREFIX) && name.endsWith(':shell') && name !== SHELL_CACHE)];
}
async function cachedShellResource(request) {
  const names = await shellCaches();
  // Unversioned imports (audio/gameTime) inherit their versioned parent module's
  // cache, allowing an old tab to finish safely after an explicit update.
  if (request.referrer) {
    const parent = new URL(request.referrer);
    if (inScope(parent) && parent.searchParams.has('v') && /\.(js|css)$/.test(parent.pathname)) {
      for (const name of names) {
        const cache = await caches.open(name);
        if (await cache.match(parent.href)) {
          const response = await cache.match(request);
          if (response) return response;
          break;
        }
      }
    }
  }
  for (const name of names) {
    const response = await (await caches.open(name)).match(request);
    if (response) return response;
  }
  return null;
}
async function navigate(request, event) {
  let shell;
  try { shell = await (await caches.open(SHELL_CACHE)).match(localURL('index.html').href); }
  catch { /* Storage can be purged/disabled independently of network access. */ }
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT);
    if (usable(response) && /text\/html/i.test(response.headers.get('content-type') || '')) {
      if (!shell || await response.clone().text() === await shell.clone().text()) return response;
      // A newer HTML document must wait for its complete matching JS/CSS release.
      // Runtime navigation never overwrites the immutable installed shell.
      event.waitUntil(self.registration.update().catch(() => {}));
      return shell;
    }
  } catch { /* Timeout/offline: use the installed coherent app shell. */ }
  return shell || new Response('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Space</title><body style="background:#F4F8F3;color:#2D4A34;font:18px system-ui;padding:24px"><p>Kết nối mạng và mở lại Pocket Space để tải bản ngoại tuyến.</p></body></html>',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
async function imageResponse(request, event) {
  let cache, cached;
  try { cache = await caches.open(IMAGE_CACHE); cached = await cache.match(request); }
  catch { return fetch(request); }
  if (cached) return cached;
  const response = await fetch(request);
  if (usable(response)) {
    event.waitUntil((async () => {
      try {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT)).map(key => cache.delete(key)));
      } catch { /* Art caching is optional; storage failure must not break display. */ }
    })());
  }
  return response;
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && appNavigation(url)) {
    event.respondWith(navigate(request, event));
  } else if (isFirebase(url) || shellRequest(url)) {
    event.respondWith(cachedShellResource(request).catch(() => null).then(response => response || fetch(request)));
  } else if (isImage(url)) {
    event.respondWith(imageResponse(request, event));
  }
  // No catch-all: Firestore, emulator requests, APIs, messages, authentication,
  // analytics and every other non-whitelisted URL go directly to the network.
});
