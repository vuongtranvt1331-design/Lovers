import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ACTIVITY_TITLES, BALANCE_VERSION, DAILY_WATER_MAX, DAILY_WATER_MAX_BY_PROFILE, DAILY_WATER_MAX_PER_PROFILE, spriteURL,
  STAGE_DAILY_INCREASES, STAGE_GROWTH_DAY_CAP, STAGE_MAINTENANCE_RATIO, STAGE_TARGETS } from '../js/catalog.js';
import { PocketDB, splitLog } from '../js/db.js?v=pocket-ios-4';
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
let noteProofs;

const noteProof = options => options.noteQuest
  ? structuredClone(noteProofs.get(options.noteQuest.owner + '_' + options.noteQuest.date)) : undefined;

beforeEach(() => {
  FocusState.clearRemote();
  room = { users: {}, plant: null, messages: [], revision: 0 };
  logs = [];
  noteProofs = new Map();
  PocketDB.mutate = async (transform, needsLegacyLogs, options) => {
    assert.ok(options.actor && options.action);
    const migrationLogs = needsLegacyLogs(room) ? logs.filter(entry => entry.dateStr === room.plant?.date) : [];
    const change = transform(structuredClone(room), structuredClone(migrationLogs), noteProof(options));
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

test('Firestore map key order does not cause a false queue repair', async () => {
  await FocusState.open(noon);
  await FocusState.scheduleActivity('ppa', 'home_gaming', noon + 60 * MINUTE, 1, noon, noon);
  const version = room.users.ppa.scheduleVersion;
  room.users.ppa.activitySchedule = [{ startsAt: noon + 60 * MINUTE, activity: 'home_gaming', slot: 1 }];
  FocusState.clearRemote();
  await FocusState.open(noon + MINUTE);
  assert.equal(room.users.ppa.scheduleVersion, version);
  assert.equal(room.users.ppa.activitySchedule[0].activity, 'home_gaming');
  room.users.ppa.activitySchedule[0].obsoleteField = true;
  await FocusState.refresh(noon + MINUTE);
  assert.equal(room.users.ppa.scheduleVersion, version + 1);
  assert.deepEqual(Object.keys(room.users.ppa.activitySchedule[0]).sort(), ['activity', 'slot', 'startsAt']);
});

test('fresh profiles are idle and legacy default clocks do not earn passive rewards', async () => {
  room.users.ppa = { currentActivity: 'home_desk_work', startTime: noon - 100 * MINUTE };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.rewardReceiptVersion, 1);
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

test('profile-specific leisure sessions preserve their own timers and history', async () => {
  await FocusState.open(noon);
  const activities = [
    ['ppa', 'tbv', 'home_play_with_cofi', 'Chơi với Cofi'],
    ['tbv', 'ppa', 'home_football', 'Xem bóng đá'],
    ['ppa', 'tbv', 'travel_thailand', 'Đi chơi Thái Lan'],
  ];
  for (const [index, [owner, other, activity, title]] of activities.entries()) {
    const start = noon + index * 30 * MINUTE;
    assert.equal(ACTIVITY_TITLES.get(activity), title);
    assert.equal(spriteURL(`${other}_${activity}`), null);
    assert.ok(spriteURL(`${owner}_${activity}`).endsWith(`/sprites/${owner}/${owner}_${activity}_sheet.png`));
    assert.equal(await FocusState.changeActivity(other, activity, start), false);
    assert.equal(await FocusState.changeActivity(owner, activity, start), true);
    assert.equal(FocusState.elapsedMs(owner, start + 10 * MINUTE), 10 * MINUTE);
    assert.equal(FocusState.rewardInfo(owner, start).category, null);
    await FocusState.changeActivity(owner, 'home_idle', start + 20 * MINUTE);
  }
  const history = await FocusState.history(day);
  for (const [owner, , activity] of activities) {
    const interval = history.find(entry => entry.user === owner && entry.activity === activity);
    assert.equal(interval.durationMinutes, 20);
    assert.equal(FocusState.data.users[owner].waterDropsAvailable, 0);
  }
});

test('French study is exclusive to TBV and shares the study group while earning once per activity', async () => {
  const activity = 'home_french_studying';
  assert.equal(ACTIVITY_TITLES.get(activity), 'Học tiếng Pháp');
  assert.equal(spriteURL('ppa_' + activity), null);
  assert.ok(spriteURL('tbv_' + activity).endsWith('/tbv/tbv_home_french_studying_sheet.png'));
  await FocusState.open(noon);
  assert.equal(await FocusState.changeActivity('ppa', activity, noon), false);
  await FocusState.changeActivity('ppa', 'home_studying', noon);
  assert.equal(await FocusState.changeActivity('tbv', activity, noon), true);
  const info = FocusState.rewardInfo('tbv', noon);
  assert.deepEqual([info.minutes, info.reward, info.cap], [40, 8, 20]);
  assert.equal(FocusState.pairGroup(activity), FocusState.pairGroup('home_studying'));
  await FocusState.refresh(noon + STUDY - 1);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 0);
  await FocusState.refresh(noon + STUDY);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 10);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  assert.deepEqual(FocusState.activityRewardStatus('tbv', activity, noon + STUDY),
    { eligible: true, claimed: true, amount: 10, expected: 0 });
  assert.equal(FocusState.rewardInfo('tbv', noon + STUDY).awardedToday, 10);
  await FocusState.changeActivity('tbv', 'home_studying', noon + STUDY);
  await FocusState.refresh(noon + 2 * STUDY);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 20);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  await FocusState.changeActivity('tbv', activity, noon + 2 * STUDY);
  await FocusState.refresh(noon + 3 * STUDY);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 20);
  assert.equal(FocusState.rewardInfo('tbv', noon + 3 * STUDY).claimedToday, true);
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
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_cooking');
  assert.equal(FocusState.data.users.ppa.nextRewardAt, null);
  assert.equal(FocusState.data.plant.waterHistoryByDate[day].ppa, 0);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.plant.waterHistoryByDate[nextDay(day)].ppa, 0);
  assert.equal(await FocusState.waterPlant('ppa', midnight + 10 * MINUTE), 4);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 10 * MINUTE);
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
  assert.equal(FocusState.data.users.ppa.plannedEndTime, null);
  assert.equal(FocusState.rewardInfo('ppa', noon).category, null);
  await FocusState.refresh(oldDeadline);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_eating');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.plant.rewardHistoryByDate[day].ppa.meal, 4);
  await FocusState.changeActivity('ppa', 'home_eating', oldDeadline);
  await FocusState.refresh(oldDeadline + 50 * MINUTE);
  assert.equal(FocusState.elapsedMs('ppa', oldDeadline + 50 * MINUTE), 70 * MINUTE);
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

