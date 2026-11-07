import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ACTIVITY_TITLES, BALANCE_VERSION, DAILY_WATER_MAX, DAILY_WATER_MAX_PER_PROFILE, spriteURL,
  STAGE_DAILY_INCREASES, STAGE_GROWTH_DAY_CAP, STAGE_MAINTENANCE_RATIO, STAGE_TARGETS } from '../js/catalog.js';
import { PocketDB, splitLog } from '../js/db.js';
import { DAY_MS, MINUTE_MS as MINUTE, dateStart, nextDay, today } from '../js/gameTime.js';
import { FocusState } from '../js/state.js';
import { FocusState as PeerState } from '../js/state.js?peer';

const day = '2026-11-07';
const midnight = dateStart(nextDay(day));
const noon = dateStart(day) + 12 * 60 * MINUTE;
const COOKING = 20 * MINUTE;
const FOCUS = 50 * MINUTE;
const STUDY = 40 * MINUTE;
const FOCUS_OVERLAP_GAP = FOCUS / 5;
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

test('football and playing with Cofi are profile-specific leisure sessions', async () => {
  await FocusState.open(noon);
  const activities = [
    ['ppa', 'tbv', 'home_play_with_cofi', 'Chơi với Cofi'],
    ['tbv', 'ppa', 'home_football', 'Xem bóng đá'],
  ];
  for (const [owner, other, activity, title] of activities) {
    assert.equal(ACTIVITY_TITLES.get(activity), title);
    assert.equal(spriteURL(`${other}_${activity}`), null);
    assert.ok(spriteURL(`${owner}_${activity}`).endsWith(`/sprites/${owner}/${owner}_${activity}_sheet.png`));
    assert.equal(await FocusState.changeActivity(other, activity, noon), false);
    assert.equal(await FocusState.changeActivity(owner, activity, noon), true);
    assert.equal(FocusState.elapsedMs(owner, noon + 10 * MINUTE), 10 * MINUTE);
    assert.equal(FocusState.rewardInfo(owner, noon).category, null);
  }
  for (const [owner] of activities) await FocusState.changeActivity(owner, 'home_idle', noon + 20 * MINUTE);
  const history = await FocusState.history(day);
  for (const [owner, , activity] of activities) {
    assert.equal(history.find(entry => entry.user === owner && entry.activity === activity).durationMinutes, 20);
    assert.equal(FocusState.data.users[owner].waterDropsAvailable, 0);
  }
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

test('uninterrupted cooking from 23:50 to 00:10 closes once and credits the new day', async () => {
  const start = midnight - 10 * MINUTE;
  await FocusState.open(start);
  await FocusState.changeActivity('ppa', 'home_cooking', start);
  assert.equal(FocusState.rewardInfo('ppa', start).minutes, 20);
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

test('meals keep timers and past awards but grant no new water', async () => {
  const oldDeadline = noon + 20 * MINUTE;
  room.plant = { date: day, wateringVersion: 1, rewardHistoryByDate: { [day]: { ppa: { meal: 4 } } } };
  room.users.ppa = { currentActivity: 'home_eating', startTime: noon, explicitSession: true,
    plannedEndTime: oldDeadline, waterDate: day, waterDropsAvailable: 4 };
  await FocusState.open(noon);
  assert.equal(FocusState.data.users.ppa.plannedEndTime, oldDeadline);
  assert.equal(FocusState.rewardInfo('ppa', noon).category, null);
  await FocusState.refresh(oldDeadline);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_idle');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.plant.rewardHistoryByDate[day].ppa.meal, 4);
  await FocusState.changeActivity('ppa', 'home_eating', oldDeadline);
  await FocusState.refresh(oldDeadline + 50 * MINUTE);
  assert.equal(FocusState.elapsedMs('ppa', oldDeadline + 50 * MINUTE), 50 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(logs.filter(log => log.awardedWater > 0).length, 0);
});

test('a reward earned exactly at midnight retains its new-day ledger row', async () => {
  await FocusState.open(midnight - COOKING);
  await FocusState.changeActivity('ppa', 'home_cooking', midnight - COOKING);
  await FocusState.refresh(midnight);
  assert.equal(today(midnight - 1), day);
  assert.equal(today(midnight), nextDay(day));
  const history = await FocusState.history(nextDay(day));
  assert.equal(history.find(entry => entry.kind === 'pomodoro').awardedWater, 4);
});

test('midnight expires unpoured drops and a reward due at midnight can be poured that day', async () => {
  const start = midnight - COOKING;
  await FocusState.open(start);
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', start), true);
  assert.equal(await FocusState.completeQuest('ppa', 'eat_veggies', start), false);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 1);
  room.users.tbv.waterDropsAvailable = 41;
  await FocusState.changeActivity('ppa', 'home_cooking', start);
  assert.equal(await FocusState.waterPlant('ppa', midnight), 4);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'failed');
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 0, tbv: 0 });
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 4);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, nextDay(day));
  assert.equal(await FocusState.waterPlant('ppa', midnight - 1), false);
});

