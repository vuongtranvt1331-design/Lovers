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
let feed = { status: 'connecting', approved: false, role: null, deviceId: null, raw: null, error: null };
let initializing;
let registeringDevice;
let unsubscribeRoom;
let generation = 0;
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
    || ['unavailable', 'deadline-exceeded', 'firestore/unavailable', 'auth/network-request-failed'].includes(error?.code);
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
  const { fs, refs, auth } = client;
  if (navigator.onLine === false) return;
  if (!feed.approved || !auth.currentUser?.isAnonymous) {
    await connectDevice(client, auth.currentUser);
    return;
  }
  const token = generation;
  try {
    const snapshot = await fs.getDocFromServer(refs.room);
    if (token !== generation) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    reconnectDelay = 3000;
    serverReady = true;
    publish({ status: 'online', raw: rawFrom(snapshot.data()), error: null });
  } catch (error) {
    if (token !== generation) return;
    serverReady = false;
    const offline = isNetworkError(error);
    if (error.code === 'permission-denied') markUnapproved(error);
    else publish({ status: offline ? 'offline' : 'error', error });
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
    const [firebase, fs, authSDK] = await Promise.all([
      import(sdkRoot + 'firebase-app.js'),
      import(sdkRoot + 'firebase-firestore.js'),
      import(sdkRoot + 'firebase-auth.js'),
    ]);
    const { emulator, config } = projectForURL();
    const app = firebase.initializeApp(config);
    const db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    const auth = authSDK.initializeAuth(app, {
      persistence: [authSDK.indexedDBLocalPersistence, authSDK.browserLocalPersistence],
    });
    if (emulator) {
      fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      authSDK.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    const refs = {
      room: fs.doc(db, 'pocket_space', 'plant_state'),
      access: fs.doc(db, 'pocket_space', 'access'),
      users: Object.fromEntries(roles.map(role => [role, fs.doc(db, 'pocket_space', 'user_' + role)])),
      interactions: fs.collection(db, 'pocket_space', 'live_interactions', 'events'),
      logs: fs.collection(db, 'activity_logs'),
    };
    const client = { fs, authSDK, auth, db, refs };
    authSDK.onAuthStateChanged(auth, user => void connectDevice(client, user));
    addEventListener('offline', () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      serverReady = false;
      if (feed.approved || feed.status === 'connecting') publish({ status: 'offline' });
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

function markUnapproved(error) {
  serverReady = false;
  publish({ status: 'unapproved', approved: false, role: null, raw: null, error });
}

async function registerDevice(client) {
  if (registeringDevice) return registeringDevice;
  if (navigator.onLine === false) {
    publish({ status: 'offline' });
    return;
  }
  const { authSDK, auth } = client;
  registeringDevice = (async () => {
    if (auth.currentUser && !auth.currentUser.isAnonymous) await authSDK.signOut(auth);
    if (!auth.currentUser) await authSDK.signInAnonymously(auth);
  })().catch(error => {
    const offline = isNetworkError(error);
    publish({ status: offline ? 'offline' : 'error', error });
    if (offline) retryConnection(client);
  }).finally(() => { registeringDevice = null; });
  return registeringDevice;
}

async function connectDevice(client, user) {
  const { fs, refs } = client;
  const token = ++generation;
  unsubscribeRoom?.();
  unsubscribeRoom = undefined;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  serverReady = false;
  const deviceId = user?.isAnonymous ? user.uid : null;
  const changedDevice = deviceId !== feed.deviceId;
  publish({
    status: 'connecting', deviceId, error: null,
    ...(changedDevice ? { approved: false, role: null, raw: null } : {}),
  });
  if (!deviceId) return registerDevice(client);
  try {
    const access = (await fs.getDoc(refs.access)).data();
    if (generation !== token) return;
    const role = roles.find(key => access?.[key] === deviceId);
    if (!role) {
      markUnapproved(dbError('not-approved', 'Thiết bị chưa được cấp quyền cho Pocket Space.'));
      return;
    }
    publish({ approved: true, role });
    unsubscribeRoom = fs.onSnapshot(refs.room, { includeMetadataChanges: true }, snapshot => {
      if (generation !== token || snapshot.metadata.hasPendingWrites) return;
      serverReady = !snapshot.metadata.fromCache && navigator.onLine !== false;
      if (serverReady) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        reconnectDelay = 3000;
      }
      publish({ status: serverReady ? 'online' : 'offline', raw: rawFrom(snapshot.data()), error: null });
    }, error => {
      if (generation !== token) return;
      serverReady = false;
      const offline = isNetworkError(error);
      if (error.code === 'permission-denied') markUnapproved(error);
      else publish({ status: offline ? 'offline' : 'error', error });
      if (offline) retryConnection(client);
    });
  } catch (error) {
    if (generation !== token) return;
    const offline = isNetworkError(error);
    if (error.code === 'permission-denied') markUnapproved(error);
    else publish({ status: offline ? 'offline' : 'error', error });
    if (offline) retryConnection(client);
  }
}

function requireDevice(actor, online = false) {
  if (!feed.approved || !feed.role) throw dbError('not-approved', 'Thiết bị chưa được cấp quyền cho Pocket Space.');
  if (actor && actor !== 'system' && actor !== feed.role) {
    throw dbError('wrong-profile', 'Thiết bị này chỉ ghi dữ liệu cho hồ sơ đã được gán.');
  }
  if (online && (!serverReady || navigator.onLine === false)) {
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

async function mutate(transform, _needsLegacyLogs, options = {}) {
  const client = await context();
  const { fs, refs } = client;
  requireDevice(options.actor, true);
  const activeGeneration = generation;
  const actor = feed.role;
  try {
    return await runRoomTransaction(client, async (transaction, current) => {
      if (activeGeneration !== generation) throw dbError('cancelled', 'Kết nối thiết bị đã thay đổi.');
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
      if (activeGeneration !== generation) throw dbError('cancelled', 'Kết nối thiết bị đã thay đổi.');
      const change = transform(raw, []);
      const { draft, logs } = change;
      if (!needsUsers && !logs.length && equal(draft.users, raw.users)
        && equal(draft.plant, raw.plant) && equal(draft.messages, raw.messages)) {
        return { ...change, revision: current.revision };
      }
      const revision = (current?.revision ?? 0) + 1;
      const historyIndex = { ...current?.historyIndex };
      const segments = logs.flatMap(entry => splitLog(entry, revision));
      for (const segment of segments) {
        historyIndex[segment.dateStr] = (historyIndex[segment.dateStr] ?? 0) + 1;
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
    if (activeGeneration === generation && error?.code !== 'cancelled') {
      const offline = isNetworkError(error);
      if (offline) serverReady = false;
      publish({ status: offline ? 'offline' : 'error', error });
      if (offline) retryConnection(client);
    }
    throw error;
  }
}

async function historyDay(dateStr) {
  const { fs, refs } = await context();
  requireDevice();
  const token = generation;
  const dayQuery = fs.query(refs.logs, fs.where('dateStr', '==', dateStr));
  async function read(useServer) {
    const [snapshot, logs] = await Promise.all([
      (useServer ? fs.getDocFromServer : fs.getDocFromCache)(refs.room),
      (useServer ? fs.getDocsFromServer : fs.getDocsFromCache)(dayQuery),
    ]);
    if (token !== generation) throw dbError('cancelled', 'Kết nối thiết bị đã thay đổi.');
    const room = snapshot.data();
    const users = room?.users ?? null;
    const entries = logs.docs.map(item => item.data());
    // Activity rows are immutable. This count and revision fence makes the
    // indexed query and the users snapshot one consistent committed view.
    if (entries.length !== (room?.historyIndex?.[dateStr] ?? 0)
      || entries.some(entry => entry.roomRevision > room?.revision)) return null;
    return { logs: entries, users };
  }
  if (serverReady) {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await read(true);
        if (snapshot) return snapshot;
      }
      throw dbError('history-retry', 'Lịch sử vừa thay đổi. Hãy thử lại.');
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const cached = await read(false);
  if (cached) return cached;
  throw dbError('history-not-cached', 'Ngày này chưa tải đủ dữ liệu để xem ngoại tuyến.');
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
};