test('automatic Notes quest requires transaction proof and cannot be claimed manually', async () => {
  await FocusState.open(noon);
  assert.equal(await FocusState.completeQuest('ppa', 'complete_5_notes', noon), false);
  assert.equal(await FocusState.completeNotesQuest('unknown', day, noon), false);
  assert.equal(await FocusState.completeNotesQuest('ppa', nextDay(day), noon), false);
  assert.equal(await FocusState.completeNotesQuest('ppa', '2026-11-06', noon), false);
  const key = 'ppa_' + day;
  for (const proof of [
    undefined,
    { owner: 'ppa', date: day, completedCount: 4, archived: false },
    { owner: 'ppa', date: day, completedCount: 5.5, archived: false },
    { owner: 'tbv', date: day, completedCount: 5, archived: false },
    { owner: 'ppa', date: nextDay(day), completedCount: 5, archived: false },
    { owner: 'ppa', date: day, completedCount: 5, archived: true },
    { owner: 'ppa', date: day, completedCount: 5 },
  ]) {
    noteProofs.set(key, proof);
    assert.equal(await FocusState.completeNotesQuest('ppa', day, noon), false);
  }
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(FocusState.data.plant.dailyQuests[day]?.complete_5_notes_ppa, undefined);
});

test('five completed Notes grant +2 available per owner once, surviving deletion and reload', async () => {
  await FocusState.open(noon);
  for (const owner of ['ppa', 'tbv']) {
    noteProofs.set(owner + '_' + day, { owner, date: day, completedCount: 5, archived: false });
    assert.equal(await FocusState.completeNotesQuest(owner, day, noon), true);
    assert.equal(await FocusState.completeNotesQuest(owner, day, noon), false);
    assert.equal(FocusState.data.users[owner].waterDropsAvailable, 2);
    assert.equal(FocusState.data.users[owner].waterDropsToday, 0);
    assert.equal(FocusState.data.plant.dailyQuests[day]['complete_5_notes_' + owner], true);
  }
  noteProofs.set('ppa_' + day, { owner: 'ppa', date: day, completedCount: 3, archived: false });
  assert.equal(await FocusState.completeNotesQuest('ppa', day, noon), false);
  noteProofs.get('ppa_' + day).completedCount = 6;
  FocusState.clearRemote();
  await FocusState.open(noon);
  assert.equal(await FocusState.completeNotesQuest('ppa', day, noon), false);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 2);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(await FocusState.waterPlant('ppa', noon), 2);
  assert.equal(FocusState.data.plant.waterHistoryByDate[day].ppa, 2);
});

