import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { PocketDB, splitLog } from '../js/db.js';
import { DAY_MS, MINUTE_MS as MINUTE, dateStart, nextDay, today } from '../js/gameTime.js';
import { FocusState } from '../js/state.js';
import { FocusState as PeerState } from '../js/state.js?peer';

const day = '2026-11-07';
const midnight = dateStart(nextDay(day));
const noon = dateStart(day) + 12 * 60 * MINUTE;
let room;
let logs;

beforeEach(() => {
  FocusState.clearRemote();
  room = { users: {}, plant: null, messages: [], revision: 0 };
  logs = [];
  PocketDB.mutate = async (transform, _needsLegacyLogs, options) => {
    assert.ok(options.actor && options.action);
    const change = transform(structuredClone(room), []);
    const current = { users: room.users, plant: room.plant, messages: room.messages };
    const changed = JSON.stringify(current) !== JSON.stringify(change.draft) || change.logs.length;
    const revision = room.revision + Number(Boolean(changed));
    room = { ...structuredClone(change.draft), revision };
    logs.push(...change.logs.flatMap(entry => splitLog(entry, revision)));
    return { ...change, revision };
  };
  PocketDB.historyDay = async date => ({
    logs: structuredClone(logs.filter(entry => entry.dateStr === date)),
    users: structuredClone(room.users),
  });
});

test('fresh profiles are idle and legacy default clocks do not earn passive rewards', async () => {
  room.users.ppa = { currentActivity: 'home_desk_work', startTime: noon - 100 * MINUTE };
  await FocusState.open(noon);
  for (const user of Object.values(FocusState.data.users)) {
    assert.equal(user.currentActivity, 'home_idle');
    assert.equal(user.startTime, null);
    assert.equal(user.sessionVersion, 1);
    assert.equal(user.waterDropsAvailable, 0);
    assert.equal(user.lastWateredDate, null);
  }
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(logs.length, 0);
});

test('rest clocks survive reload and log their own time across midnight without water', async () => {
  await FocusState.open(midnight - 10 * MINUTE);
  await FocusState.changeActivity('ppa', 'home_gaming', midnight - 5 * MINUTE);
  await FocusState.changeActivity('ppa', 'home_idle', midnight - MINUTE);

  FocusState.clearRemote();
  await FocusState.open(midnight + MINUTE);
  assert.equal(FocusState.elapsedMs('ppa', midnight + MINUTE), 2 * MINUTE);
  assert.equal(FocusState.elapsedMs('tbv', midnight + MINUTE), 11 * MINUTE);

  await FocusState.changeActivity('ppa', 'home_gaming', midnight + MINUTE);
  const rest = logs.filter(entry => entry.user === 'ppa' && entry.activity === 'home_idle');
  assert.deepEqual(rest.map(entry => [entry.dateStr, entry.durationMinutes]), [
    [day, 5], [day, 1], [nextDay(day), 1],
  ]);
  assert.equal(FocusState.data.plant.dropsToday, 0);
});

test('an explicit meal from 23:50 to 00:10 closes once and credits the new day', async () => {
  await FocusState.open(midnight - 10 * MINUTE);
  await FocusState.changeActivity('ppa', 'home_eating', midnight - 10 * MINUTE, 1);
  await FocusState.refresh(midnight + 10 * MINUTE - 1);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  await FocusState.refresh(midnight + 10 * MINUTE);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_idle');
  assert.equal(FocusState.data.plant.waterHistoryByDate[day].ppa, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.plant.waterHistoryByDate[nextDay(day)].ppa, 0);
  assert.equal(await FocusState.waterPlant('ppa', midnight + 10 * MINUTE), 4);
  assert.equal(FocusState.data.plant.waterHistoryByDate[nextDay(day)].ppa, 4);
  const before = await FocusState.historySnapshot(day);
  const after = await FocusState.historySnapshot(nextDay(day));
  for (const snapshot of [before, after]) {
    assert.equal(snapshot.logs.find(entry => entry.kind === 'activity').durationMinutes, 10);
    assert.equal(snapshot.users.ppa.currentActivity, 'home_idle');
  }
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(logs.filter(entry => entry.awardedWater === 4).length, 1);
});

