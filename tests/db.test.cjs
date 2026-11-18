const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

async function main() {
  const app = path.resolve(__dirname, '../js');
  const time = await import(pathToFileURL(path.join(app, 'gameTime.js')));
  const date = '2026-11-17', previous = time.offsetDay(date, -1), start = time.dateStart(date);
  const fixedNow = start + 12 * 3600000;
  const source = (await fs.readFile(path.join(app, 'db.js'), 'utf8'))
    .replace(/^import[^\n]+\n/, '').replace(/export /g, '');
  const env = { ...time, today: (epoch = fixedNow) => time.today(epoch), structuredClone, console, setTimeout, clearTimeout,
    navigator: { onLine: true }, addEventListener() {} };
  vm.createContext(env);
  vm.runInContext(source + '\ncontext=async()=>globalThis.client;serverReady=true;'
    + '\nglobalThis.test={historyDay,readHistorySnapshot,archiveNoteSource,noteSnapshot,openNoteDay};'
    + '\nglobalThis.api=PocketDB;', env);
  const asJSON = value => JSON.parse(JSON.stringify(value));
  let room = { users: {}, revision: 2, historyIndex: { [date]: 123456 } };
  const rows = [{ id: 'legitimate', user: 'ppa', activity: 'home_desk_work', dateStr: date,
    startTimestamp: start + 3600000, endTimestamp: start + 7200000, roomRevision: 2 },
    { id: 'wrong-day', user: 'ppa', activity: 'home_desk_work', dateStr: date,
      startTimestamp: start - 3600000, endTimestamp: start - 1, roomRevision: 2 },
    { id: 'bad-schema', user: 'ppa', activity: 'home_desk_work', dateStr: date,
      startTimestamp: 'bad', endTimestamp: start + 1, roomRevision: 2 }];
  let online = true;
  const snapshot = () => ({ data: () => structuredClone(room) });
  const queryRows = () => ({ docs: rows.map(row => ({ id: row.id, data: () => structuredClone(row) })) });
  env.client = { refs: { room: 'room', logs: 'logs' }, fs: {
    query: () => 'query', where() {},
    getDocFromServer: async () => { if (!online) throw { code: 'unavailable' }; return snapshot(); },
    getDocsFromServer: async () => { if (!online) throw { code: 'unavailable' }; return queryRows(); },
    getDocFromCache: async () => snapshot(), getDocsFromCache: async () => queryRows(),
  } };
  assert.deepEqual(asJSON((await env.test.historyDay(date)).logs.map(log => log.id)), ['legitimate']);
  online = false;
  assert.equal((await env.test.historyDay(date)).logs.length, 1);
  console.log('PASS poisoned historyIndex recovers online and certified offline; schema/day-invalid rows filtered');
  room.revision++;
  assert.equal((await env.test.historyDay(date)).logs.length, 1);
  room.historyIndex[date]++;
  await assert.rejects(env.test.historyDay(date), { code: 'history-not-cached' });
  room.historyIndex[date]--;
  rows.push({ ...rows[0], id: 'new-unconfirmed-row', roomRevision: room.revision });
  await assert.rejects(env.test.historyDay(date), { code: 'history-not-cached' });
  rows.pop();
  console.log('PASS unrelated room revision preserves certified offline history; changed day index or IDs require online confirmation');

  const task = text => ({ text, createdAt: start - 1000 });
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['source-' + i, task('Pending ' + i)]));
  const store = new Map([
    ['notes/ppa_' + previous, { owner: 'ppa', date: previous, pendingDay: previous, tasks: many, doneIds: [] }],
    ['notes/tbv_' + previous, { owner: 'tbv', date: previous, pendingDay: previous,
      tasks: { tbvPending: task('TBV pending') }, doneIds: [] }],
    ['notes/ppa_' + date, { owner: 'ppa', date, pendingDay: date,
      tasks: { todayPlan: task('Existing') }, doneIds: [] }],
  ]);
  let generatedId = 0;
  const fake = {
    doc: (collection, id) => id == null ? { id: 'generated-' + ++generatedId } : collection + '/' + id,
    serverTimestamp: () => 'server-time',
    runTransaction: async (_db, handler) => {
      const writes = [];
      const result = await handler({ get: async ref => ({ id: ref.split('/').at(-1), data: () => structuredClone(store.get(ref)) }),
        set: (ref, data) => writes.push([ref, structuredClone(data)]) });
      for (const [ref, data] of writes) store.set(ref, data);
      return result;
    },
  };
  const client = { fs: fake, db: {}, refs: { noteDays: 'notes' } };
  env.client = client;
  const ppaSource = { ref: 'notes/ppa_' + previous, id: 'ppa_' + previous };
  const tbvSource = { ref: 'notes/tbv_' + previous, id: 'tbv_' + previous };
  const first = await env.test.archiveNoteSource(client, ppaSource, date);
  assert.equal(first.remaining.length, 1);
  assert.equal(store.get('notes/ppa_' + date).taskOrder.length, 300);
  assert.equal((await env.test.archiveNoteSource(client, tbvSource, date)).archived, 1);
  assert.equal(store.get('notes/tbv_' + date).tasks.tbvPending.text, 'TBV pending');
  const removed = store.get('notes/ppa_' + date);
  delete removed.tasks['source-0']; removed.taskOrder = removed.taskOrder.filter(id => id !== 'source-0');
  assert.equal((await env.test.archiveNoteSource(client, ppaSource, date)).archived, 1);
  assert.equal(Object.keys(store.get('notes/ppa_' + date).tasks).length, 300);
  assert.equal(store.get('notes/ppa_' + date).tasks['source-0'], undefined);
  assert.ok(store.get('notes/ppa_' + date).tasks['source-299']);
  console.log('PASS 300+1 partial carry, other owner independent, capacity drains without resurrection or UUID changes');

  const view = () => env.test.noteSnapshot('ppa', date, { data: () => store.get('notes/ppa_' + date), metadata: { fromCache: false } });
  assert.equal(await env.api.notes.pin('ppa', date, 'source-4'), true);
  assert.equal(view().pinnedId, 'source-4');
  assert.equal(await env.api.notes.move('ppa', date, 'source-4', 'todayPlan'), true);
  assert.equal(view().tasks[0].id, 'source-4');
  assert.equal(await env.api.notes.move('ppa', date, 'source-4', 'source-4'), false);
  assert.equal(await env.api.notes.setDone('ppa', date, 'source-4', true), true);
  assert.equal(view().pinnedId, null);
  assert.equal(await env.api.notes.pin('ppa', date, 'source-4'), false);
  assert.equal(await env.api.notes.pin('ppa', date, 'source-5'), true);
  assert.equal(await env.api.notes.remove('ppa', date, 'source-5'), true);
  assert.equal(view().pinnedId, null);
  assert.equal(view().tasks.length, 299);
  assert.equal(store.get('notes/ppa_' + date).notesVersion, 2);
  console.log('PASS persisted manual order, independent pin, no-op moves, pin clears on complete/delete');

  const malformed = { owner: 'ppa', date, tasks: { bad: { text: false } }, doneIds: [] };
  assert.equal(env.test.noteSnapshot('ppa', date, { data: () => malformed, metadata: {} }).tasks.length, 1);
  console.log('PASS malformed legacy task remains visible for deletion');

  // Existing current-day priority is never displaced by a carried priority.
  const oldDate = time.offsetDay(date, -2);
  store.set('notes/tbv_' + oldDate, { owner: 'tbv', date: oldDate, pendingDay: oldDate,
    tasks: { oldPin: task('Priority from yesterday') }, doneIds: [], taskOrder: ['oldPin'], pinnedId: 'oldPin', notesVersion: 2 });
  const tbvToday = store.get('notes/tbv_' + date);
  tbvToday.pinnedId = 'tbvPending';
  await env.test.archiveNoteSource(client, { ref: 'notes/tbv_' + oldDate, id: 'tbv_' + oldDate }, date);
  assert.equal(store.get('notes/tbv_' + date).pinnedId, 'tbvPending');
  assert.ok(store.get('notes/tbv_' + date).tasks.oldPin);
  console.log('PASS carried source priority preserves an existing explicit priority today');
}
test('history cache, note capacity, ordering and priority persist correctly', main);