test('concurrent Notes quest claims recheck the winning room and note proof', async () => {
  await FocusState.open(noon);
  const proof = { owner: 'ppa', date: day, completedCount: 5, archived: false };
  noteProofs.set('ppa_' + day, proof);
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  const commit = PocketDB.mutate;
  let retries = 0;
  PocketDB.mutate = async (transform, legacy, options) => {
    const baseline = structuredClone(room);
    const optimistic = transform(baseline, [], noteProof(options));
    await Promise.resolve();
    return commit((raw, history, currentProof) => {
      if (raw.revision === baseline.revision) return optimistic;
      retries++;
      return transform(raw, history, currentProof);
    }, legacy, options);
  };
  const results = await Promise.all([
    FocusState.completeNotesQuest('ppa', day, noon), PeerState.completeNotesQuest('ppa', day, noon),
  ]);
  assert.deepEqual(results.sort((a, b) => Number(a) - Number(b)), [false, true]);
  assert.equal(retries, 1);
  assert.equal(room.users.ppa.waterDropsAvailable, 2);
  assert.equal(room.plant.dailyQuests[day].complete_5_notes_ppa, true);

  noteProofs.set('tbv_' + day, { owner: 'tbv', date: day, completedCount: 5, archived: false });
  PocketDB.mutate = async (transform, legacy, options) => {
    transform(structuredClone(room), [], noteProof(options));
    noteProofs.get('tbv_' + day).completedCount = 4;
    return commit(transform, legacy, options);
  };
  assert.equal(await FocusState.completeNotesQuest('tbv', day, noon), false);
  assert.equal(room.users.tbv.waterDropsAvailable, 0);
});

test('Notes quest resets at midnight and cannot reward yesterday or a future notebook', async () => {
  const owner = 'ppa';
  await FocusState.open(midnight - 1);
  noteProofs.set(owner + '_' + day, { owner, date: day, completedCount: 5, archived: false });
  assert.equal(await FocusState.completeNotesQuest(owner, day, midnight - 1), true);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  assert.equal(await FocusState.completeNotesQuest(owner, day, midnight), false);
  assert.equal(await FocusState.completeNotesQuest(owner, nextDay(nextDay(day)), midnight), false);
  assert.equal(await FocusState.completeNotesQuest(owner, nextDay(day), midnight), false);
  noteProofs.set(owner + '_' + nextDay(day), { owner, date: nextDay(day), completedCount: 5, archived: false });
  assert.equal(await FocusState.completeNotesQuest(owner, undefined, midnight), true);
  assert.equal(await FocusState.completeNotesQuest(owner, nextDay(day), midnight), false);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 2);
  assert.equal(FocusState.data.plant.dailyQuests[day].complete_5_notes_ppa, true);
  assert.equal(FocusState.data.plant.dailyQuests[nextDay(day)].complete_5_notes_ppa, true);
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

test('indexed reward history recovers exact activity claims without blocking unearned activities', async () => {
  room.plant = { date: day, balanceVersion: 1, currentStage: 5, targetDrops: 186, wateringVersion: 1,
    rewardHistoryByDate: { [day]: { ppa: { focus: 6 }, tbv: { focus: 6 } } } };
  for (const user of ['ppa', 'tbv']) {
    room.users[user] = { currentActivity: 'home_idle', waterDate: day, waterDropsAvailable: 6,
      activityRewardClaims: { home_desk_work: true, work_locked_in: true, work_teaching: true } };
    logs.push(...splitLog({ id: 'legacy-' + user, user, activity: 'work_locked_in', kind: 'pomodoro',
      startTimestamp: noon - FOCUS, endTimestamp: noon, durationMinutes: 50, waterDrops: 6, creditDate: day }, 0));
  }
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.migrationGraceDate, null);
  assert.deepEqual(FocusState.activityRewardStatus('ppa', 'work_locked_in', noon),
    { eligible: true, claimed: true, amount: 6, expected: 0 });
  assert.deepEqual(FocusState.activityRewardStatus('ppa', 'work_teaching', noon),
    { eligible: true, claimed: false, amount: 0, expected: 6 });
  assert.equal(FocusState.data.users.ppa.activityRewardClaims.home_desk_work, undefined);
  await FocusState.changeActivity('ppa', 'work_teaching', noon);
  await FocusState.refresh(noon + FOCUS);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 12);
  assert.equal(FocusState.data.users.ppa.activityRewardAmounts.work_teaching, 6);
  const snapshot = FocusState.data;
  snapshot.users.ppa.activityRewardAmounts.work_teaching = 999;
  assert.equal(FocusState.rewardInfo('ppa', noon + FOCUS).awardedToday, 6);
});