test('fresh air grants one unpoured drop per profile on each Vietnam day', async () => {
  const before = midnight - 1;
  await FocusState.open(before);
  for (const profile of ['ppa', 'tbv']) {
    assert.equal(await FocusState.completeQuest(profile, 'fresh_air', before), true);
    assert.equal(await FocusState.completeQuest(profile, 'fresh_air', before), false);
    assert.equal(FocusState.data.users[profile].waterDropsAvailable, 1);
    assert.equal(FocusState.data.users[profile].waterDropsToday, 0);
  }
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  assert.equal(await FocusState.completeQuest('ppa', 'fresh_air', before), false);
  await FocusState.refresh(midnight);
  assert.deepEqual(FocusState.data.plant.dailyQuests[day], { fresh_air_ppa: true, fresh_air_tbv: true });
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  assert.equal(await FocusState.completeQuest('ppa', 'fresh_air', midnight), true);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 1);
  assert.equal(FocusState.data.plant.dropsToday, 0);
});

test('two tabs can pour the whole balance only once, even above the target', async () => {
  await FocusState.open(noon);
  const amount = STAGE_TARGETS[0] + 3;
  room.users.ppa.waterDropsAvailable = amount;
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
  assert.deepEqual(results.sort((a, b) => Number(a) - Number(b)), [false, amount]);
  assert.equal(FocusState.data.plant.dropsToday, amount);
  assert.equal(FocusState.data.plant.wilted, false);
  assert.equal(FocusState.data.plant.streakDays, 0);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: amount, tbv: 0 });
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, day);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, amount);
  assert.equal(await FocusState.waterPlant('ppa', noon), false);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.users.ppa.lastWateredDate, day);
  assert.equal(FocusState.data.users.ppa.waterDropsToday, 0);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  assert.equal(FocusState.data.plant.streakDays, 1);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: amount, tbv: 0 });
});