test('a reward earned exactly at midnight retains its new-day ledger row', async () => {
  await FocusState.open(midnight - 20 * MINUTE);
  await FocusState.changeActivity('ppa', 'home_eating', midnight - 20 * MINUTE);
  await FocusState.refresh(midnight);
  assert.equal(today(midnight - 1), day);
  assert.equal(today(midnight), nextDay(day));
  const history = await FocusState.history(nextDay(day));
  assert.equal(history.find(entry => entry.kind === 'pomodoro').awardedWater, 4);
});

test('midnight expires unpoured drops and a reward due at midnight can be poured that day', async () => {
  const start = midnight - 20 * MINUTE;
  await FocusState.open(start);
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', start), true);
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', start), false);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 1);
  room.users.tbv.waterDropsAvailable = 41;
  await FocusState.changeActivity('ppa', 'home_eating', start);
  assert.equal(await FocusState.waterPlant('ppa', midnight), 4);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'failed');
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 0, tbv: 0 });
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 4);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, nextDay(day));
  assert.equal(await FocusState.waterPlant('ppa', midnight - 1), false);
});

test('two tabs can pour the whole balance only once, even above the target', async () => {
  await FocusState.open(noon);
  room.users.ppa.waterDropsAvailable = 43;
  room.users.tbv.waterDropsAvailable = 8;
  room.plant.wilted = true;
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  const commit = PocketDB.mutate;
  let retries = 0;
  PocketDB.mutate = async (transform, legacy, options) => {
    const baseline = structuredClone(room);
    const optimistic = transform(baseline, []);
    await Promise.resolve();
    return commit((raw, logs) => {
      if (raw.revision === baseline.revision) return optimistic;
      retries++;
      return transform(raw, logs);
    }, legacy, options);
  };
  const results = await Promise.all([FocusState.waterPlant('ppa', noon), PeerState.waterPlant('ppa', noon)]);
  assert.equal(retries, 1);
  assert.deepEqual(results.sort((a, b) => Number(a) - Number(b)), [false, 43]);
  assert.equal(FocusState.data.plant.dropsToday, 43);
  assert.equal(FocusState.data.plant.wilted, false);
  assert.equal(FocusState.data.plant.streakDays, 0);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 43, tbv: 0 });
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, day);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 43);
  assert.equal(await FocusState.waterPlant('ppa', noon), false);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, day);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 0);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  assert.equal(FocusState.data.plant.streakDays, 1);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 43, tbv: 0 });
});

test('old automatic contributions survive upgrade without marking a manual pour', async () => {
  const previous = '2026-11-06';
  room.plant = {
    date: day, currentStage: 1, targetDrops: 40,
    waterHistoryByDate: { [previous]: { ppa: 20, tbv: 20 }, [day]: { ppa: 10, tbv: 0 } },
    historyStatusByDate: { [previous]: 'success' },
  };
  room.users.ppa = {
    currentActivity: 'home_eating', startTime: noon - 20 * MINUTE, explicitSession: true,
    waterDate: day, waterDropsToday: 10,
  };
  await FocusState.open(noon);
  assert.equal(room.plant.wateringVersion, 1);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 14);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, null);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[previous], { ppa: 20, tbv: 20 });
  assert.equal(FocusState.data.plant.historyStatusByDate[previous], 'success');
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', noon), true);
  assert.equal(FocusState.data.plant.dropsToday, 14);
  assert.equal(await FocusState.waterPlant('ppa', noon), 1);
  assert.equal(FocusState.data.plant.dropsToday, 15);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, day);
});