test('insufficient legacy reward history gives a neutral migration day instead of an impossible penalty', async () => {
  room.plant = { date: day, balanceVersion: 1, currentStage: 5, streakDays: 5, targetDrops: 186,
    shieldAvailable: true, consecutiveMissedDays: 2, wateringVersion: 1,
    rewardHistoryByDate: { [day]: { ppa: { focus: 6 }, tbv: { focus: 6 } } } };
  for (const user of ['ppa', 'tbv']) room.users[user] = {
    currentActivity: 'home_idle', waterDate: day, waterDropsAvailable: 6,
  };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.migrationGraceDate, day);
  assert.equal(FocusState.activityRewardStatus('ppa', 'work_teaching', noon).claimed, true);
  assert.equal(FocusState.activityRewardStatus('ppa', 'work_teaching', noon).amount, 0);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'grace');
  assert.equal(FocusState.data.plant.streakDays, 5);
  assert.equal(FocusState.data.plant.shieldAvailable, true);
  assert.equal(FocusState.data.plant.consecutiveMissedDays, 2);
  assert.equal(FocusState.data.plant.currentStage, 9);
  assert.equal(FocusState.data.plant.wilted, false);
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'grace');
});

test('a migration grace day earns normal success when actual watering reaches its quota', async () => {
  room.plant = { date: day, balanceVersion: BALANCE_VERSION, currentStage: 2, streakDays: 9,
    stageGrowthDays: 9, migrationGraceDate: day, waterHistoryByDate: { [day]: { ppa: 50, tbv: 50 } } };
  await FocusState.open(midnight);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'success');
  assert.equal(FocusState.data.plant.currentStage, 3);
  assert.equal(FocusState.data.plant.streakDays, 0);
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

test('saved hourly slots survive reload and settle rewards before exact scheduled switches', async () => {
  const hour = 60 * MINUTE;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  const initialVersion = FocusState.data.users.ppa.sessionVersion;
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_cooking', noon + hour, 1, noon, noon, 0), true);
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_gaming', noon + 2 * hour, 2, noon, noon, 1), true);
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_cooking', noon + hour, 1, noon, noon, 2), false);
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_cooking', noon + hour + 1, 1, noon, noon, 2), false);
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_cooking', noon + 3 * hour, 3, noon, noon, 2), false);
  FocusState.clearRemote();
  assert.equal(FocusState.applyRemote(room), true);
  await FocusState.refresh(noon + FOCUS);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'work_locked_in');
  assert.equal(FocusState.elapsedMs('ppa', noon + FOCUS + MINUTE), FOCUS + MINUTE);
  assert.equal(FocusState.nextRefreshAt(noon + FOCUS), noon + hour);
  await FocusState.refresh(noon + 2 * hour + 5 * MINUTE);
  const user = FocusState.data.users.ppa;
  assert.equal(user.currentActivity, 'home_gaming');
  assert.equal(user.startTime, noon + 2 * hour);
  assert.equal(user.sessionVersion, initialVersion + 2);
  assert.equal(user.scheduleVersion, 4);
  assert.equal(user.scheduleAnchorAt, null);
  assert.deepEqual(user.activitySchedule, []);
  assert.equal(user.waterDropsAvailable, 10);
  const activity = logs.filter(log => log.kind === 'activity' && log.user === 'ppa');
  assert.deepEqual(activity.map(log => [log.activity, log.durationMinutes]), [['work_locked_in', 60], ['home_cooking', 60]]);
  await FocusState.refresh(noon + 3 * hour);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_gaming');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
});

test('schedule edits use a separate version and immediate changes retain future slots', async () => {
  const hour = 60 * MINUTE;
  await FocusState.open(noon);
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  assert.equal(await FocusState.scheduleActivity('tbv', 'home_football', noon + hour, 1, noon, noon, 0), true);
  assert.equal(await PeerState.scheduleActivity('tbv', 'home_gaming', noon + hour, 1, noon, noon, 0), false);
  await FocusState.changeActivity('tbv', 'out_walking', noon);
  assert.equal(FocusState.data.users.tbv.activitySchedule[0].activity, 'home_football');
  assert.equal(await FocusState.cancelScheduledActivity('tbv', 1, noon, 0), false);
  assert.equal(await FocusState.cancelScheduledActivity('tbv', 1, noon, 1), true);
  assert.equal(await FocusState.cancelScheduledActivity('tbv', 1, noon, 2), false);
  assert.equal(FocusState.data.users.tbv.scheduleAnchorAt, null);
  assert.equal(await FocusState.scheduleActivity('ppa', 'home_football', noon + hour, 1, noon, noon), false);
  PocketDB.mutate = async () => { throw new Error('offline'); };
  await assert.rejects(FocusState.scheduleActivity('tbv', 'home_football', noon + hour, 1, noon, noon, 2), /offline/);
  assert.deepEqual(FocusState.data.users.tbv.activitySchedule, []);
});

