import { BALANCE_VERSION, canSelectActivity, DAILY_QUESTS, STAGE_DAILY_INCREASES, STAGE_GROWTH_DAY_CAP,
  STAGE_TARGETS, WATER_ACTIVITY_MINUTES, WATER_REWARDS } from './catalog.js?v=notes-board';
import { PocketDB } from './db.js?v=notes-board';
import { DAY_MS, MINUTE_MS as MINUTE, dateStart, nextDay, offsetDay, timestamp, today } from './gameTime.js';

export const FocusState = (() => {
  const USERS = ['ppa', 'tbv'];
  const QUESTS = new Map(DAILY_QUESTS.map(quest => [quest.id, quest]));
  const PAIR_QUESTS = DAILY_QUESTS.filter(quest => quest.pair);
  const QUEST_CLAIM_KEYS = new Set(DAILY_QUESTS.flatMap(quest => [
    ...USERS.map(user => quest.id + '_' + user), ...(quest.pair ? [quest.id + '_pair'] : []),
  ]));
  const LEGACY_STAGE_TARGETS = [40, 55, 70, 85, 100];
  const WATERED_DAYS_PER_STAGE = 21;
  const STREAK_LOSS_PER_MISSED_DAY = 5;
  const MISSED_DAYS_PER_DROP = 3;
  const MAX_CATCH_UP_DAYS = 366;
  const MANUAL_WATERING_VERSION = 1;
  const SLEEP_TIERS = WATER_REWARDS.sleep.tiers;
  const SLEEP_TARGET_MS = SLEEP_TIERS.at(-1).minutes * MINUTE;
  const LEGACY_MINUTES = { study: 30, focus: 25, sport: 30, chores: 20 };
  const PREVIOUS_MINUTES = { study: 80, focus: 70, home_chores: 60 };
  const PREVIOUS_MEAL_MS = 20 * MINUTE;
  const REWARD_CATEGORY = {
    home_sleeping: 'sleep', home_studying: 'study',
    home_desk_work: 'focus', work_locked_in: 'focus', work_teaching: 'focus', office_focus_typing: 'focus',
    out_running: 'sport', out_gym: 'sport', home_cooking: 'chores', home_chores: 'chores',
  };
  const activityRules = new Map(Object.entries(REWARD_CATEGORY).map(([activity, category]) => {
    const rule = WATER_REWARDS[category];
    const minutes = WATER_ACTIVITY_MINUTES[activity] ?? rule.minutes;
    return [activity, { ...rule, minutes, legacyMinutes: LEGACY_MINUTES[category],
      previousMinutes: PREVIOUS_MINUTES[activity] ?? PREVIOUS_MINUTES[category] ?? minutes }];
  }));
  const MESSAGE_LIMIT = 160;
  const IDLE = 'home_idle';
  let model = null;
  let persisted = false;
  let revision = -1;
  let generation = 0;
  let queue = Promise.resolve();
  let idSequence = 0;

  const time = value => timestamp(value) ?? Date.now();
  const bounded = (value, fallback, max = Number.MAX_SAFE_INTEGER) =>
    Number.isFinite(value) ? Math.min(max, Math.max(0, Math.trunc(value))) : fallback;
  const ruleFor = activity => activityRules.get(activity);
  const stageTarget = (stage, growthDays) => STAGE_TARGETS[stage - 1] + STAGE_DAILY_INCREASES[stage - 1] * growthDays;
  const carryLimit = rule => Math.max(rule.minutes, rule.previousMinutes, rule.legacyMinutes) * MINUTE - 1;
  const legacyReward = activity => activity === 'out_running' ? 15 : 10;
  const userKey = value => {
    const key = typeof value === 'string' ? value.toLowerCase() : '';
    return USERS.includes(key) ? key : '';
  };

  function id(prefix) {
    const token = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) +
      '-' + (++idSequence).toString(36) + '-' + Math.random().toString(36).slice(2);
    return prefix + '-' + token;
  }

  function readRewardProgress(key, raw) {
    const progress = {};
    for (const [activity, entry] of Object.entries(raw || {})) {
      const rule = ruleFor(activity);
      if (!rule || !canSelectActivity(key, activity)) continue;
      const limit = rule.wakeOnly ? SLEEP_TARGET_MS : carryLimit(rule);
      const elapsedMs = bounded(entry?.elapsedMs, 0, limit);
      if (elapsedMs) progress[activity] = {
        elapsedMs, pairedMs: rule.pairGroup ? bounded(entry?.pairedMs, 0, elapsedMs) : 0,
      };
    }
    return progress;
  }

  function readRewardTarget(rule, raw) {
    if (!rule?.minutes) return null;
    const saved = raw.rewardTargetMs;
    if (Number.isSafeInteger(saved) && [rule.minutes, rule.previousMinutes, rule.legacyMinutes].includes(saved / MINUTE)) return saved;
    // Existing sessions keep the deadline persisted before targets increased.
    return (Object.hasOwn(raw, 'rewardProgress') ? rule.previousMinutes : rule.legacyMinutes) * MINUTE;
  }

  function activityDeadline(activity, start, target, progress, day) {
    if (start === null) return null;
    const rule = ruleFor(activity);
    if (rule?.wakeOnly) return null;
    if (!rule) return start + DAY_MS;
    const full = start + target;
    if (today(start) !== day) return full;
    const shortened = start + Math.max(1, target - (progress[activity]?.elapsedMs ?? 0));
    // A continuous session can cross midnight, but yesterday's saved fragments expire.
    return today(shortened) === today(start) ? shortened : full;
  }

  function readUser(key, raw, day) {
    const savedStart = timestamp(raw?.startTime);
    // Pre-upgrade saves did not distinguish a selected activity from the default clock.
    const explicitSession = raw?.explicitSession === true && savedStart !== null
      && canSelectActivity(key, raw.currentActivity) && raw.currentActivity !== IDLE;
    const currentActivity = explicitSession ? raw.currentActivity : IDLE;
    const startTime = explicitSession ? savedStart : null;
    const idleStartedAt = raw?.currentActivity === IDLE
      ? timestamp(raw.idleStartedAt) ?? timestamp(raw.lastActivityTimestamp) : null;
    const rewardProgress = raw?.waterDate === day ? readRewardProgress(key, raw.rewardProgress) : {};
    const rewardTargetMs = readRewardTarget(ruleFor(currentActivity), raw);
    const legacyMealDeadline = currentActivity === 'home_eating' && raw.plannedEndTime === startTime + PREVIOUS_MEAL_MS
      ? raw.plannedEndTime : null;
    const pairedFocusMs = explicitSession ? bounded(raw.pairedFocusMs, 0, rewardTargetMs ?? 0) : 0;
    const pairedFocusThrough = explicitSession ? Math.max(startTime, timestamp(raw.pairedFocusThrough) ?? startTime) : null;
    const pairedFocusTodayMs = explicitSession ? bounded(raw.pairedFocusTodayMs,
      today(startTime) === today(pairedFocusThrough) ? pairedFocusMs : 0, pairedFocusMs) : 0;
    return {
      id: key,
      user: key,
      currentActivity,
      startTime,
      idleStartedAt,
      plannedEndTime: legacyMealDeadline ?? activityDeadline(currentActivity, startTime, rewardTargetMs, rewardProgress, day),
      explicitSession,
      sessionVersion: Math.max(1, bounded(raw?.sessionVersion, 1)),
      lastActivityTimestamp: timestamp(raw?.lastActivityTimestamp) ?? savedStart,
      waterDropsToday: raw?.waterDate === day ? bounded(raw.waterDropsToday, 0) : 0,
      waterDropsAvailable: raw?.waterDate === day ? bounded(raw.waterDropsAvailable, 0) : 0,
      waterDate: day,
      rewardProgress,
      rewardTargetMs,
      lastWateredDate: dateStart(raw?.lastWateredDate) !== null && raw.lastWateredDate <= day
        ? raw.lastWateredDate : null,
      creditedActivityStartTime: explicitSession && raw.creditedActivityStartTime === startTime ? startTime : null,
      oneTimeRewardHandled: explicitSession && raw.oneTimeRewardHandled === true,
      pairedFocusMs,
      pairedFocusThrough,
      pairedFocusTodayMs,
    };
  }

  function categories(raw) {
    return Object.fromEntries([...Object.keys(WATER_REWARDS), 'meal'].map(key => [key, bounded(raw?.[key], 0)]));
  }

  function dayCategories(raw) {
    return { ppa: categories(raw?.ppa), tbv: categories(raw?.tbv) };
  }

  function readDailyQuests(raw, date) {
    return Object.fromEntries(Object.entries(raw || {})
      .filter(([day, claims]) => dateStart(day) !== null && day <= date && claims && typeof claims === 'object')
      .map(([day, claims]) => {
        const accepted = Object.fromEntries(Object.entries(claims)
          .filter(([claim, done]) => done === true && QUEST_CLAIM_KEYS.has(claim)));
        for (const quest of PAIR_QUESTS) {
          if (USERS.some(user => accepted[quest.id + '_' + user])) accepted[quest.id + '_pair'] = true;
        }
        return [day, accepted];
      }));
  }

  function readPlant(raw, now) {
    const storedDate = dateStart(raw?.date) !== null ? raw.date : null;
    const date = storedDate ?? today(now);
    const historyStatusByDate = Object.fromEntries(Object.entries(raw?.historyStatusByDate || {})
      .filter(([key, status]) => dateStart(key) !== null && key <= date
        && (status === 'success' || status === 'failed')));
    const waterHistoryByDate = Object.fromEntries(Object.entries(raw?.waterHistoryByDate || {})
      .filter(([key]) => dateStart(key) !== null && key <= date)
      .map(([key, totals]) => [key, { ppa: bounded(totals?.ppa, 0), tbv: bounded(totals?.tbv, 0) }]));
    const rewardHistoryByDate = Object.fromEntries(Object.entries(raw?.rewardHistoryByDate || {})
      .filter(([key]) => dateStart(key) !== null && key <= date)
      .map(([key, totals]) => [key, dayCategories(totals)]));
    const currentStage = Math.max(1, bounded(raw?.currentStage, 1, 5));
    const stageGrowthDays = currentStage < 5 ? bounded(raw?.stageGrowthDays, 0, STAGE_GROWTH_DAY_CAP) : 0;
    const streakDays = bounded(raw?.streakDays, bounded(raw?.consecutiveWateredDays, 0, WATERED_DAYS_PER_STAGE),
      WATERED_DAYS_PER_STAGE);
    const evaluatedDate = dateStart(raw?.lastEvaluationDate) !== null && raw.lastEvaluationDate <= date
      ? raw.lastEvaluationDate : null;
    const lastEvaluationDate = storedDate && !Object.hasOwn(raw, 'lastEvaluationDate')
      ? offsetDay(storedDate, -1) : evaluatedDate;
    return {
      id: 'bonsai',
      currentStage,
      stageGrowthDays,
      streakDays,
      shieldAvailable: raw?.shieldAvailable === true,
      visualMilestone: [0, 7, 14].includes(raw?.visualMilestone) ? raw.visualMilestone
        : streakDays >= 14 ? 14 : streakDays >= 7 ? 7 : 0,
      lastShieldUseDate: dateStart(raw?.lastShieldUseDate) !== null && raw.lastShieldUseDate <= date
        ? raw.lastShieldUseDate : null,
      consecutiveMissedDays: bounded(raw?.consecutiveMissedDays, bounded(raw?.consecutiveFailedDays, 0)),
      lastEvaluationDate,
      historyStatusByDate,
      waterHistoryByDate,
      rewardHistoryByDate,
      dailyQuests: readDailyQuests(raw?.dailyQuests, date),
      wilted: raw?.wilted === true,
      wateringVersion: bounded(raw?.wateringVersion, raw ? 0 : MANUAL_WATERING_VERSION),
      rewardProgressVersion: Math.max(1, bounded(raw?.rewardProgressVersion, 1)),
      balanceVersion: Math.max(BALANCE_VERSION, bounded(raw?.balanceVersion, BALANCE_VERSION)),
      date,
      dropsToday: bounded(raw?.dropsToday, 0),
      targetDrops: storedDate && LEGACY_STAGE_TARGETS.includes(raw?.targetDrops)
        ? raw.targetDrops : stageTarget(currentStage, stageGrowthDays),
    };
  }

  function readMessages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(entry => entry && typeof entry.id === 'string' && userKey(entry.from)
      && userKey(entry.to) && typeof entry.text === 'string' && typeof entry.kind === 'string'
      && timestamp(entry.at) !== null)
      .map(({ id, from, to, kind, text, at, order, questId, questDate, questStatus }) => ({
        id, from, to, kind, text, at, order: Number.isSafeInteger(order) && order > 0 ? order : 0,
        ...(kind === 'quest_request' && QUESTS.get(questId)?.pair && dateStart(questDate) !== null
          && ['pending', 'confirmed', 'declined'].includes(questStatus) ? { questId, questDate, questStatus } : {}),
      }))
      .sort((a, b) => a.order - b.order || a.at - b.at || a.id.localeCompare(b.id))
      .slice(-MESSAGE_LIMIT);
  }

  function normalize(raw, now, legacyLogs = []) {
    const plant = readPlant(raw?.plant, now);
    const users = Object.fromEntries(USERS.map(key => [key, readUser(key, raw?.users?.[key], plant.date)]));
    const recoverWater = raw?.plant && !Object.hasOwn(raw.plant, 'waterHistoryByDate');
    const recoverCategories = raw?.plant && !Object.hasOwn(raw.plant, 'rewardHistoryByDate');
    for (const entry of legacyLogs) {
      const key = userKey(entry.user);
      const start = timestamp(entry.startTimestamp);
      if (entry.kind !== 'pomodoro' || !key || start === null) continue;
      const end = timestamp(entry.endTimestamp) ?? timestamp(start + entry.durationMinutes * MINUTE);
      if (end === null) continue;
      const day = today(end);
      if (day > plant.date) continue;
      const amount = bounded(entry.waterDrops, legacyReward(entry.activity));
      if (recoverWater) {
        const record = plant.waterHistoryByDate[day] ??= { ppa: 0, tbv: 0 };
        record[key] += amount;
      }
      const category = entry.activity === 'home_eating' ? 'meal' : ruleFor(entry.activity)?.category;
      if (recoverCategories && category) {
        const record = plant.rewardHistoryByDate[day] ??= dayCategories();
        record[key][category] += amount;
      }
    }
    for (const key of USERS) {
      const recorded = plant.waterHistoryByDate[plant.date]?.[key] ?? 0;
      const user = users[key];
      user.waterDropsToday = Math.max(user.waterDropsToday, recorded);
      const paidSleep = creditedOn(plant, user, 'sleep', plant.date);
      const sleepTier = SLEEP_TIERS.findLast(tier => tier.reward <= paidSleep);
      if (sleepTier && (user.rewardProgress.home_sleeping?.elapsedMs ?? 0) < sleepTier.minutes * MINUTE) {
        user.rewardProgress.home_sleeping = { elapsedMs: sleepTier.minutes * MINUTE, pairedMs: 0 };
      }
    }
    return { users, plant, messages: readMessages(raw?.messages) };
  }

  function updateTarget(draft) {
    const { plant, users } = draft;
    plant.waterHistoryByDate[plant.date] = {
      ppa: users.ppa.waterDropsToday,
      tbv: users.tbv.waterDropsToday,
    };
    plant.dropsToday = USERS.reduce((sum, key) => sum + users[key].waterDropsToday, 0);
    if (plant.dropsToday >= plant.targetDrops) {
      plant.historyStatusByDate[plant.date] = 'success';
      plant.wilted = false;
    }
  }

  function evaluateClosedDay(plant) {
    if (plant.lastEvaluationDate && plant.date <= plant.lastEvaluationDate) return;
    plant.lastEvaluationDate = plant.date;
    if (plant.dropsToday >= plant.targetDrops) {
      plant.historyStatusByDate[plant.date] = 'success';
      plant.wilted = false;
      plant.consecutiveMissedDays = 0;
      plant.streakDays = Math.min(WATERED_DAYS_PER_STAGE, plant.streakDays + 1);
      if (plant.currentStage < 5) plant.stageGrowthDays = Math.min(STAGE_GROWTH_DAY_CAP, plant.stageGrowthDays + 1);
      if (plant.streakDays === WATERED_DAYS_PER_STAGE && plant.currentStage < 5) {
        plant.currentStage += 1;
        plant.stageGrowthDays = 0;
        plant.streakDays = 0;
        plant.shieldAvailable = false;
        plant.visualMilestone = 0;
      } else if ((plant.streakDays === 7 || plant.streakDays === 14) && plant.streakDays > plant.visualMilestone) {
        plant.visualMilestone = plant.streakDays;
        plant.shieldAvailable = true;
      }
      return;
    }
    plant.historyStatusByDate[plant.date] = 'failed';
    if (plant.shieldAvailable) {
      plant.shieldAvailable = false;
      plant.lastShieldUseDate = plant.date;
    } else {
      plant.streakDays = Math.max(0, plant.streakDays - STREAK_LOSS_PER_MISSED_DAY);
    }
    plant.consecutiveMissedDays += 1;
    plant.wilted = true;
    if (plant.consecutiveMissedDays % MISSED_DAYS_PER_DROP === 0) {
      if (plant.currentStage > 1) {
        plant.currentStage -= 1;
        plant.stageGrowthDays = 0;
        plant.shieldAvailable = false;
        plant.visualMilestone = 0;
      }
      plant.streakDays = 0;
    }
  }

  function rollTo(draft, day) {
    const { plant, users } = draft;
    while (plant.date < day) {
      updateTarget(draft);
      evaluateClosedDay(plant);
      plant.date = nextDay(plant.date);
      plant.targetDrops = stageTarget(plant.currentStage, plant.stageGrowthDays);
      for (const key of USERS) {
        users[key].waterDate = plant.date;
        users[key].waterDropsToday = 0;
        users[key].waterDropsAvailable = 0;
        users[key].rewardProgress = {};
      }
      plant.dropsToday = 0;
    }
  }

  function logInterval(key, activity, start, end, durationMinutes, kind) {
    return {
      id: id(kind), user: key, activity, startTimestamp: start, endTimestamp: end,
      durationMinutes, date: today(start), kind,
    };
  }

  function creditedOn(plant, user, category, day) {
    return plant.rewardHistoryByDate[day]?.[user.id]?.[category] ?? 0;
  }

  function award(draft, user, rule, start, deadline, waterDrops, logs) {
    const creditDate = today(deadline);
    if (creditDate < draft.plant.date) return false;
    rollTo(draft, creditDate);
    const plant = draft.plant;
    const used = creditedOn(plant, user, rule.category, creditDate);
    const granted = rule.cap === null ? waterDrops : Math.min(waterDrops, rule.cap - used);
    if (granted <= 0) return false;
    const daily = plant.rewardHistoryByDate[creditDate] ??= dayCategories();
    daily[user.id][rule.category] = used + granted;
    if (plant.wateringVersion < MANUAL_WATERING_VERSION) {
      user.waterDropsToday += granted;
      updateTarget(draft);
    } else {
      user.waterDropsAvailable += granted;
    }
    user.creditedActivityStartTime = user.startTime;
    const end = Math.min(deadline, start + DAY_MS);
    const entry = logInterval(user.id, user.currentActivity, start, end, (end - start) / MINUTE, 'pomodoro');
    logs.push({ ...entry, rewardCategory: rule.category, waterDrops: granted, creditDate,
      pairedBonus: Boolean(rule.pairGroup && granted > rule.reward) });
    return true;
  }

  function partnerOf(user) {
    return user.id === 'ppa' ? 'tbv' : 'ppa';
  }

  function pairedInterval(user, other, now) {
    const group = ruleFor(user.currentActivity)?.pairGroup;
    if (!group || !user.explicitSession || !other.explicitSession
        || ruleFor(other.currentActivity)?.pairGroup !== group) return null;
    const from = Math.max(user.pairedFocusThrough, user.startTime, other.startTime);
    const to = Math.min(now, user.plannedEndTime, other.plannedEndTime);
    return to > from ? { from, to } : null;
  }

  function pairedDuration(user, other, now) {
    const interval = pairedInterval(user, other, now);
    return user.pairedFocusMs + (interval ? interval.to - interval.from : 0);
  }

  function freezePairing(draft, until) {
    for (const key of USERS) {
      const user = draft.users[key];
      if (!user.explicitSession || !ruleFor(user.currentActivity)?.pairGroup) continue;
      const interval = pairedInterval(user, draft.users[partnerOf(user)], until);
      const through = Math.max(user.pairedFocusThrough, Math.min(until, user.plannedEndTime));
      const day = today(through);
      if (day !== today(user.pairedFocusThrough)) user.pairedFocusTodayMs = 0;
      if (interval) {
        user.pairedFocusMs += interval.to - interval.from;
        user.pairedFocusTodayMs += Math.max(0, interval.to - Math.max(interval.from, dateStart(day)));
      }
      user.pairedFocusThrough = through;
    }
  }

  function setActivity(user, activity, instant) {
    const explicitSession = activity !== IDLE;
    const rule = ruleFor(activity);
    const rewardTargetMs = rule?.minutes ? rule.minutes * MINUTE : null;
    Object.assign(user, {
      currentActivity: activity,
      startTime: explicitSession ? instant : null,
      idleStartedAt: explicitSession ? null : instant,
      plannedEndTime: activityDeadline(activity, explicitSession ? instant : null,
        rewardTargetMs, user.rewardProgress, user.waterDate),
      explicitSession,
      lastActivityTimestamp: instant,
      sessionVersion: user.sessionVersion + 1,
      creditedActivityStartTime: null,
      oneTimeRewardHandled: false,
      rewardTargetMs,
      pairedFocusMs: 0,
      pairedFocusThrough: explicitSession ? instant : null,
      pairedFocusTodayMs: 0,
    });
  }

  function closeActivity(user, instant, logs) {
    // Keep recent rest history within one day even if the live clock runs longer.
    const start = user.startTime ?? Math.max(user.idleStartedAt ?? instant, instant - DAY_MS);
    const end = Math.min(instant, start + DAY_MS);
    if (end > start) {
      logs.push(logInterval(user.id, user.currentActivity, start, end,
        (end - start) / MINUTE, 'activity'));
    }
  }

  function rememberInterrupted(user, end) {
    const rule = ruleFor(user.currentActivity);
    if (!rule?.minutes || user.oneTimeRewardHandled || user.creditedActivityStartTime === user.startTime) return;
    const elapsed = end - Math.max(user.startTime, dateStart(user.waterDate));
    if (elapsed <= 0) return;
    const previous = user.rewardProgress[user.currentActivity];
    const elapsedMs = Math.min(carryLimit(rule), (previous?.elapsedMs ?? 0) + elapsed);
    user.rewardProgress[user.currentActivity] = {
      elapsedMs, pairedMs: Math.min(elapsedMs, (previous?.pairedMs ?? 0) + user.pairedFocusTodayMs),
    };
  }

  function carriedIntoDeadline(user) {
    if (user.rewardTargetMs === null) return null;
    const saved = user.rewardProgress[user.currentActivity];
    const elapsedMs = user.startTime + user.rewardTargetMs - user.plannedEndTime;
    if (!saved || elapsedMs <= 0) return null;
    // A reduced target may use only part of a carry earned before the rebalance.
    return { elapsedMs, pairedMs: Math.floor(saved.pairedMs * elapsedMs / saved.elapsedMs) };
  }

  function settle(draft, now, logs) {
    const due = USERS.map(key => draft.users[key])
      .filter(user => user.plannedEndTime !== null && user.plannedEndTime <= now)
      .sort((a, b) => a.plannedEndTime - b.plannedEndTime);
    // Settle milestones in chronological order before evaluating the corresponding closed day.
    for (const user of due) {
      const deadline = user.plannedEndTime;
      freezePairing(draft, deadline);
      const creditDate = today(deadline);
      if (creditDate >= draft.plant.date) {
        const rule = ruleFor(user.currentActivity);
        const carry = carriedIntoDeadline(user);
        if (rule && !user.oneTimeRewardHandled && user.creditedActivityStartTime !== user.startTime) {
          const pairedMs = user.pairedFocusMs + (carry?.pairedMs ?? 0);
          const bonus = rule.pairGroup && pairedMs * 5 >= user.rewardTargetMs * 4;
          const waterDrops = bonus ? Math.ceil(rule.reward * 1.2) : rule.reward;
          award(draft, user, rule, user.startTime, deadline, waterDrops, logs);
        }
        if (user.waterDate === creditDate) {
          const saved = user.rewardProgress[user.currentActivity];
          if (carry && saved && saved.elapsedMs > carry.elapsedMs) {
            saved.elapsedMs -= carry.elapsedMs;
            saved.pairedMs -= carry.pairedMs;
          } else {
            delete user.rewardProgress[user.currentActivity];
          }
        }
      }
      closeActivity(user, deadline, logs);
      setActivity(user, IDLE, deadline);
    }
    rollTo(draft, today(now));
    updateTarget(draft);
  }

  function creditSleep(draft, user, wakeAt, logs) {
    if (user.currentActivity !== 'home_sleeping' || !user.explicitSession || user.oneTimeRewardHandled
      || user.creditedActivityStartTime === user.startTime || wakeAt <= user.startTime) return;
    const day = today(wakeAt);
    const previous = user.rewardProgress.home_sleeping?.elapsedMs ?? 0;
    const elapsedMs = Math.min(SLEEP_TARGET_MS, previous + Math.max(0, wakeAt - user.startTime));
    user.rewardProgress.home_sleeping = { elapsedMs, pairedMs: 0 };
    const tier = SLEEP_TIERS.findLast(entry => elapsedMs >= entry.minutes * MINUTE);
    const credited = creditedOn(draft.plant, user, 'sleep', day);
    if (tier && tier.reward > credited) {
      award(draft, user, WATER_REWARDS.sleep, user.startTime, wakeAt, tier.reward - credited, logs);
    }
  }

  function apply(raw, now, operation, legacyLogs, guard) {
    const draft = normalize(raw, now, legacyLogs);
    const logs = [];
    const day = today(now);
    const daysAhead = (dateStart(day) - dateStart(draft.plant.date)) / DAY_MS;
    if (daysAhead > MAX_CATCH_UP_DAYS) {
      throw Object.assign(new Error('Đồng hồ hoặc dữ liệu cách quá 366 ngày. Hãy kiểm tra ngày giờ trước khi đồng bộ.'), {
        code: 'clock-range',
      });
    }
    if (day < draft.plant.date || (guard && !guard(draft))) {
      return { draft, logs, result: false };
    }
    for (const user of Object.values(draft.users)) {
      if (user.currentActivity === IDLE) user.idleStartedAt ??= now;
    }
    settle(draft, now, logs);
    // Finish pending legacy sessions under their original watering policy before upgrading.
    draft.plant.wateringVersion = Math.max(draft.plant.wateringVersion, MANUAL_WATERING_VERSION);
    const result = operation ? operation(draft, logs) : undefined;
    return { draft, logs, result };
  }

  function requiresLegacyLogs(raw) {
    return Object.values(raw.users).some(user => Object.hasOwn(user, 'timerStatus'))
      || (raw.plant && !Object.hasOwn(raw.plant, 'rewardHistoryByDate'));
  }

  function enqueue(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  function adopt(draft, nextRevision) {
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 0 || nextRevision <= revision) return false;
    const changed = JSON.stringify(model) !== JSON.stringify(draft);
    model = draft;
    revision = nextRevision;
    return changed;
  }

  function write(now, operation, { actor = 'system', action = 'refresh', guard } = {}) {
    const accountGeneration = generation;
    return enqueue(async () => {
      if (accountGeneration !== generation) return false;
      const instant = time(now);
      let change;
      try {
        change = await PocketDB.mutate(
          (raw, legacyLogs) => apply(raw, instant, operation, legacyLogs, guard),
          requiresLegacyLogs,
          { actor, action, now: instant },
        );
        if (!change) throw new Error('No server confirmation for Pocket Space change');
        if (!Number.isSafeInteger(change.revision) || change.revision < 0) {
          throw new Error('Missing server revision for Pocket Space change');
        }
      } catch (error) {
        if (accountGeneration === generation) persisted = false;
        throw error;
      }
      if (accountGeneration !== generation) return false;
      persisted = true;
      const changed = adopt(change.draft, change.revision);
      return operation ? change.result : changed;
    });
  }

  function snapshot() {
    const current = model || normalize(null, Date.now());
    return {
      users: Object.fromEntries(USERS.map(key => {
        const user = current.users[key];
        return [key, { ...user, rewardProgress: Object.fromEntries(Object.entries(user.rewardProgress)
          .map(([activity, progress]) => [activity, { ...progress }])) }];
      })),
      plant: {
        ...current.plant,
        historyStatusByDate: { ...current.plant.historyStatusByDate },
        waterHistoryByDate: Object.fromEntries(Object.entries(current.plant.waterHistoryByDate)
          .map(([day, totals]) => [day, { ...totals }])),
        rewardHistoryByDate: Object.fromEntries(Object.entries(current.plant.rewardHistoryByDate)
          .map(([day, totals]) => [day, { ppa: { ...totals.ppa }, tbv: { ...totals.tbv } }])),
        dailyQuests: Object.fromEntries(Object.entries(current.plant.dailyQuests)
          .map(([day, claims]) => [day, { ...claims }])),
      },
      messages: current.messages.map(message => ({ ...message })),
    };
  }

  function historySnapshot(dateKey) {
    const start = dateStart(dateKey);
    if (start === null) return Promise.resolve({ logs: [], users: {} });
    const end = dateStart(nextDay(dateKey));
    const accountGeneration = generation;
    return enqueue(async () => {
      if (accountGeneration !== generation) throw new Error('Pocket Space account changed');
      const history = await PocketDB.historyDay(dateKey, start, end);
      if (accountGeneration !== generation) throw new Error('Pocket Space account changed');
      const logs = history.logs.filter(entry => (entry.creditDate === dateKey && entry.awardedWater > 0)
          || (timestamp(entry.startTimestamp) !== null
          && entry.startTimestamp < end
          && (entry.endTimestamp ?? entry.startTimestamp + entry.durationMinutes * MINUTE) > start))
        .sort((a, b) => a.startTimestamp - b.startTimestamp || a.id.localeCompare(b.id))
        .map(entry => ({ ...entry }));
      const users = Object.fromEntries(USERS.map(key => [
        key, readUser(key, history.users?.[key], dateKey),
      ]));
      return { logs, users };
    });
  }

  return {
    open(now = Date.now()) { return write(now, undefined, { action: 'open' }); },
    refresh(now = Date.now()) { return write(now); },

    applyRemote(raw) {
      if (!raw || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision < revision) return false;
      persisted = true;
      return adopt(normalize(raw, Date.now()), raw.revision);
    },

    clearRemote() {
      generation += 1;
      queue = Promise.resolve();
      model = null;
      revision = -1;
      persisted = false;
    },

    waterPlant(value, now = Date.now()) {
      const key = userKey(value);
      if (!key) return Promise.resolve(false);
      const instant = time(now);
      const day = today(instant);
      return write(instant, draft => {
        const user = draft.users[key];
        const amount = user.waterDropsAvailable;
        if (draft.plant.date !== day || !amount) return false;
        user.waterDropsAvailable = 0;
        user.waterDropsToday += amount;
        user.lastWateredDate = day;
        updateTarget(draft);
        return amount;
      }, { actor: key, action: 'waterPlant' });
    },

    completeQuest(value, quest, now = Date.now()) {
      const key = userKey(value);
      const info = QUESTS.get(quest);
      if (!key || !info || info.pair) return Promise.resolve(false);
      const instant = time(now);
      const day = today(instant);
      return write(instant, draft => {
        if (draft.plant.date !== day) return false;
        const claims = draft.plant.dailyQuests[day] ??= {};
        const claim = quest + '_' + key;
        if (claims[claim]) return false;
        claims[claim] = true;
        draft.users[key].waterDropsAvailable += info.reward;
        return true;
      }, { actor: key, action: 'completeQuest', guard: () => true });
    },

    requestQuest(value, quest, now = Date.now()) {
      const key = userKey(value);
      const info = QUESTS.get(quest);
      if (!key || !info?.pair) return Promise.resolve(null);
      const instant = time(now);
      const day = today(instant);
      return write(instant, draft => {
        if (draft.plant.dailyQuests[day]?.[quest + '_pair']) return null;
        if (draft.messages.some(message => message.kind === 'quest_request' && message.questId === quest
            && message.questDate === day && message.questStatus === 'pending')) return null;
        const order = (draft.messages.at(-1)?.order ?? 0) + 1;
        const message = {
          id: id('quest'), from: key, to: partnerOf(draft.users[key]), kind: 'quest_request',
          text: info.title, at: instant, order, questId: quest, questDate: day, questStatus: 'pending',
        };
        draft.messages = readMessages([...draft.messages, message]);
        return { ...message };
      }, { actor: key, action: 'requestQuest', guard: () => true });
    },

    respondToQuest(value, requestId, accept, now = Date.now()) {
      const key = userKey(value);
      if (!key || typeof requestId !== 'string' || typeof accept !== 'boolean') return Promise.resolve(false);
      const instant = time(now);
      const day = today(instant);
      return write(instant, draft => {
        const message = draft.messages.find(item => item.id === requestId);
        if (!message || message.kind !== 'quest_request' || message.to !== key
            || message.questDate !== day || message.questStatus !== 'pending') return false;
        const info = QUESTS.get(message.questId);
        if (!info?.pair) return false;
        const claim = message.questId + '_pair';
        if (draft.plant.dailyQuests[day]?.[claim]) return false;
        message.questStatus = accept ? 'confirmed' : 'declined';
        if (accept) {
          const claims = draft.plant.dailyQuests[day] ??= {};
          claims[claim] = true;
          for (const user of USERS) draft.users[user].waterDropsAvailable += info.reward;
        }
        return true;
      }, { actor: key, action: 'respondToQuest', guard: () => true });
    },

    changeActivity(value, activity, now = Date.now(), expectedSessionVersion) {
      const key = userKey(value);
      if (!key || !canSelectActivity(key, activity)) return Promise.resolve(false);
      const instant = time(now);
      const expected = expectedSessionVersion ?? model?.users[key]?.sessionVersion;
      return write(instant, (draft, logs) => {
        const user = draft.users[key];
        const partnerTimestamp = draft.users[partnerOf(user)].lastActivityTimestamp ?? 0;
        const transitionTime = Math.max(instant, partnerTimestamp);
        if (transitionTime > instant) settle(draft, transitionTime, logs);
        if (user.currentActivity === activity) return false;
        // A slight device-clock skew must not replay an interval the other profile has already settled.
        freezePairing(draft, transitionTime);
        creditSleep(draft, user, transitionTime, logs);
        rememberInterrupted(user, transitionTime);
        closeActivity(user, transitionTime, logs);
        setActivity(user, activity, transitionTime);
        return true;
      }, {
        actor: key,
        action: 'changeActivity',
        guard: draft => (expected === undefined || draft.users[key].sessionVersion === expected)
          && instant >= (draft.users[key].lastActivityTimestamp ?? 0),
      });
    },

    send(from, to, kind, text, now = Date.now()) {
      const sender = userKey(from);
      const recipient = userKey(to);
      const messageKind = typeof kind === 'string' ? kind.trim().slice(0, 32) : '';
      const body = typeof text === 'string' ? text.trim().slice(0, 500) : '';
      if (!sender || !recipient || sender === recipient || !messageKind || messageKind === 'quest_request' || !body) {
        return Promise.resolve(null);
      }
      const instant = time(now);
      return write(instant, draft => {
        const order = (draft.messages.at(-1)?.order ?? 0) + 1;
        const message = { id: id('message'), from: sender, to: recipient, kind: messageKind, text: body, at: instant, order };
        draft.messages = readMessages([...draft.messages, message]);
        return { ...message };
      }, { actor: sender, action: 'send', guard: () => true });
    },

    historySnapshot,
    history(dateKey) { return historySnapshot(dateKey).then(history => history.logs); },

    elapsedMs(value, now = Date.now()) {
      const user = model?.users[userKey(value)];
      if (user?.idleStartedAt != null) return Math.max(0, time(now) - user.idleStartedAt);
      return user?.startTime != null ? Math.min(DAY_MS, Math.max(0,
        Math.min(time(now), user.plannedEndTime ?? Infinity) - user.startTime)) : 0;
    },
    targetMs(value) {
      return model?.users[userKey(value)]?.rewardTargetMs ?? null;
    },
    pairGroup(activity) { return ruleFor(activity)?.pairGroup ?? null; },

    rewardInfo(value, now = Date.now()) {
      const user = model?.users[userKey(value)];
      const rule = ruleFor(user?.currentActivity);
      const instant = time(now);
      const day = today(instant);
      const nextCreditAt = rule && !rule.wakeOnly ? user.plannedEndTime : null;
      const carry = rule?.wakeOnly && user.waterDate === day ? user.rewardProgress.home_sleeping
        : nextCreditAt === null ? null : carriedIntoDeadline(user);
      const carriedMs = carry?.elapsedMs ?? 0;
      const target = rule?.wakeOnly ? SLEEP_TARGET_MS : user?.rewardTargetMs ?? null;
      const pairedMs = rule?.pairGroup
        ? pairedDuration(user, model.users[partnerOf(user)], instant) + (carry?.pairedMs ?? 0) : 0;
      return {
        category: rule?.category ?? null,
        minutes: user?.rewardTargetMs != null ? user.rewardTargetMs / MINUTE : null,
        reward: rule?.reward ?? null,
        cap: rule?.cap ?? null,
        creditedToday: rule ? creditedOn(model.plant, user, rule.category, day) : 0,
        progressMs: target === null ? 0 : Math.min(target, carriedMs + Math.max(0, instant - user.startTime)),
        carriedMs,
        remainingMs: nextCreditAt === null ? null : Math.max(0, nextCreditAt - instant),
        nextCreditAt,
        pairedMs,
        pairedRatio: rule?.pairGroup ? Math.min(1, pairedMs / target) : 0,
        wakeOnly: rule?.wakeOnly === true,
        sleepTiers: rule?.wakeOnly ? SLEEP_TIERS.map(tier => ({ ...tier })) : [],
      };
    },

    nextRefreshAt(now = Date.now()) {
      if (!model) return time(now);
      const midnight = dateStart(nextDay(model.plant.date));
      const milestones = USERS.map(key => model.users[key].plannedEndTime);
      return Math.min(midnight ?? Infinity, ...milestones.filter(value => value !== null));
    },
    today,
    get data() { return snapshot(); },
    get persisted() { return persisted; },
  };
})();
