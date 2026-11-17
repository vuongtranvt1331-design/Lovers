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