test('invalid legacy queue entries are repaired before a valid due slot is consumed', async () => {
  await FocusState.open(noon);
  room.users.ppa.activitySchedule = [
    { slot: 1, activity: 'retired_activity', startsAt: noon + 60 * MINUTE },
    { slot: 2, activity: 'home_gaming', startsAt: noon + 120 * MINUTE },
  ];
  room.users.ppa.scheduleAnchorAt = noon;
  room.users.ppa.scheduleVersion = 4;
  const commit = PocketDB.mutate;
  let repaired = false;
  PocketDB.mutate = async (transform, legacy, options) => commit((raw, history) => {
    const change = transform(raw, history);
    if (!repaired) {
      assert.equal(change.pendingSettlement, true);
      assert.equal(change.logs.length, 0);
      assert.equal(change.draft.users.ppa.currentActivity, raw.users.ppa.currentActivity);
      assert.equal(change.draft.users.ppa.sessionVersion, raw.users.ppa.sessionVersion);
      assert.equal(change.draft.users.ppa.scheduleVersion, 5);
      assert.equal(change.draft.users.ppa.activitySchedule.length, 1);
      repaired = true;
    }
    return change;
  }, legacy, options);
  await FocusState.refresh(noon + 125 * MINUTE);
  assert.equal(repaired, true);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_gaming');
  assert.equal(FocusState.data.users.ppa.startTime, noon + 120 * MINUTE);
  assert.equal(FocusState.data.users.ppa.scheduleVersion, 6);
  assert.deepEqual(FocusState.data.users.ppa.activitySchedule, []);
});

test('same-activity scheduled slots do not re-award and a running session becomes eligible next day', async () => {
  const hour = 60 * MINUTE;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_cooking', noon);
  await FocusState.scheduleActivity('ppa', 'home_cooking', noon + hour, 1, noon, noon);
  await FocusState.refresh(noon + 2 * hour);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_cooking');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.rewardInfo('ppa', noon + 2 * hour).claimedToday, true);
  await FocusState.refresh(midnight + COOKING - 1);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 0);
  await FocusState.refresh(midnight + COOKING);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.users.ppa.startTime, noon + hour);
});

test('a reward exactly at a midnight scheduled switch is credited once to the new day', async () => {
  const anchor = midnight - 60 * MINUTE;
  const start = midnight - COOKING;
  await FocusState.open(anchor);
  await FocusState.changeActivity('ppa', 'home_cooking', start);
  await FocusState.scheduleActivity('ppa', 'home_gaming', midnight, 1, anchor, start);
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  await Promise.all([FocusState.refresh(midnight), PeerState.refresh(midnight)]);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'home_gaming');
  assert.equal(FocusState.data.users.ppa.startTime, midnight);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 4);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'failed');
  const rewards = logs.filter(log => log.kind === 'pomodoro' && log.awardedWater > 0);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].creditDate, nextDay(day));
});

test('long offline catch-up bounds transaction log writes and duplicate refreshes cannot replay rewards', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'out_running', noon);
  const commit = PocketDB.mutate;
  let writes = 0;
  PocketDB.mutate = async (transform, legacy, options) => {
    writes++;
    return commit((raw, history) => {
      const change = transform(raw, history);
      assert(change.logs.length <= 144);
      return change;
    }, legacy, options);
  };
  await FocusState.refresh(noon + 100 * DAY_MS);
  assert(writes > 1);
  const count = logs.filter(log => log.kind === 'pomodoro').length;
  assert.equal(count, 101);
  await FocusState.refresh(noon + 100 * DAY_MS);
  assert.equal(logs.filter(log => log.kind === 'pomodoro').length, count);
  assert.equal(FocusState.data.users.ppa.currentActivity, 'out_running');
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
});

test('three-day activities log every interval once across concurrent refresh and a final manual change', async () => {
  const end = noon + 3 * DAY_MS;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_gaming', noon);
  await FocusState.refresh(noon + DAY_MS);
  assert.equal(FocusState.data.users.ppa.startTime, noon);
  assert.equal(FocusState.data.users.ppa.historyLoggedThrough, midnight);
  PeerState.clearRemote();
  assert.equal(PeerState.applyRemote(room), true);
  await Promise.all([FocusState.refresh(end), PeerState.refresh(end)]);
  assert.equal(FocusState.elapsedMs('ppa', end), 3 * DAY_MS);
  await FocusState.changeActivity('ppa', 'home_idle', end);
  const intervals = logs.filter(log => log.user === 'ppa' && log.kind === 'activity' && log.activity === 'home_gaming')
    .sort((a, b) => a.startTimestamp - b.startTimestamp);
  assert.equal(intervals[0].startTimestamp, noon);
  assert.equal(intervals.at(-1).endTimestamp, end);
  assert.equal(intervals.reduce((sum, log) => sum + log.endTimestamp - log.startTimestamp, 0), 3 * DAY_MS);
  for (let index = 0; index < intervals.length; index++) {
    assert(intervals[index].endTimestamp - intervals[index].startTimestamp <= DAY_MS);
    if (index) assert.equal(intervals[index - 1].endTimestamp, intervals[index].startTimestamp);
  }
  const before = logs.length;
  await FocusState.refresh(end);
  assert.equal(logs.length, before);
  assert.equal(FocusState.data.users.ppa.historyLoggedThrough, end);
});

