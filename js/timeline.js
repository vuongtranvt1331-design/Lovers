import { ACTIVITY_GROUPS, ACTIVITY_TITLES } from "./catalog.js";
import { CanvasRenderer } from "./canvasRenderer.js?v=watering";
import { FocusState } from "./state.js?v=watering";
import { DAY_MS, dateStart, GAME_TIME_ZONE, offsetDay, today } from "./gameTime.js";

export const Timeline = (() => {
  const byId = id => document.getElementById(id);
  const dialog = byId('historyDialog');
  const rows = byId('historyRows');
  const scroll = rows.closest('.history-scroll') || dialog;
  const week = byId('historyWeek');
  const detail = byId('historyDetail');
  const users = ['ppa', 'tbv'];
  const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const categories = ['home', 'work', 'out', 'social'];
  const emoji = {
    home_sleeping: '🌙', home_morning: '🪥', home_desk_work: '💻', home_cooking: '🍳',
    home_eating: '🍽️', home_chores: '🧹', home_bed_rot: '📱', home_gaming: '🎮', home_nap: '💤',
    home_studying: '📖', home_idle: '🌿',
    work_locked_in: '💻', work_meeting: '📝', work_bored_staring: '💭', work_fake_working: '📱',
    work_coffee_escape: '☕', work_counting_down: '🕒', out_walking: '🚶', out_running: '👟',
    out_gym: '🏋️', out_errand: '🧺', social_cafe: '☕', social_dining: '🍽️',
    travel_driving_long: '🚗', travel_hometown: '🏡',
  };
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const calendar = new Intl.DateTimeFormat('vi-VN', {
    timeZone: GAME_TIME_ZONE,
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const minutes = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  const hint = 'Chọn một ô để xem chi tiết hoạt động trong giờ đó.';
  let own = 'ppa';
  let selectedDay = '';
  let shownDay = '';
  let shownWeek = '';
  let selectedCell = null;
  let observer = null;
  let observed = new WeakMap();
  let records = [];
  let visible = new Set();
  let latestTick = 0;
  let loadId = 0;
  let needsScroll = false;
  let activityBadges;
  let labeledToday = '';
  let clockMinute = null;
  let suspended = false;
  let lastVisibility = false;
  let visibilityChanged = () => {};

  function firstDayOfWeek(key) {
    const weekday = new Date(key + 'T00:00:00Z').getUTCDay();
    return offsetDay(key, -((weekday + 6) % 7));
  }

  function hourLabel(hour) {
    return String(hour % 24).padStart(2, '0');
  }

  function clock(hour) {
    return hourLabel(hour) + ':00';
  }

  function hoursOf(key) {
    const start = dateStart(key);
    return Array.from({ length: 25 }, (_, hour) => start + hour * hourMs);
  }

  function durationText(ms) {
    return ms < minuteMs ? '< 1 phút' : minutes.format(ms / minuteMs) + ' phút';
  }

  function title(id) {
    return ACTIVITY_TITLES.get(id) || id.replaceAll('_', ' ');
  }

  function badge(id) {
    activityBadges ||= new Map(ACTIVITY_GROUPS.flatMap(([, activities], index) =>
      activities.map(([activity, , glyph]) => [activity, { glyph: emoji[activity] || glyph, category: categories[index] }])
    ));
    return activityBadges.get(id) || { glyph: '·', category: 'other' };
  }

  function selectDay(key) {
    if (!key) return;
    selectedDay = key;
    return refresh();
  }

  function renderWeek(current) {
    const startKey = firstDayOfWeek(selectedDay);
    if (shownWeek !== startKey) {
      const buttons = days.map((name, index) => {
        const key = offsetDay(startKey, index);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'week-day';
        button.dataset.date = key;
        button.textContent = name + ' ' + Number(key.slice(-2));
        button.setAttribute('aria-label', calendar.format(dateStart(key)));
        button.addEventListener('click', () => selectDay(key));
        return button;
      });
      week.replaceChildren(...buttons);
      shownWeek = startKey;
    }
    for (const button of week.children) {
      button.setAttribute('aria-pressed', String(button.dataset.date === shownDay));
      if (button.dataset.date === current) button.setAttribute('aria-current', 'date');
      else button.removeAttribute('aria-current');
    }
    const formatted = calendar.format(dateStart(selectedDay));
    byId('historyDate').textContent = shownDay === current ? 'Hôm nay · ' + formatted : formatted;
    labeledToday = current;
  }

  function hasVisibleAnimation() {
    if (!dialog.open || document.hidden) return false;
    for (const record of visible) {
      if (record.renderer?.animated) return true;
    }
    return false;
  }

  function notifyVisibility() {
    const next = hasVisibleAnimation();
    if (next === lastVisibility) return;
    lastVisibility = next;
    visibilityChanged(next);
  }

  function onVisibilityChange(callback) {
    visibilityChanged = callback;
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
    observed = new WeakMap();
    for (const record of records) hidePreview(record);
    notifyVisibility();
  }

  function hidePreview(record) {
    visible.delete(record);
    record.renderer?.dispose();
    record.renderer = null;
    record.retryAt = 0;
    record.attempts = 0;
  }

  function loadPreview(record) {
    const renderer = record.renderer;
    record.retryAt = 0;
    record.attempts++;
    void renderer.load(record.user + '_' + record.dominant, 3, 2).then(loaded => {
      if (!loaded && record.renderer === renderer && record.attempts < 2) {
        record.retryAt = Date.now() + 5000;
      }
    });
  }

  function showPreview(record) {
    if (!record.canvas || !record.dominant || document.hidden) return;
    if (!record.renderer) {
      record.renderer = CanvasRenderer.create(record.canvas, record.user);
      loadPreview(record);
      record.renderer.restart(latestTick);
      record.renderer.draw(latestTick);
    }
    visible.add(record);
  }

  function syncPreviews() {
    if (!dialog.open) return;
    if (document.hidden) {
      for (const record of visible) hidePreview(record);
    } else {
      const clip = observer ? null : scroll.getBoundingClientRect();
      for (const record of records) {
        if (!record.canvas) continue;
        if (clip) {
          const cell = record.cell.getBoundingClientRect();
          record.intersecting = cell.bottom > clip.top && cell.top < clip.bottom;
        }
        if (record.intersecting) showPreview(record);
        else hidePreview(record);
      }
    }
    notifyVisibility();
  }

  function setupDay(key, current) {
    disconnect();
    shownDay = key;
    selectedCell = null;
    needsScroll = true;
    records = [];
    detail.textContent = hint;
    const partner = users.find(user => user !== own);
    byId('historyPartner').textContent = partner.toUpperCase();
    byId('historySelf').textContent = own.toUpperCase() + ' · Bạn';

    const fragment = document.createDocumentFragment();
    for (let hour = 0; hour < 24; hour++) {
      const row = document.createElement('div');
      row.className = 'timeline-row';
      row.dataset.hour = String(hour);
      const time = document.createElement('time');
      time.className = 'timeline-time';
      time.dateTime = clock(hour);
      time.textContent = hourLabel(hour) + 'h';
      row.append(time);
      for (const user of [partner, own]) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'timeline-cell';
        const caption = document.createElement('span');
        cell.append(caption);
        row.append(cell);
        const record = {
          hour, user, cell, caption, canvas: null, renderer: null, dominant: null, durations: [],
          intersecting: false, attempts: 0, retryAt: 0,
        };
        cell.addEventListener('click', () => choose(record));
        records.push(record);
        updateCell(record, []);
      }
      fragment.append(row);
    }
    rows.replaceChildren(fragment);
    scroll.scrollTop = 0;
    renderWeek(current);
    if (typeof IntersectionObserver === 'function') {
      const created = new IntersectionObserver(entries => {
        if (observer !== created || !dialog.open) return;
        for (const entry of entries) {
          const record = observed.get(entry.target);
          if (!record) continue;
          record.intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
          if (record.intersecting && !document.hidden) showPreview(record);
          else hidePreview(record);
        }
        notifyVisibility();
      }, { root: scroll, threshold: [0, 0.05] });
      observer = created;
    }
  }

  function intervalsFor(logs, snapshot, now, start, end) {
    const result = { ppa: [], tbv: [] };
    function add(user, activity, started, ended, pomodoro) {
      if (!users.includes(user) || typeof activity !== 'string' || !activity
          || !Number.isFinite(started) || !Number.isFinite(ended)) return;
      const from = Math.max(start, started);
      const to = Math.min(end, ended, now);
      if (from < to) result[user].push({ activity, from, to, started, pomodoro });
    }

    for (const log of logs) {
      if (!log) continue;
      const ended = log.endTimestamp ?? (log.startTimestamp + log.durationMinutes * minuteMs);
      add(String(log.user).toLowerCase(), log.activity, log.startTimestamp, ended, log.kind === 'pomodoro');
    }
    for (const user of users) {
      const current = snapshot[user];
      if (current?.startTime != null) {
        const plannedEnd = current.plannedEndTime ?? current.startTime + DAY_MS;
        add(user, current.currentActivity, current.startTime, plannedEnd, false);
      } else if (current?.idleStartedAt != null) {
        add(user, current.currentActivity, Math.max(current.idleStartedAt, now - DAY_MS), now, false);
      }
    }
    return result;
  }

  function hourlyDurations(intervals, start, end) {
    const relevant = intervals.filter(interval => interval.from < end && interval.to > start)
      .sort((a, b) => Number(b.pomodoro) - Number(a.pomodoro) || b.started - a.started);
    const boundaries = [...new Set([start, end, ...relevant.flatMap(interval => [
      Math.max(interval.from, start), Math.min(interval.to, end),
    ])])].sort((a, b) => a - b);
    const totals = new Map();
    for (let index = 0; index < boundaries.length - 1; index++) {
      const left = boundaries[index];
      const right = boundaries[index + 1];
      // Assign every overlapping instant once, with recorded focus taking precedence.
      const interval = relevant.find(item => item.from <= left && item.to >= right);
      if (interval) totals.set(interval.activity, (totals.get(interval.activity) || 0) + right - left);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }

  function updateCell(record, durations) {
    const dominant = durations[0]?.[0] || null;
    if (dominant !== record.dominant) {
      hidePreview(record);
      observer?.unobserve(record.cell);
      observed.delete(record.cell);
      record.canvas?.remove();
      record.canvas = null;
      record.dominant = dominant;
      record.intersecting = false;
      if (dominant) {
        record.canvas = document.createElement('canvas');
        record.canvas.width = 160;
        record.canvas.height = 160;
        record.canvas.setAttribute('aria-hidden', 'true');
        record.cell.prepend(record.canvas);
        observed.set(record.cell, record);
        observer?.observe(record.cell);
      }
    }
    record.durations = durations;
    record.caption.className = dominant ? 'timeline-caption' : 'timeline-empty';
    if (dominant) {
      const { glyph, category } = badge(dominant);
      const ms = durations[0][1];
      const length = ms < minuteMs ? '<1' : String(Math.round(ms / minuteMs));
      const name = dominant === 'home_morning' ? title(dominant) + ' · ' : '';
      record.caption.textContent = glyph + ' ' + name + length + 'm';
      record.cell.dataset.category = category;
    } else {
      record.caption.textContent = '🌿 Trống';
      delete record.cell.dataset.category;
    }
    record.cell.setAttribute('aria-label', record.user.toUpperCase() + ', ' + clock(record.hour) + ', '
      + (dominant ? title(dominant) + ' ' + durationText(durations[0][1]) : 'chưa có hoạt động'));
    record.cell.setAttribute('aria-pressed', String(selectedCell === record));
  }

  function describe(record) {
    const period = record.user.toUpperCase() + ' · ' + clock(record.hour) + '–' + clock(record.hour + 1);
    const breakdown = record.durations.length
      ? record.durations.map(([id, ms]) => title(id) + ' ' + durationText(ms)).join(' · ')
      : 'Chưa có hoạt động được ghi lại.';
    const message = period + ' · ' + breakdown;
    if (detail.textContent !== message) detail.textContent = message;
  }

  function choose(record) {
    selectedCell?.cell.setAttribute('aria-pressed', 'false');
    selectedCell = record;
    record.cell.setAttribute('aria-pressed', 'true');
    describe(record);
  }

  function seekRelevantHour(now, current) {
    const hour = shownDay === current
      ? Math.floor((now - dateStart(current)) / hourMs)
      : records.find(record => record.dominant)?.hour;
    const row = rows.children[hour];
    if (row) scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 34;
  }

  async function refresh(now = Date.now()) {
    if (!dialog.open || !selectedDay) return;
    const key = selectedDay;
    const current = today(now);
    if (key !== shownDay) setupDay(key, current);
    else if (labeledToday !== current) renderWeek(current);
    clockMinute = Math.floor(now / minuteMs);
    const request = ++loadId;
    const bounds = hoursOf(key);
    let snapshot = { logs: [], users: {} };
    try {
      if (key <= current) snapshot = await FocusState.historySnapshot(key);
    } catch {
      if (request === loadId && dialog.open) detail.textContent = 'Chưa đọc được lịch sử. Hãy thử lại.';
      return;
    }
    if (request !== loadId || !dialog.open) return;
    const intervals = intervalsFor(snapshot.logs, snapshot.users, now, bounds[0], bounds[24]);
    for (const record of records) {
      updateCell(record, hourlyDurations(intervals[record.user], bounds[record.hour], bounds[record.hour + 1]));
    }
    if (selectedCell) describe(selectedCell);
    else if (detail.textContent !== hint) detail.textContent = hint;
    if (needsScroll) {
      seekRelevantHour(now, current);
      needsScroll = false;
    }
    if (!observer) syncPreviews();
    else notifyVisibility();
  }

  function watchClock(now = Date.now()) {
    if (!dialog.open || !selectedDay) return;
    if (suspended !== document.hidden) {
      suspended = document.hidden;
      syncPreviews();
    }
    if (suspended) return;
    for (const record of visible) {
      if (record.retryAt && now >= record.retryAt) loadPreview(record);
    }
    const current = today(now);
    const previousToday = labeledToday;
    const minute = Math.floor(now / minuteMs);
    if (current !== previousToday) renderWeek(current);
    if ((selectedDay === current && minute !== clockMinute)
        || (current !== previousToday && selectedDay === previousToday)) {
      void refresh(now);
    }
  }

  function draw(tick) {
    latestTick = tick;
    if (!dialog.open || document.hidden) return;
    for (const record of visible) record.renderer.draw(tick);
  }

  function close() {
    if (dialog.open) dialog.close();
    loadId++;
    disconnect();
    records = [];
    rows.replaceChildren();
    shownDay = '';
    selectedCell = null;
    selectedDay = '';
    clockMinute = null;
  }

  function open(profile) {
    const user = String(profile).toLowerCase() === 'tbv' ? 'tbv' : 'ppa';
    if (!dialog.open) {
      own = user;
      selectedDay = today();
      suspended = document.hidden;
      dialog.showModal();
    } else if (own !== user) {
      own = user;
      shownDay = '';
    }
    return refresh();
  }

  byId('historyPrev').addEventListener('click', () => selectDay(offsetDay(selectedDay, -7)));
  byId('historyNext').addEventListener('click', () => selectDay(offsetDay(selectedDay, 7)));
  if (typeof IntersectionObserver !== 'function') {
    scroll.addEventListener('scroll', syncPreviews, { passive: true });
    window.addEventListener('resize', syncPreviews);
  }
  dialog.addEventListener('close', () => {
    if (!dialog.open) close();
  });

  return { open, close, draw, refresh, watchClock, hasVisibleAnimation, onVisibilityChange };
})();