test('old automatic contributions survive upgrade without marking a manual pour', async () => {
  const previous = '2026-11-06';
  room.plant = {
    date: day, currentStage: 1, targetDrops: 40,
    waterHistoryByDate: { [previous]: { ppa: 20, tbv: 20 }, [day]: { ppa: 10, tbv: 0 } },
    historyStatusByDate: { [previous]: 'success' },
  };
  room.users.ppa = {
    currentActivity: 'home_cooking', startTime: noon - COOKING, explicitSession: true,
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

test('same-activity fragments preserve fractional time across reload and pay once at the exact deadline', async () => {
  const carry = 10 * MINUTE + 500;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('ppa', 'home_desk_work', noon + carry);
  const resume = noon + 20 * MINUTE;
  await FocusState.changeActivity('ppa', 'work_locked_in', resume);
  assert.equal(FocusState.data.plant.rewardProgressVersion, 1);
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  const info = FocusState.rewardInfo('ppa', resume + MINUTE);
  assert.equal(info.carriedMs, carry);
  assert.equal(info.progressMs, carry + MINUTE);
  assert.equal(info.remainingMs, FOCUS - carry - MINUTE);
  const deadline = resume + FOCUS - carry;
  assert.equal(FocusState.nextRefreshAt(resume), deadline);
  await FocusState.refresh(deadline - 1);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  await Promise.all([FocusState.refresh(deadline), PeerState.refresh(deadline)]);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 6);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_idle');
  assert.deepEqual(FocusState.data.users.ppa.rewardProgress.work_locked_in, undefined);
  assert.equal(FocusState.data.users.ppa.rewardProgress.home_desk_work.elapsedMs, resume - noon - carry);
  const rewards = logs.filter(entry => entry.kind === 'pomodoro' && entry.user === 'ppa');
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].startTimestamp, resume);
  assert.equal(rewards[0].endTimestamp, deadline);
});

test('rebalance preserves active deadlines and uses all interrupted time at the reduced target', async () => {
  room.plant = { date: day, wateringVersion: 1 };
  room.users.ppa = { currentActivity: 'home_studying', startTime: noon, explicitSession: true,
    plannedEndTime: noon + 20 * MINUTE, rewardTargetMs: 80 * MINUTE, waterDate: day, waterDropsAvailable: 5,
    rewardProgress: { home_studying: { elapsedMs: 60 * MINUTE, pairedMs: 0 } } };
  room.users.tbv = { currentActivity: 'home_idle', waterDate: day,
    rewardProgress: { home_studying: { elapsedMs: 75 * MINUTE, pairedMs: 0 } } };
  await FocusState.open(noon);
  assert.equal(FocusState.rewardInfo('ppa', noon).minutes, 80);
  assert.equal(FocusState.rewardInfo('ppa', noon).nextCreditAt, noon + 20 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 5);
  await FocusState.changeActivity('tbv', 'home_studying', noon);
  assert.equal(FocusState.rewardInfo('tbv', noon).minutes, 40);
  await FocusState.refresh(noon + 1);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.rewardProgress.home_studying.elapsedMs, 35 * MINUTE + 1);
  await FocusState.changeActivity('tbv', 'home_studying', noon + MINUTE);
  await FocusState.refresh(noon + 6 * MINUTE - 1);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 16);
  assert.equal(FocusState.data.users.tbv.rewardProgress.home_studying, undefined);
  await FocusState.refresh(noon + 20 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 13);
  await FocusState.changeActivity('ppa', 'home_studying', noon + 20 * MINUTE);
  assert.equal(FocusState.targetMs('ppa'), STUDY);
});

test('yesterday carry cannot shorten a deadline at midnight, and a cross-day interruption saves only today', async () => {
  const carry = 10 * MINUTE;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_cooking', noon);
  await FocusState.changeActivity('ppa', 'home_idle', noon + carry);
  const start = midnight - COOKING + carry;
  await FocusState.changeActivity('ppa', 'home_cooking', start);
  assert.equal(FocusState.rewardInfo('ppa', start).nextCreditAt, midnight + carry);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_cooking');
  const todayCarry = 5 * MINUTE;
  await FocusState.changeActivity('ppa', 'home_idle', midnight + todayCarry);
  const resume = midnight + 6 * MINUTE;
  await FocusState.changeActivity('ppa', 'home_cooking', resume);
  assert.equal(FocusState.rewardInfo('ppa', resume).carriedMs, todayCarry);
  await FocusState.refresh(resume + COOKING - todayCarry);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
});

test('work overlap at 80 percent earns the rounded +20 percent once per block', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  assert.equal(await FocusState.changeActivity('ppa', 'work_locked_in', noon + 2 * MINUTE), false);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon + FOCUS_OVERLAP_GAP);
  await FocusState.refresh(noon + FOCUS + FOCUS_OVERLAP_GAP);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  assert.equal(logs.filter(entry => entry.pairedBonus).length, 2);
  const again = noon + 2 * FOCUS;
  await FocusState.refresh(again);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  await FocusState.changeActivity('ppa', 'work_locked_in', again);
  await FocusState.refresh(again + FOCUS);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 14);
});