test('legacy long-running sessions backfill history in bounded transactions', async () => {
  const start = noon - 80 * DAY_MS;
  room.plant = { date: day, balanceVersion: BALANCE_VERSION };
  room.users.ppa = { currentActivity: 'home_gaming', startTime: start, explicitSession: true,
    waterDate: day, lastActivityTimestamp: start };
  const commit = PocketDB.mutate;
  let commits = 0;
  PocketDB.mutate = async (transform, legacy, options) => {
    commits++;
    return commit((raw, history) => {
      const change = transform(raw, history);
      assert(change.logs.length <= 144);
      return change;
    }, legacy, options);
  };
  await FocusState.open(noon);
  assert(commits > 1);
  await FocusState.changeActivity('ppa', 'home_idle', noon);
  const intervals = logs.filter(log => log.user === 'ppa' && log.activity === 'home_gaming');
  assert.equal(intervals.reduce((sum, log) => sum + log.endTimestamp - log.startTimestamp, 0), 80 * DAY_MS);
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
  assert.equal(FocusState.data.users.ppa.currentActivity, 'work_locked_in');
  assert.equal(FocusState.rewardInfo('ppa', deadline).claimedToday, true);
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
  assert.equal(FocusState.data.users.tbv.rewardProgress.home_studying, undefined);
  assert.equal(await FocusState.changeActivity('tbv', 'home_studying', noon + MINUTE), false);
  await FocusState.refresh(noon + 6 * MINUTE - 1);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.rewardProgress.home_studying, undefined);
  await FocusState.refresh(noon + 20 * MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 13);
  await FocusState.changeActivity('ppa', 'home_idle', noon + 20 * MINUTE);
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
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
});

test('less than 80 percent or different groups receive only the base reward', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon + FOCUS_OVERLAP_GAP + 1);
  await FocusState.refresh(noon + FOCUS + FOCUS_OVERLAP_GAP + 1);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 6);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
  const again = noon + FOCUS + FOCUS_OVERLAP_GAP + MINUTE;
  await FocusState.changeActivity('ppa', 'home_desk_work', again);
  await FocusState.changeActivity('tbv', 'home_studying', again);
  await FocusState.refresh(again + Math.max(STUDY, FOCUS));
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 12);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 16);
  assert.equal(logs.find(entry => entry.activity === 'work_locked_in').pairedBonus, false);
  assert.equal(logs.find(entry => entry.activity === 'home_studying').pairedBonus, false);
});

test('paired overlap accumulates across matching portions separated by a break', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'work_locked_in', noon);
  await FocusState.changeActivity('tbv', 'home_desk_work', noon);
  await FocusState.changeActivity('tbv', 'home_gaming', noon + 20 * MINUTE);
  await FocusState.changeActivity('tbv', 'work_locked_in', noon + 25 * MINUTE);
  await FocusState.refresh(noon + 25 * MINUTE + FOCUS);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 8);
  assert.equal(FocusState.data.users.tbv.waterDropsAvailable, 8);
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
  room.plant.rewardHistoryByDate[day] = { ppa: { focus: 22, chores: 4, sport: 10, study: 20 } };
  const sessions = [
    ['work_teaching', FOCUS, 24, 2], ['home_cooking', COOKING, 8, 4],
    ['home_chores', 30 * MINUTE, 8, 0], ['out_gym', 20 * MINUTE, 20, 10],
    ['out_running', 30 * MINUTE, 20, 0], ['home_studying', STUDY, 20, 0],
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
    assert.equal(FocusState.activityRewardStatus('ppa', activity, instant).amount, reward);
  }
});

test('sleep is wake-only and long sessions cannot create a history span above 24 hours', async () => {
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_sleeping', noon);
  await FocusState.refresh(noon + DAY_MS + MINUTE);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  assert.equal(FocusState.elapsedMs('ppa', noon + DAY_MS + MINUTE), DAY_MS + MINUTE);
  await FocusState.changeActivity('ppa', 'home_idle', noon + DAY_MS + MINUTE);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  assert.equal(FocusState.data.plant.dropsToday, 0);
  const intervals = logs.filter(entry => entry.kind === 'activity' && entry.user === 'ppa');
  assert(intervals.every(entry => entry.durationMinutes <= 24 * 60));
  assert.equal(intervals.reduce((sum, entry) => sum + entry.durationMinutes, 0), 24 * 60 + 1);
});

