import { dateStart, nextDay, today } from './gameTime.js';

const sdkRoot = 'https://www.gstatic.com/firebasejs/10.14.1/';
const firebaseConfig = {
  apiKey: 'AIzaSyDGui-tm2sxrR1hLmCWvoDhaPfnvZCJKoQ',
  authDomain: 'lovvers-95674.firebaseapp.com',
  projectId: 'lovvers-95674',
  storageBucket: 'lovvers-95674.firebasestorage.app',
  messagingSenderId: '978954261370',
  appId: '1:978954261370:web:052c177ceabcdcc8a77cc3',
  measurementId: 'G-33LHVVKH2M',
};

const roles = ['ppa', 'tbv'];
const subscribers = new Set();
let feed = { status: 'connecting', raw: null, error: null };
let initializing;
let unsubscribeRoom;
let serverReady = false;
let reconnectTimer;
let reconnectDelay = 3000;

function publish(changes) {
  feed = { ...feed, ...changes };
  for (const subscriber of subscribers) subscriber(feed);
}

function dbError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isNetworkError(error) {
  return globalThis.navigator?.onLine === false
    || ['unavailable', 'deadline-exceeded', 'firestore/unavailable'].includes(error?.code);
}

function retryConnection(client) {
  if (reconnectTimer || navigator.onLine === false) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    void probeConnection(client);
  }, reconnectDelay);
}

async function probeConnection(client) {
  const { fs, refs } = client;
  if (navigator.onLine === false) return;
  try {
    const snapshot = await fs.getDocFromServer(refs.room);
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    reconnectDelay = 3000;
    serverReady = true;
    publish({ status: 'online', raw: rawFrom(snapshot.data()), error: null });
    listenRoom(client);
  } catch (error) {
    serverReady = false;
    const offline = isNetworkError(error);
    publish({ status: offline ? 'offline' : 'error', error });
    if (offline) retryConnection(client);
  }
}

function projectForURL() {
  const url = new URL(location.href);
  const emulator = ['localhost', '127.0.0.1'].includes(url.hostname)
    && url.searchParams.get('emulator') === '1';
  return { emulator, config: emulator ? { ...firebaseConfig, projectId: 'demo-pocket-space' } : firebaseConfig };
}

function context() {
  if (initializing) return initializing;
  initializing = (async () => {
    const [firebase, fs] = await Promise.all([
      import(sdkRoot + 'firebase-app.js'),
      import(sdkRoot + 'firebase-firestore.js'),
    ]);
    const { emulator, config } = projectForURL();
    const app = firebase.initializeApp(config);
    const db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    if (emulator) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    const refs = {
      room: fs.doc(db, 'pocket_space', 'plant_state'),
      users: Object.fromEntries(roles.map(role => [role, fs.doc(db, 'pocket_space', 'user_' + role)])),
      interactions: fs.collection(db, 'pocket_space', 'live_interactions', 'events'),
      logs: fs.collection(db, 'pocket_space', 'activity_history', 'logs'),
      noteDays: fs.collection(db, 'pocket_space', 'notes_state', 'days'),
    };
    const client = { fs, db, refs };
    listenRoom(client);
    addEventListener('offline', () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      serverReady = false;
      publish({ status: 'offline' });
    });
    addEventListener('online', () => {
      publish({ status: 'connecting', error: null });
      void probeConnection(client);
    });
    return client;
  })().catch(error => {
    initializing = null;
    publish({ status: isNetworkError(error) ? 'offline' : 'error', error });
    throw error;
  });
  return initializing;
}

function rawFrom(data) {
  if (!data?.users || !data.plant) return null;
  return { users: data.users, plant: data.plant, messages: data.messages ?? [], revision: data.revision ?? 0 };
}