test('less than 80 percent or different groups receive only the base reward', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon + FOCUS_OVERLAP_GAP + 1);
  await FocusState.refresh(noon + FOCUS + FOCUS_OVERLAP_GAP + 1);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 6);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 6);
  const again = noon + FOCUS + FOCUS_OVERLAP_GAP + MINUTE;
  await FocusState.changeActivity('ppa', 'home_desk_work', again);
  await FocusState.changeActivity('tbv', 'home_studying', again);
  await FocusState.refresh(again + Math.max(STUDY, FOCUS));
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 12);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 14);
  assert.equal(logs.some(entry => entry.pairedBonus), false);
});

test('paired overlap accumulates across matching portions separated by a break', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon);
  await FocusState.changeActivity('tbv', 'home_gaming', noon + 20 * MINUTE);
  await FocusState.changeActivity('tbv', 'work_locked_in', noon + 25 * MINUTE);
  await FocusState.refresh(noon + 25 * MINUTE + FOCUS);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 6);
});

test('matched time from interrupted same-activity fragments counts toward the paired threshold', async () => {
  const first = 32 * MINUTE;
  const resume = noon + 40 * MINUTE;
  await FocusState.open(noon);
  for (const profile of ['ppa', 'tbv']) await FocusState.changeActivity(profile, 'work_locked_in', noon);
  for (const profile of ['ppa', 'tbv']) await FocusState.changeActivity(profile, 'home_idle', noon + first);
  await FocusState.changeActivity('ppa', 'work_locked_in', resume);
  await FocusState.changeActivity('tbv', 'work_locked_in', resume + FOCUS_OVERLAP_GAP);
  const ppaDeadline = resume + FOCUS - first;
  assert.equal(FocusState.rewardInfo('ppa', ppaDeadline).pairedRatio, 0.8);
  await FocusState.refresh(ppaDeadline + FOCUS_OVERLAP_GAP);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
});