test('sleep pays only the first eligible wake from cumulative same-day sleep', async () => {
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
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 5);
  await FocusState.changeActivity('ppa', 'home_sleeping', midnight + 9 * hour);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + 10 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 5);
  assert.deepEqual(logs.filter(log => log.awardedWater > 0).map(log => log.awardedWater), [5]);
  assert.equal(FocusState.data.users.ppa.activityRewardClaims.home_sleeping, true);
  assert.deepEqual(FocusState.activityRewardStatus('ppa', 'home_sleeping', midnight + 10 * hour),
    { eligible: true, claimed: true, amount: 5, expected: 0 });
  await FocusState.changeActivity('ppa', 'home_sleeping', midnight + DAY_MS);
  await FocusState.changeActivity('ppa', 'home_idle', midnight + DAY_MS + 8 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
});

test('first eight-hour wake grants ten and a migrated paid sleep cannot earn again', async () => {
  const hour = 60 * MINUTE;
  await FocusState.open(noon);
  await FocusState.changeActivity('ppa', 'home_sleeping', noon);
  await FocusState.changeActivity('ppa', 'home_idle', noon + 8 * hour);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 10);
  assert.equal(FocusState.data.users.ppa.activityRewardClaims.home_sleeping, true);
  delete room.users.ppa.activityRewardClaims;
  await FocusState.refresh(noon + 8 * hour);
  assert.equal(FocusState.data.users.ppa.activityRewardClaims.home_sleeping, true);
  await FocusState.changeActivity('ppa', 'home_sleeping', noon + 8 * hour);
  assert.equal(FocusState.rewardInfo('ppa', noon + 9 * hour).claimedToday, true);
});

test('rebalance preserves the legacy target until midnight and grows only on successful closed days', async () => {
  assert.deepEqual(DAILY_WATER_MAX_BY_PROFILE, { ppa: 85, tbv: 95 });
  assert.equal(DAILY_WATER_MAX_PER_PROFILE, 95);
  assert.equal(DAILY_WATER_MAX, 180);
  assert.equal(STAGE_MAINTENANCE_RATIO, 0.85);
  assert.deepEqual(STAGE_TARGETS, [62, 72, 82, 92, 102, 112, 122, 132, 153]);
  assert.deepEqual(STAGE_DAILY_INCREASES, [1, 1, 1, 1, 1, 1, 1, 1, 0]);
  room.plant = { date: day, currentStage: 4, streakDays: 7, targetDrops: 85,
    waterHistoryByDate: { [day]: { ppa: 45, tbv: 40 } } };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.balanceVersion, BALANCE_VERSION);
  assert.equal(FocusState.data.plant.targetDrops, 85);
  assert.equal(FocusState.data.plant.currentStage, 7);
  assert.equal(FocusState.data.plant.stageGrowthDays, 7);
  await FocusState.refresh(midnight - 1);
  assert.equal(FocusState.data.plant.targetDrops, 85);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.targetDrops, 130);
  assert.equal(FocusState.data.plant.stageGrowthDays, 8);
  assert.equal(FocusState.data.plant.streakDays, 8);
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 125);
  assert.equal(FocusState.data.plant.stageGrowthDays, 3);
  assert.equal(FocusState.data.plant.streakDays, 3);
  room.plant.waterHistoryByDate[room.plant.date] = { ppa: 62, tbv: 63 };
  await FocusState.refresh(midnight + 2 * DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 126);
  assert.equal(FocusState.data.plant.stageGrowthDays, 4);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 45, tbv: 40 });
});

test('stage growth caps before promotion and the last stage keeps its fixed target', async () => {
  room.plant = { date: day, balanceVersion: BALANCE_VERSION, currentStage: 8, streakDays: 9, stageGrowthDays: STAGE_GROWTH_DAY_CAP,
    waterHistoryByDate: { [day]: { ppa: 71, tbv: 70 } } };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.targetDrops, 141);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.currentStage, 9);
  assert.equal(FocusState.data.plant.stageGrowthDays, 0);
  assert.equal(FocusState.data.plant.streakDays, 0);
  assert.equal(FocusState.data.plant.targetDrops, 153);
  assert.equal(FocusState.data.plant.stageEvolutionAt, midnight);
  assert.equal(FocusState.data.plant.stageEvolutionFrom, 8);
  room.plant.waterHistoryByDate[room.plant.date] = { ppa: 76, tbv: 77 };
  await FocusState.refresh(midnight + DAY_MS);
  assert.equal(FocusState.data.plant.streakDays, 1);
  assert.equal(FocusState.data.plant.stageGrowthDays, 0);
  assert.equal(FocusState.data.plant.targetDrops, 153);
  await FocusState.refresh(midnight + 2 * DAY_MS);
  assert.equal(FocusState.data.plant.targetDrops, 153);
});