function listenRoom(client) {
  if (unsubscribeRoom) return;
  const { fs, refs } = client;
  unsubscribeRoom = fs.onSnapshot(refs.room, { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites) return;
    serverReady = !snapshot.metadata.fromCache && navigator.onLine !== false;
    if (serverReady) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      reconnectDelay = 3000;
    }
    publish({ status: serverReady ? 'online' : 'offline', raw: rawFrom(snapshot.data()), error: null });
  }, error => {
    unsubscribeRoom = undefined;
    serverReady = false;
    const offline = isNetworkError(error);
    publish({ status: offline ? 'offline' : 'error', error });
    if (offline) retryConnection(client);
  });
}

function requireOnline() {
  if (!serverReady || navigator.onLine === false) {
    throw dbError('unavailable', 'Mất kết nối. Thay đổi chưa được lưu.');
  }
}

function equal(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

export function splitLog(entry, revision) {
  const segments = [];
  let startTimestamp = entry.startTimestamp;
  while (startTimestamp < entry.endTimestamp) {
    const dateStr = today(startTimestamp);
    const endTimestamp = Math.min(entry.endTimestamp, dateStart(nextDay(dateStr)));
    const awardedWater = entry.creditDate === dateStr ? entry.waterDrops ?? 0 : 0;
    segments.push({
      ...entry,
      id: entry.id + '_' + dateStr,
      sessionLogId: entry.id,
      dateStr,
      date: dateStr,
      startTimestamp,
      endTimestamp,
      durationMinutes: (endTimestamp - startTimestamp) / 60000,
      ...(entry.waterDrops != null ? { waterDrops: awardedWater } : {}),
      awardedWater,
      roomRevision: revision,
    });
    startTimestamp = endTimestamp;
  }
  // A reward at exactly midnight belongs to the new day, even when the
  // underlying activity interval ends there and has no new-day segment.
  if (entry.waterDrops && entry.creditDate && !segments.some(segment => segment.dateStr === entry.creditDate)) {
    const end = entry.endTimestamp;
    segments.push({
      ...entry, id: entry.id + '_' + entry.creditDate, sessionLogId: entry.id,
      dateStr: entry.creditDate, date: entry.creditDate, startTimestamp: end,
      endTimestamp: end, durationMinutes: 0, awardedWater: entry.waterDrops, roomRevision: revision,
    });
  }
  return segments;
}

function questsFor(user, plant) {
  return Object.keys(plant.dailyQuests?.[plant.date] ?? {}).filter(key => key.endsWith('_' + user) || key.endsWith('_pair'));
}

async function runRoomTransaction({ fs, db, refs }, apply) {
  for (let attempt = 0; ; attempt++) {
    let readRevision;
    try {
      return await fs.runTransaction(db, async transaction => {
        const current = (await transaction.get(refs.room)).data();
        readRevision = current?.revision ?? 0;
        return apply(transaction, current);
      });
    } catch (error) {
      if (attempt >= 2 || !['permission-denied', 'already-exists'].includes(error.code) || readRevision == null) throw error;
      // Rules can reject a stale revision before the SDK sees the transaction
      // conflict. Use fresh transaction reads because the watch can lag a commit.
      let advanced = false;
      for (const delay of [40, 120, 320]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const latest = await fs.runTransaction(db, async tx => (await tx.get(refs.room)).data());
        if (latest?.revision > readRevision) {
          advanced = true;
          break;
        }
      }
      if (!advanced) throw error;
    }
  }
}

async function mutate(transform, needsLegacyLogs, options = {}) {
  const client = await context();
  const { fs, refs } = client;
  requireOnline();
  const actor = options.actor ?? 'system';
  if (actor !== 'system' && !roles.includes(actor)) throw dbError('invalid-argument', 'Hồ sơ không hợp lệ.');
  let noteQuest;
  if (options.noteQuest != null) {
    const { owner, date } = options.noteQuest;
    noteDayId(owner, date);
    noteQuest = { owner, date };
  }
  let legacyHistory;
  try {
    for (let migrationAttempt = 0; migrationAttempt < 5; migrationAttempt++) {
      try {
        return await runRoomTransaction(client, async (transaction, current) => {
      let raw = rawFrom(current);
      const needsUsers = !raw;
      if (needsUsers) {
        const users = await Promise.all(roles.map(role => transaction.get(refs.users[role])));
        raw = {
          users: Object.fromEntries(roles.flatMap((role, index) => {
            const data = users[index].data();
            return data ? [[role, data]] : [];
          })),
          plant: current?.plant ?? current ?? null,
          messages: current?.messages ?? [],
        };
      }
      const needsHistory = typeof needsLegacyLogs === 'function' && needsLegacyLogs(raw);
      const legacyDate = raw.plant?.date ?? today(options.now ?? Date.now());
      if (needsHistory && (!legacyHistory || legacyHistory.revision !== (current?.revision ?? 0)
        || legacyHistory.date !== legacyDate)) {
        throw Object.assign(dbError('legacy-history-required', 'Đang đồng bộ lịch sử cũ.'), { date: legacyDate });
      }
      let proof;
      if (noteQuest) {
        const note = (await transaction.get(fs.doc(refs.noteDays, noteDayId(noteQuest.owner, noteQuest.date)))).data();
        const matches = note?.owner === noteQuest.owner && note?.date === noteQuest.date;
        const tasks = matches && note.tasks && typeof note.tasks === 'object' && !Array.isArray(note.tasks) ? note.tasks : {};
        const doneIds = matches && Array.isArray(note.doneIds) ? note.doneIds : [];
        proof = { ...noteQuest,
          completedCount: new Set(doneIds.filter(id => typeof id === 'string' && Object.hasOwn(tasks, id))).size,
          archived: Boolean(note?.archivedTo) || noteQuest.date < today() || Boolean(note && !matches) };
      }
      const change = transform(raw, needsHistory ? legacyHistory.logs : [], proof);
      const { draft, logs } = change;
      if (!needsUsers && !logs.length && equal(draft.users, raw.users)
        && equal(draft.plant, raw.plant) && equal(draft.messages, raw.messages)) {
        return { ...change, revision: current.revision };
      }
      const revision = (current?.revision ?? 0) + 1;
      const historyIndex = { ...current?.historyIndex };
      const segments = logs.flatMap(entry => splitLog(entry, revision));
      for (const segment of segments) {
        const count = historyIndex[segment.dateStr];
        historyIndex[segment.dateStr] = (Number.isSafeInteger(count) && count >= 0 && count < Number.MAX_SAFE_INTEGER ? count : 0) + 1;
        transaction.set(fs.doc(refs.logs, segment.id), segment);
      }
      for (const role of roles) {
        const user = draft.users[role];
        const questsDone = questsFor(role, draft.plant);
        const oldQuests = raw.plant?.date ? questsFor(role, raw.plant) : [];
        if (needsUsers || !equal(user, raw.users[role]) || !equal(questsDone, oldQuests)) {
          transaction.set(refs.users[role], {
            ...user, waterToday: user.waterDropsToday, questsDone, lastActive: fs.serverTimestamp(),
          });
        }
      }
      const oldMessages = new Map(raw.messages.map(message => [message.id, message]));
      for (const message of draft.messages) {
        if (!equal(oldMessages.get(message.id), message)) {
          transaction.set(fs.doc(refs.interactions, message.id), {
            ...message,
            sender: message.from.toUpperCase(),
            type: { text: 'message', bonk: 'punch' }[message.kind] ?? message.kind,
            content: message.text,
            timestamp: message.at,
            roomRevision: revision,
            updatedAt: fs.serverTimestamp(),
          });
        }
      }
      transaction.set(refs.room, {
        ...draft,
        revision,
        historyIndex,
        currentStage: draft.plant.currentStage,
        streakDays: draft.plant.streakDays,
        consecutiveMissedDays: draft.plant.consecutiveMissedDays,
        hasShield: draft.plant.shieldAvailable,
        lastSettledDate: draft.plant.lastEvaluationDate,
        targetWater: draft.plant.targetDrops,
        actor,
        action: options.action ?? 'refresh',
        clientEvaluatedAt: fs.Timestamp.fromMillis(options.now ?? Date.now()),
        updatedAt: fs.serverTimestamp(),
      });
      return { ...change, revision };
        });
      } catch (error) {
        if (error.code !== 'legacy-history-required') throw error;
        legacyHistory = await readHistorySnapshot(client, error.date, true);
      }
    }
    throw dbError('history-retry', 'Dữ liệu vừa thay đổi. Hãy thử lại.');
  } catch (error) {
    const offline = isNetworkError(error);
    if (offline) serverReady = false;
    publish({ status: offline ? 'offline' : 'error', error });
    if (offline) retryConnection(client);
    throw error;
  }
}

// A server-confirmed query is complete independently of the advisory counter.
// Keep its signature so a poisoned old counter cannot block an offline reread.
const verifiedHistory = new Map();
function historyCertificate(date, value) {
  let key;
  try { key = 'pocket-space-history-v2:' + projectForURL().config.projectId + ':' + date; }
  catch { /* Storage is optional in private or embedded browser contexts. */ }
  if (value) {
    verifiedHistory.set(date, value);
    try { if (key) localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the in-memory certificate. */ }
    return value;
  }
  if (!verifiedHistory.has(date)) {
    try {
      const saved = key && JSON.parse(localStorage.getItem(key));
      if (Number.isSafeInteger(saved?.revision) && typeof saved.signature === 'string') verifiedHistory.set(date, saved);
    } catch { /* An absent certificate requires an online query. */ }
  }
  return verifiedHistory.get(date);
}
function historyEntry(entry, date, revision) {
  const start = dateStart(date), end = dateStart(nextDay(date));
  return entry && entry.dateStr === date && roles.includes(entry.user)
    && typeof entry.id === 'string' && typeof entry.activity === 'string'
    && Number.isSafeInteger(entry.roomRevision) && entry.roomRevision > 0 && entry.roomRevision <= revision
    && Number.isSafeInteger(entry.startTimestamp) && Number.isSafeInteger(entry.endTimestamp)
    && entry.startTimestamp >= start && entry.startTimestamp < end
    && entry.endTimestamp >= entry.startTimestamp && entry.endTimestamp <= end;
}
async function readHistorySnapshot({ fs, refs }, date, useServer) {
  if (dateStart(date) === null) throw dbError('invalid-argument', 'Ngày lịch sử không hợp lệ.');
  const dayQuery = fs.query(refs.logs, fs.where('dateStr', '==', date));
  const getRoom = useServer ? fs.getDocFromServer : fs.getDocFromCache;
  const getLogs = useServer ? fs.getDocsFromServer : fs.getDocsFromCache;
  for (let attempt = 0; attempt < (useServer ? 4 : 1); attempt++) {
    const before = (await getRoom(refs.room)).data();
    const query = await getLogs(dayQuery);
    const room = (await getRoom(refs.room)).data();
    const revision = room?.revision ?? 0;
    if ((before?.revision ?? 0) !== revision) continue;
    const rows = query.docs.map(item => item.data());
    const signature = JSON.stringify(query.docs.map(item => item.id ?? item.data().id).sort());
    const indexValue = room?.historyIndex?.[date] ?? 0;
    const certificate = historyCertificate(date);
    if (!useServer && !(certificate?.revision <= revision && certificate.signature === signature
      && Object.hasOwn(certificate, 'indexValue') && equal(certificate.indexValue, indexValue))) continue;
    if (useServer) historyCertificate(date, { revision, signature, indexValue });
    return { date, revision, logs: rows.filter(entry => historyEntry(entry, date, revision)), users: room?.users ?? null };
  }
  throw dbError(useServer ? 'history-retry' : 'history-not-cached', useServer
    ? 'Lịch sử vừa thay đổi. Hãy thử lại.' : 'Ngày này chưa tải đủ dữ liệu để xem ngoại tuyến.');
}
async function historyDay(date) {
  const client = await context();
  if (serverReady) {
    try { return await readHistorySnapshot(client, date, true); }
    catch (error) { if (!isNetworkError(error)) throw error; }
  }
  return readHistorySnapshot(client, date, false);
}

const NOTE_LIMIT = 300;
const NOTE_LENGTH = 240;
const NOTE_ROLLOVER_PAGE = 16;
let noteRollover;

function noteDayId(owner, date) {
  if (!roles.includes(owner) || dateStart(date) === null) {
    throw dbError('invalid-argument', 'Hồ sơ hoặc ngày ghi chú không hợp lệ.');
  }
  return owner + '_' + date;
}

function noteOrder(raw) {
  const tasks = raw?.tasks ?? {};
  const seen = new Set();
  const preferred = Array.isArray(raw?.taskOrder) ? raw.taskOrder : [];
  const fallback = Object.keys(tasks).sort((a, b) => (Number(tasks[a]?.createdAt) || 0)
    - (Number(tasks[b]?.createdAt) || 0) || a.localeCompare(b));
  return [...preferred, ...fallback].filter(id => typeof id === 'string' && Object.hasOwn(tasks, id)
    && !seen.has(id) && seen.add(id));
}
function openNoteDay(owner, date, previous) {
  const tasks = { ...previous?.tasks };
  const doneIds = [...new Set(Array.isArray(previous?.doneIds) ? previous.doneIds : [])]
    .filter(id => Object.hasOwn(tasks, id));
  const pinnedId = previous?.pinnedId;
  return { owner, date, tasks, doneIds, pendingDay: date, notesVersion: 2,
    taskOrder: noteOrder(previous),
    pinnedId: typeof pinnedId === 'string' && Object.hasOwn(tasks, pinnedId) && !doneIds.includes(pinnedId) ? pinnedId : null };
}
function noteSnapshot(owner, date, snapshot) {
  const raw = snapshot.data();
  const doneIds = new Set(raw?.doneIds ?? []);
  const tasks = noteOrder(raw).map(id => {
    const item = raw.tasks[id];
    // Malformed legacy values remain visible and deletable instead of silently
    // occupying capacity while presenting an empty notebook.
    const text = typeof item?.text === 'string' ? item.text : 'Mục ghi chú cũ không đọc được';
    return { id, text, done: doneIds.has(id), createdAt: item?.createdAt ?? 0,
      ...(item?.carriedFromDate ? { carriedFromDate: item.carriedFromDate } : {}) };
  });
  const pinnedId = tasks.some(task => task.id === raw?.pinnedId && !task.done) ? raw.pinnedId : null;
  return { owner, date, tasks, pinnedId, archived: Boolean(raw?.archivedTo) || date < today(), fromCache: snapshot.metadata.fromCache };
}

function subscribeNotes(owner, date, onChange, onError = () => {}) {
  const id = noteDayId(owner, date);
  let active = true;
  let unsubscribe;
  const fail = error => { if (active) onError(error); };
  void context().then(({ fs, refs }) => {
    if (!active) return;
    unsubscribe = fs.onSnapshot(fs.doc(refs.noteDays, id), { includeMetadataChanges: true }, snapshot => {
      if (active && !snapshot.metadata.hasPendingWrites) onChange(noteSnapshot(owner, date, snapshot));
    }, fail);
  }).catch(fail);
  return () => { active = false; unsubscribe?.(); };
}

function validateNoteTaskId(id) {
  // IDs from earlier public day maps may contain punctuation. These are map
  // keys, never document paths: retaining them lets users remove legacy rows.
  if (typeof id !== 'string' || !id.length || id.length > 1500) {
    throw dbError('invalid-argument', 'Mục ghi chú không hợp lệ.');
  }
}

function checkNoteCapacity(tasks) {
  if (Object.keys(tasks).length > NOTE_LIMIT) {
    throw dbError('resource-exhausted', 'Ngày này đã có quá nhiều mục ghi chú. Hãy xóa bớt mục để tiếp tục.');
  }
}

async function mutateNoteDay(owner, date, change) {
  const id = noteDayId(owner, date);
  if (date < today()) throw dbError('failed-precondition', 'Ghi chú ngày đã qua chỉ có thể xem.');
  const { fs, db, refs } = await context();
  requireOnline();
  const ref = fs.doc(refs.noteDays, id);
  return fs.runTransaction(db, async transaction => {
    const previous = (await transaction.get(ref)).data();
    if (date < today() || previous?.archivedTo) {
      throw dbError('failed-precondition', 'Ghi chú ngày đã qua chỉ có thể xem.');
    }
    const draft = openNoteDay(owner, date, previous);
    const result = change(draft);
    if (!result) return false;
    checkNoteCapacity(draft.tasks);
    transaction.set(ref, { ...draft, updatedAt: fs.serverTimestamp() });
    return result;
  });
}

async function addNote(owner, date, text) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body || body.length > NOTE_LENGTH) {
    throw dbError('invalid-argument', 'Ghi chú cần có từ 1 đến ' + NOTE_LENGTH + ' ký tự.');
  }
  const { fs, refs } = await context();
  const id = fs.doc(refs.noteDays).id;
  const createdAt = Date.now();
  return mutateNoteDay(owner, date, draft => {
    draft.tasks[id] = { text: body, createdAt };
    draft.taskOrder.push(id);
    return id;
  });
}