async function noteRewardFixture() {
  const app = path.resolve(__dirname, '../js');
  const time = await import(pathToFileURL(path.join(app, 'gameTime.js')));
  const date = '2026-11-18', now = time.dateStart(date) + 12 * 3600000;
  const users = Object.fromEntries(['ppa', 'tbv'].map(id => [id, { id, currentActivity: 'home_idle',
    waterDropsToday: 0, waterDropsAvailable: 0 }]));
  const store = new Map([['room', { users, messages: [], revision: 1, historyIndex: {}, plant: {
    date, dailyQuests: { [date]: {} }, currentStage: 1, streakDays: 0, consecutiveMissedDays: 0,
    shieldAvailable: false, lastEvaluationDate: null, targetDrops: 62,
  } }]]);
  const versions = new Map(), attempts = [], config = {};
  const env = { ...time, today: (epoch = now) => time.today(epoch), structuredClone, console, setTimeout, clearTimeout,
    navigator: { onLine: true }, addEventListener() {} };
  const source = (await fs.readFile(path.join(app, 'db.js'), 'utf8'))
    .replace(/^import[^\n]+\n/, '').replace(/export /g, '');
  vm.createContext(env);
  vm.runInContext(source + '\ncontext=async()=>globalThis.client;serverReady=true;globalThis.api=PocketDB;', env);
  const put = (ref, value) => { store.set(ref, structuredClone(value)); versions.set(ref, (versions.get(ref) ?? 0) + 1); };
  env.client = { db: {}, refs: { room: 'room', users: { ppa: 'user/ppa', tbv: 'user/tbv' },
    logs: 'logs', interactions: 'events', noteDays: 'notes' }, fs: {
    doc: (collection, id) => collection + '/' + id, serverTimestamp: () => 'server-time',
    Timestamp: { fromMillis: millis => ({ millis }) },
    runTransaction: async (_db, apply) => {
      for (let retry = 0; retry < 5; retry++) {
        const reads = new Map(), writes = [], order = [];
        const result = await apply({
          get: async ref => {
            assert.equal(writes.length, 0, 'every transaction read must precede every write');
            reads.set(ref, versions.get(ref) ?? 0); order.push(['read', ref]);
            return { data: () => structuredClone(store.get(ref)) };
          },
          set: (ref, data) => { writes.push([ref, structuredClone(data)]); order.push(['write', ref]); },
        });
        attempts.push(order);
        await config.beforeCommit?.({ reads, writes, put, store });
        if ([...reads].some(([ref, version]) => (versions.get(ref) ?? 0) !== version)) continue;
        for (const [ref, data] of writes) put(ref, data);
        return result;
      }
      throw new Error('Transaction retry limit');
    },
  } };
  const note = (owner = 'ppa', noteDate = date, doneIds = ['a', 'b', 'c', 'd', 'e']) => ({
    owner, date: noteDate, pendingDay: noteDate,
    tasks: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, { text: id }])), doneIds,
  });
  const noChange = raw => ({ draft: structuredClone(raw), logs: [], result: false });
  const claim = (raw, _logs, proof) => {
    const change = noChange(raw), { draft } = change;
    const key = 'complete_5_notes_ppa';
    if (proof?.owner === 'ppa' && proof.date === date && proof.archived === false
      && proof.completedCount >= 5 && !draft.plant.dailyQuests[date][key]) {
      draft.plant.dailyQuests[date][key] = now;
      draft.users.ppa.waterDropsAvailable += 2;
      change.result = true;
    }
    return change;
  };
  const options = { actor: 'ppa', now, noteQuest: { owner: 'ppa', date } };
  return { api: env.api, store, put, attempts, config, date, now, time, note, noChange, claim, options };
}