test('the existing stage-nine 150-drop quota stays frozen until midnight without remapping stages', async () => {
  room.plant = { date: day, balanceVersion: BALANCE_VERSION, currentStage: 9, streakDays: 4,
    targetDrops: 150, lastEvaluationDate: '2026-11-06',
    waterHistoryByDate: { [day]: { ppa: 75, tbv: 75 } } };
  room.users.ppa = { currentActivity: 'home_idle', waterDate: day, waterDropsToday: 75, waterDropsAvailable: 7 };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.balanceVersion, BALANCE_VERSION);
  assert.equal(FocusState.data.plant.currentStage, 9);
  assert.equal(FocusState.data.plant.targetDrops, 150);
  assert.equal(FocusState.data.plant.legacyTargetDate, day);
  assert.equal(FocusState.data.users.ppa.waterDropsAvailable, 7);
  FocusState.clearRemote();
  await FocusState.open(midnight - 1);
  assert.equal(FocusState.data.plant.targetDrops, 150);
  await FocusState.refresh(midnight);
  assert.equal(FocusState.data.plant.historyStatusByDate[day], 'success');
  assert.equal(FocusState.data.plant.streakDays, 5);
  assert.equal(FocusState.data.plant.currentStage, 9);
  assert.equal(FocusState.data.plant.targetDrops, 153);
  assert.equal(FocusState.data.plant.legacyTargetDate, null);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[day], { ppa: 75, tbv: 75 });
});

test('all legacy five-stage profiles migrate without an evolution effect and retain reachable daily targets', async () => {
  for (let oldStage = 1; oldStage <= 5; oldStage++) {
    FocusState.clearRemote();
    room = { users: {}, messages: [], revision: 0, plant: { date: day, balanceVersion: 1,
      currentStage: oldStage, streakDays: 12, targetDrops: oldStage === 5 ? 186 : 48 + (oldStage - 1) * 21 } };
    await FocusState.open(noon);
    const plant = FocusState.data.plant;
    assert.equal(plant.currentStage, oldStage === 5 ? 9 : oldStage * 2);
    assert.equal(plant.streakDays, oldStage === 5 ? 9 : 2);
    assert.equal(plant.stageEvolutionAt, null);
    assert.equal(plant.targetDrops, oldStage === 5 ? STAGE_TARGETS.at(-1) : 48 + (oldStage - 1) * 21);
  }
});

test('an unreachable legacy 186-drop target migrates to 153 while preserving water and history', async () => {
  const previous = '2026-11-06';
  room.plant = { date: day, balanceVersion: 1, currentStage: 5, targetDrops: 186,
    waterHistoryByDate: { [previous]: { ppa: 93, tbv: 93 }, [day]: { ppa: 92, tbv: 94 } },
    historyStatusByDate: { [previous]: 'success' } };
  room.users.ppa = { currentActivity: 'home_idle', waterDate: day, waterDropsToday: 92, waterDropsAvailable: 7 };
  room.users.tbv = { currentActivity: 'home_idle', waterDate: day, waterDropsToday: 94, waterDropsAvailable: 9 };
  await FocusState.open(noon);
  assert.equal(FocusState.data.plant.currentStage, 9);
  assert.equal(FocusState.data.plant.targetDrops, 153);
  assert.equal(FocusState.data.plant.legacyTargetDate, null);
  assert.equal(FocusState.data.plant.dropsToday, 186);
  assert.deepEqual([FocusState.data.users.ppa.waterDropsAvailable, FocusState.data.users.tbv.waterDropsAvailable], [7, 9]);
  assert.deepEqual(FocusState.data.plant.waterHistoryByDate[previous], { ppa: 93, tbv: 93 });
  assert.equal(FocusState.data.plant.historyStatusByDate[previous], 'success');
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
  room.plant = { date: day, balanceVersion: BALANCE_VERSION, currentStage: 3, streakDays: 8, stageGrowthDays: 8, visualMilestone: 7, targetDrops: 90,
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

test('a consumed day-seven shield cannot unlock again in the same stage', async () => {
  room.plant = { date: day, balanceVersion: BALANCE_VERSION, currentStage: 2, streakDays: 8, stageGrowthDays: 8, visualMilestone: 7,
    shieldAvailable: true };
  await FocusState.open(midnight);
  assert.equal(FocusState.data.plant.visualMilestone, 7);
  let plant = FocusState.data.plant;
  assert.equal(plant.streakDays, 8);
  assert.equal(plant.shieldAvailable, false);
  assert.equal(plant.visualMilestone, 7);

  const resetDay = plant.date;
  room.plant.streakDays = 6;
  room.plant.waterHistoryByDate[resetDay] = { ppa: room.plant.targetDrops, tbv: 0 };
  await FocusState.refresh(midnight + DAY_MS);
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