test('stale revisions and timestamps cannot overwrite a newer activity or a closed day', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_gaming', noon + MINUTE, 1);
  const version = FocusState.data.users.ppa.sessionVersion;
  const revision = room.revision;
  assert.equal(await FocusState.changeActivity('ppa', 'home_eating', noon + 2 * MINUTE, version - 1), false);
  assert.equal(await FocusState.changeActivity('ppa', 'home_eating', noon, version), false);
  assert.equal(room.revision, revision);
  await FocusState.refresh(midnight);
  const settled = structuredClone(room);
  assert.equal(await FocusState.changeActivity('ppa', 'home_eating', midnight - MINUTE, version), false);
  assert.deepEqual(room, settled);
});

test('slight partner clock skew is accepted without backdating the shared interval', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon + 1_000, 1);
  assert.equal(await FocusState.changeActivity('tbv', 'home_desk_work', noon, 1), true);
  assert.equal(FocusState.data.users.tbv.startTime, noon + 1_000);
});

test('work overlap at 80 percent earns the rounded +20 percent once per block', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  assert.equal(await FocusState.changeActivity('ppa', 'work_locked_in', noon + 2 * MINUTE), false);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon + 5 * MINUTE);
  await FocusState.refresh(noon + 30 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  assert.equal(logs.filter(entry => entry.pairedBonus).length, 2);
  await FocusState.refresh(noon + 70 * MINUTE);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon + 70 * MINUTE);
  await FocusState.refresh(noon + 95 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 14);
});

test('less than 80 percent or different groups receive only the base reward', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon + 5 * MINUTE + 1);
  await FocusState.refresh(noon + 30 * MINUTE + 1);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 6);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 6);
  await FocusState.changeActivity('ppa', 'home_desk_work', noon + 31 * MINUTE);
  await FocusState.changeActivity('tbv', 'home_studying', noon + 31 * MINUTE);
  await FocusState.refresh(noon + 61 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 12);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 14);
  assert.equal(logs.some(entry => entry.pairedBonus), false);
});

test('paired overlap accumulates across matching portions separated by a break', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon);
  await FocusState.changeActivity('tbv', 'home_gaming', noon + 10 * MINUTE);
  await FocusState.changeActivity('tbv', 'work_locked_in', noon + 13 * MINUTE);
  await FocusState.refresh(noon + 38 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 6);
});

test('sleep is wake-only and long sessions cannot create a history span above 24 hours', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_sleeping', noon);
  await FocusState.refresh(noon + DAY_MS + MINUTE);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(FocusState.elapsedMs('ppa', noon + DAY_MS + MINUTE), DAY_MS);
  await FocusState.changeActivity('ppa', 'home_idle', noon + DAY_MS + MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(logs.filter(entry => entry.kind === 'activity')
    .reduce((sum, entry) => sum + entry.durationMinutes, 0), 24 * 60);
});

test('a finalized day seven grants a shield and a missed day consumes it without subtracting five', async () => {
  room.plant = { date: day, currentStage: 1, streakDays: 6, targetDrops: 40,
    waterHistoryByDate: { [day]: { ppa: 20, tbv: 20 } } };
  await FocusState.open(midnight - 1);
  assert.equal(FocusState.data.plant.shieldAvailable, false);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.streakDays, 7);
  assert.equal(FocusState.data.plant.shieldAvailable, true);
  assert.equal(FocusState.data.plant.visualMilestone, 7);
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(FocusState.data.plant.streakDays, 7);
  assert.equal(FocusState.data.plant.wilted, true);
  assert.equal(FocusState.data.plant.shieldAvailable, false);
  assert.equal(FocusState.data.plant.lastShieldUseDate, nextDay(day));
  await FocusState.refresh(midnight + 2 * DAY_MS);
  assert.equal(FocusState.data.plant.streakDays, 2);
  assert.equal(FocusState.data.plant.visualMilestone, 7);
});