test('note quest proof reads the exact owner/day and counts only distinct existing completed IDs', async () => {
  const f = await noteRewardFixture();
  let proof;
  const inspect = (raw, _logs, value) => { proof = value; return f.noChange(raw); };
  await f.api.mutate(inspect, () => false, { actor: 'ppa', now: f.now });
  assert.equal(proof, undefined, 'existing calls receive no unrequested proof');
  assert.equal(f.attempts.at(-1).length, 1, 'old API does not read a Notes document');
  f.put('notes/ppa_' + f.date, f.note('ppa', f.date, ['a', 'a', 'b', 'c', 'd', 'missing', 7]));
  await f.api.mutate(inspect, () => false, f.options);
  assert.deepEqual(JSON.parse(JSON.stringify(proof)), { owner: 'ppa', date: f.date, completedCount: 4, archived: false });
  assert.equal(f.attempts.at(-1)[1][1], 'notes/ppa_' + f.date);
  f.put('notes/ppa_' + f.date, { ...f.note(), archivedTo: f.time.nextDay(f.date) });
  await f.api.mutate(inspect, () => false, f.options);
  assert.equal(proof.completedCount, 5); assert.equal(proof.archived, true);
  f.put('notes/ppa_' + f.date, f.note('tbv'));
  await f.api.mutate(inspect, () => false, f.options);
  assert.equal(proof.completedCount, 0); assert.equal(proof.archived, true);
  f.store.delete('notes/ppa_' + f.date);
  await f.api.mutate(inspect, () => false, { ...f.options, noteQuest: { ...f.options.noteQuest, completedCount: 999 } });
  assert.equal(proof.completedCount, 0, 'caller fields cannot fabricate the server-read count');
  await assert.rejects(f.api.mutate(inspect, () => false, { ...f.options, noteQuest: { owner: 'other', date: f.date } }), { code: 'invalid-argument' });
  await assert.rejects(f.api.mutate(inspect, () => false, { ...f.options, noteQuest: { owner: 'ppa', date: '2026-02-30' } }), { code: 'invalid-argument' });
});