test('the daily category cap is shared and awards any remaining portion', async () => {
  await FocusState.open(noon);
  room.plant.rewardHistoryByDate[day] = { ppa: { focus: 34, chores: 4, sport: 10, study: 24 } };
  const sessions = [
    ['work_teaching', FOCUS, 36, 2], ['home_cooking', COOKING, 8, 4],
    ['home_chores', 30 * MINUTE, 8, 0], ['out_gym', 20 * MINUTE, 20, 10],
    ['out_running', 30 * MINUTE, 20, 0], ['home_studying', STUDY, 24, 0],
  ];
  let instant = noon;
  let available = 0;
  for (const [activity, duration, cap, reward] of sessions) {
    assert.equal(await FocusState.changeActivity('ppa', activity, instant), true);
    assert.equal(FocusState.targetMs('ppa'), duration);
    assert.equal(FocusState.rewardInfo('ppa', instant).cap, cap);
    instant += duration;
    await FocusState.refresh(instant);
    available += reward;
    assert.equal(FocusState.data.users.ppa.waterDropsAvailable, available);
  }
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

test('sleep pays incremental wake-only tiers from naps ending on the same day', async () => {
  const hour = 60 * MINUTE;
  const first = midnight - 2 * hour;
  await FocusState.open(first);
  await FocusState.changeActivity('ppa', 'home_sleeping', first);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 2 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  await FocusState.changeActivity('ppa', 'home_sleeping', midnight + 3 * hour);
  assert.equal(FocusState.rewardInfo('ppa', midnight + 4 * hour).carriedMs, 4 * hour);
  assert.equal(FocusState.rewardInfo('ppa', midnight + 4 * hour).progressMs, 5 * hour);
  await FocusState.refresh(midnight + 6 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 6 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 5);
  await FocusState.changeActivity('ppa', 'home_sleeping', midnight + 7 * hour);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 8 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  await FocusState.changeActivity('ppa', 'home_sleeping', midnight + 9 * hour);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 10 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  assert.deepEqual(logs.filter(log => log.awardedWater > 0).map(log => log.awardedWater), [5, 5]);
});

test('rebalance preserves the legacy target until midnight and grows only on successful closed days', async () => {
  assert.equal(DAILY_WATER_MAX_PER_PROFILE, 109);
  assert.equal(DAILY_WATER_MAX, 218);
  assert.equal(STAGE_MAINTENANCE_RATIO, 0.85);
  assert.deepEqual(STAGE_TARGETS, [48, 69, 90, 111, 186]);
  assert.deepEqual(STAGE_DAILY_INCREASES, [1, 1, 1, 2, 0]);
  room.plant = { date: day, currentStage: 4, streakDays: 7, targetDrops: 85,
    waterHistoryByDate: { [day]: { ppa: 45, tbv: 40 } } };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.balanceVersion, BALANCE_VERSION);
  assert.equal(FocusState.data.plant.targetDrops, 85);
  assert.equal(FocusState.data.plant.stageGrowthDays, 0);
  await FocusState.refresh(midnight - 1);
  assert.equal(FocusState.data.plant.targetDrops, 85);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.targetDrops, 113);
  assert.equal(FocusState.data.plant.stageGrowthDays, 1);
  assert.equal(FocusState.data.plant.streakDays, 8);
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 113);
  assert.equal(FocusState.data.plant.stageGrowthDays, 1);
  assert.equal(FocusState.data.plant.streakDays, 3);
  room.plant.waterHistoryByDate[room.plant.date] = { ppa: 56, tbv: 57 };
  await FocusState.refresh(midnight + 2 * DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 115);
  assert.equal(FocusState.data.plant.stageGrowthDays, 2);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 45, tbv: 40 });
});

test('stage growth caps before promotion and the last stage keeps its fixed target', async () => {
  room.plant = { date: day, currentStage: 4, streakDays: 19, stageGrowthDays: STAGE_GROWTH_DAY_CAP,
    waterHistoryByDate: { [day]: { ppa: 76, tbv: 75 } } };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.targetDrops, 151);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.stageGrowthDays, STAGE_GROWTH_DAY_CAP);
  assert.equal(FocusState.data.plant.targetDrops, 151);
  room.plant.waterHistoryByDate[room.plant.date] = { ppa: 76, tbv: 75 };
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(FocusState.data.plant.currentStage, 5);
  assert.equal(FocusState.data.plant.stageGrowthDays, 0);
  assert.equal(FocusState.data.plant.streakDays, 0);
  assert.equal(FocusState.data.plant.targetDrops, 186);
  room.plant.waterHistoryByDate[room.plant.date] = { ppa: 93, tbv: 93 };
  await FocusState.refresh(midnight + 2 * DAY_MS);
  assert.equal(FocusState.data.plant.streakDays, 1);
  assert.equal(FocusState.data.plant.stageGrowthDays, 0);
  assert.equal(FocusState.data.plant.targetDrops, 186);
  await FocusState.refresh(midnight + 3 * DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 186);
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
  room.plant = { date: day, currentStage: 3, streakDays: 12, stageGrowthDays: 12, visualMilestone: 7, targetDrops: 102,
    consecutiveMissedDays: 2, shieldAvailable: true };
  await FocusState.open(midnight);
  const plant = FocusState.data.plant;
  assert.equal(plant.currentStage, 2);
  assert.equal(plant.targetDrops, STAGE_TARGETS[1]);
  assert.equal(plant.stageGrowthDays, 0);
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
  room.plant.waterHistoryByDate[resetDay] = { ppa: room.plant.targetDrops, tbv: 0 };
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