test('the third miss can demote through a shield and resets stage-specific visual progress', async () => {
  room.plant = { date: day, currentStage: 3, streakDays: 12, visualMilestone: 7, targetDrops: 70,
    consecutiveMissedDays: 2, shieldAvailable: true };
  await FocusState.open(midnight);
  const plant = FocusState.data.plant;
  assert.equal(plant.currentStage, 2);
  assert.equal(plant.targetDrops, 55);
  assert.equal(plant.streakDays, 0);
  assert.equal(plant.visualMilestone, 0);
  assert.equal(plant.lastShieldUseDate, day);
});

test('day fourteen does not stack shields and day seven cannot unlock again in the same stage', async () => {
  room.plant = { date: day, currentStage: 2, streakDays: 13, visualMilestone: 7, targetDrops: 55,
    shieldAvailable: true, waterHistoryByDate: { [day]: { ppa: 30, tbv: 25 } } };
  await FocusState.open(midnight);
  assert.equal(FocusState.data.plant.visualMilestone, 14);
  await FocusState.refresh(midnight + 2 * DAY_MS);
  let plant = FocusState.data.plant;
  assert.equal(plant.streakDays, 9);
  assert.equal(plant.shieldAvailable, false);
  assert.equal(plant.visualMilestone, 14);

  const resetDay = plant.date;
  room.plant.streakDays = 6;
  room.plant.waterHistoryByDate[resetDay] = { ppa: 30, tbv: 25 };
  await FocusState.refresh(midnight + 3 * DAY_MS);
  plant = FocusState.data.plant;
  assert.equal(plant.streakDays, 7);
  assert.equal(plant.shieldAvailable, false);
});

test('couple quests credit neither until the recipient confirms and then give +2 each once', async () => {
  await FocusState.open(noon);
  assert.equal(await FocusState.completeQuest('ppa', 'hug_5s', noon), false);
  const request = await FocusState.requestQuest('ppa', 'hug_5s', noon);
  assert.equal(request.questStatus, 'pending');
  assert.equal(request.to, 'tbv');
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(await FocusState.requestQuest('tbv', 'hug_5s', noon), null);
  assert.equal(await FocusState.respondToQuest('ppa', request.id, true, noon), false);
  const results = await Promise.all([
    FocusState.respondToQuest('tbv', request.id, true, noon),
    FocusState.respondToQuest('tbv', request.id, true, noon),
  ]);
  assert.deepEqual(results, [true, false]);
  assert.equal(FocusState.data.messages[0].questStatus, 'confirmed');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 2);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 2);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 0, tbv: 0 });
  assert.equal(FocusState.data.plant.dailyQuests[day].hug_5s_pair, true);
});

test('far-future clock jumps and offline writes reject without changing committed state', async () => {
  await FocusState.open(noon);
  const current = structuredClone(room);
  await assert.rejects(FocusState.refresh(noon + 367 * DAY_MS), { code: 'clock-range' });
  assert.deepEqual(room, current);
  PocketDB.mutate = async () => { throw new Error('offline'); };
  await assert.rejects(FocusState.completeQuest('ppa', 'eat_veggies', noon), /offline/);
  assert.equal(FocusState.data.plant.dropsToday, 0);
});

test('an older committed action still returns its result without rolling the UI back', async () => {
  await FocusState.open(noon);
  const previous = structuredClone(room);
  const current = { ...structuredClone(room), revision: room.revision + 2 };
  current.users.ppa.waterDropsToday = 5;
  current.plant.waterHistoryByDate[day].ppa = 5;
  current.plant.dropsToday = 5;
  PocketDB.mutate = async transform => {
    const change = transform(previous, []);
    assert.equal(FocusState.applyRemote(current), true);
    return { ...change, revision: current.revision - 1 };
  };
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', noon), true);
  assert.equal(FocusState.data.plant.dropsToday, 5);
  assert.equal(FocusState.applyRemote(previous), false);
  FocusState.clearRemote();
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_idle');
  assert.equal(FocusState.persisted, false);
});