test('two concurrent note reward transactions read proof before writing and award once', async () => {
  const f = await noteRewardFixture();
  f.put('notes/ppa_' + f.date, f.note());
  const results = await Promise.all([f.api.mutate(f.claim, () => false, f.options), f.api.mutate(f.claim, () => false, f.options)]);
  assert.equal(results.filter(change => change.result).length, 1);
  assert.equal(f.store.get('room').users.ppa.waterDropsAvailable, 2);
  assert.equal(Object.keys(f.store.get('room').plant.dailyQuests[f.date]).length, 1);
  assert.ok(f.attempts.length >= 3, 'competing room write causes a proof-and-room reread');
  for (const attempt of f.attempts) {
    const proofRead = attempt.findIndex(([kind, ref]) => kind === 'read' && ref === 'notes/ppa_' + f.date);
    const write = attempt.findIndex(([kind]) => kind === 'write');
    assert.ok(proofRead >= 0 && (write < 0 || proofRead < write));
  }
});

test('a concurrent uncheck invalidates stale five-note proof before reward commit', async () => {
  const f = await noteRewardFixture();
  f.put('notes/ppa_' + f.date, f.note());
  let changed = false;
  f.config.beforeCommit = ({ writes, put }) => {
    if (!changed && writes.length) { changed = true; put('notes/ppa_' + f.date, f.note('ppa', f.date, ['a', 'b', 'c', 'd'])); }
  };
  const result = await f.api.mutate(f.claim, () => false, f.options);
  assert.equal(result.result, false);
  assert.equal(f.store.get('room').users.ppa.waterDropsAvailable, 0);
  assert.equal(Object.keys(f.store.get('room').plant.dailyQuests[f.date]).length, 0);
  assert.equal(f.attempts.length, 2, 'Notes change retries the whole transaction and recomputes proof');
});