async function setNoteDone(owner, date, id, done) {
  validateNoteTaskId(id);
  if (typeof done !== 'boolean') throw dbError('invalid-argument', 'Trạng thái ghi chú không hợp lệ.');
  return mutateNoteDay(owner, date, draft => {
    if (!Object.hasOwn(draft.tasks, id) || draft.doneIds.includes(id) === done) return false;
    draft.doneIds = done ? [...draft.doneIds, id] : draft.doneIds.filter(value => value !== id);
    if (done && draft.pinnedId === id) draft.pinnedId = null;
    return true;
  });
}

async function removeNote(owner, date, id) {
  validateNoteTaskId(id);
  return mutateNoteDay(owner, date, draft => {
    if (!Object.hasOwn(draft.tasks, id)) return false;
    delete draft.tasks[id];
    draft.doneIds = draft.doneIds.filter(value => value !== id);
    draft.taskOrder = draft.taskOrder.filter(value => value !== id);
    if (draft.pinnedId === id) draft.pinnedId = null;
    return true;
  });
}

async function moveNote(owner, date, id, beforeId = null) {
  validateNoteTaskId(id);
  if (beforeId !== null) validateNoteTaskId(beforeId);
  return mutateNoteDay(owner, date, draft => {
    if (id === beforeId || !Object.hasOwn(draft.tasks, id)
      || (beforeId !== null && !Object.hasOwn(draft.tasks, beforeId))) return false;
    const order = draft.taskOrder.filter(value => value !== id);
    order.splice(beforeId === null ? order.length : order.indexOf(beforeId), 0, id);
    if (equal(order, draft.taskOrder)) return false;
    draft.taskOrder = order;
    return true;
  });
}
async function pinNote(owner, date, id) {
  if (id !== null) validateNoteTaskId(id);
  return mutateNoteDay(owner, date, draft => {
    if (id === draft.pinnedId || (id !== null
      && (!Object.hasOwn(draft.tasks, id) || draft.doneIds.includes(id)))) return false;
    draft.pinnedId = id;
    return true;
  });
}
async function archiveNoteSource({ fs, db, refs }, item, date) {
  return fs.runTransaction(db, async transaction => {
    const raw = (await transaction.get(item.ref)).data();
    if (!raw?.pendingDay || raw.pendingDay >= date) return { archived: 0, owner: raw?.owner, remaining: [] };
    if (raw.pendingDay !== raw.date || noteDayId(raw.owner, raw.date) !== item.id || raw.archivedTo) {
      throw dbError('data-loss', 'Không thể đọc bản ghi chú cũ.');
    }
    const done = new Set(raw.doneIds);
    const carried = new Set(raw.carriedIds ?? []);
    const pending = noteOrder(raw).filter(id => !done.has(id) && !carried.has(id));
    const ref = fs.doc(refs.noteDays, noteDayId(raw.owner, date));
    const previous = pending.length ? (await transaction.get(ref)).data() : null;
    const draft = openNoteDay(raw.owner, date, previous);
    let free = NOTE_LIMIT - Object.keys(draft.tasks).length;
    let changed = false;
    for (const id of pending) {
      if (Object.hasOwn(draft.tasks, id)) { carried.add(id); continue; }
      if (free <= 0) continue;
      draft.tasks[id] = { ...raw.tasks[id], carriedFromDate: raw.tasks[id]?.carriedFromDate ?? raw.date };
      draft.taskOrder.push(id);
      carried.add(id);
      free--;
      changed = true;
    }
    if (!draft.pinnedId && pending.includes(raw.pinnedId) && carried.has(raw.pinnedId)
      && Object.hasOwn(draft.tasks, raw.pinnedId) && !draft.doneIds.includes(raw.pinnedId)) {
      draft.pinnedId = raw.pinnedId;
      changed = true;
    }
    const remaining = pending.filter(id => !carried.has(id));
    if (changed) transaction.set(ref, { ...draft, updatedAt: fs.serverTimestamp() });
    const source = { ...raw, notesVersion: 2, taskOrder: noteOrder(raw), pinnedId: raw.pinnedId ?? null,
      carriedIds: [...carried], carriedTo: date, updatedAt: fs.serverTimestamp() };
    if (!remaining.length) {
      delete source.pendingDay;
      source.archivedTo = date;
    }
    if (!remaining.length || carried.size !== (raw.carriedIds?.length ?? 0)) transaction.set(item.ref, source);
    return { archived: remaining.length ? 0 : 1, owner: raw.owner, remaining };
  });
}
async function catchUpNotes() {
  const client = await context();
  const { fs, refs } = client;
  let date = today(), cursor;
  const remaining = { ppa: new Set(), tbv: new Set() };
  let archived = 0;
  for (;;) {
    requireOnline();
    if (date !== today()) { date = today(); cursor = undefined; remaining.ppa.clear(); remaining.tbv.clear(); }
    const constraints = [fs.where('pendingDay', '<', date), fs.orderBy('pendingDay'), fs.limit(NOTE_ROLLOVER_PAGE)];
    if (cursor) constraints.push(fs.startAfter(cursor));
    const page = await fs.getDocsFromServer(fs.query(refs.noteDays, ...constraints));
    if (page.empty) return { archived, remainingByOwner: Object.fromEntries(roles.map(owner => [owner, remaining[owner].size])) };
    for (const item of page.docs) {
      const result = await archiveNoteSource(client, item, date);
      archived += result.archived;
      for (const id of result.remaining) remaining[result.owner].add(id);
    }
    // Advance past capacity-blocked sources, allowing the other owner to drain.
    cursor = page.docs.at(-1);
  }
}

function rolloverNotes() {
  noteRollover ??= catchUpNotes().finally(() => { noteRollover = undefined; });
  return noteRollover;
}

export const PocketDB = {
  async start() { await context(); },
  async reconnect() {
    const client = await context();
    await probeConnection(client);
  },
  subscribe(handler) {
    subscribers.add(handler);
    handler(feed);
    return () => subscribers.delete(handler);
  },
  mutate,
  historyDay,
  notes: { subscribe: subscribeNotes, add: addNote, setDone: setNoteDone, remove: removeNote, move: moveNote, pin: pinNote, rollover: rolloverNotes },
};
