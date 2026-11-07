import { PocketDB } from "./db.js?v=notes-board";
import { DAY_MS, GAME_TIME_ZONE, dateStart, offsetDay, today } from "./gameTime.js";

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const RESERVED_ROWS = 8;
const longDate = new Intl.DateTimeFormat("vi-VN", {
  timeZone: GAME_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
});

export function createNotesDrawer(currentProfile, canAct) {
  const ui = Object.fromEntries([
    "drawer", "days", "prev", "previousDate", "PPA", "centerDate", "TBV", "nextDate", "next",
    "dateFallback", "datePicker", "dateApply", "status", "scroll", "list", "compose", "input", "add", "close",
  ].map(key => [key, document.getElementById("notes" + key[0].toUpperCase() + key.slice(1))]));
  let owner = "ppa";
  let currentDay = today();
  let selected = currentDay;
  let snapshot = { tasks: [], archived: false, fromCache: false };
  let phase = "loading";
  let notice = "";
  let unsubscribe;
  let selectionToken = 0;
  let pending = false;
  let connected = false;
  let rolledDay = "";
  let rollover;

  const editable = () => selected >= currentDay && !snapshot.archived;
  const writable = () => editable() && canAct() && phase === "ready" && !snapshot.fromCache;

  function renderCalendar() {
    ui.days.dataset.owner = owner;
    ui.days.setAttribute("aria-label", "Lịch ghi chú " + owner.toUpperCase());
    ui.PPA.setAttribute("aria-pressed", String(owner === "ppa"));
    ui.TBV.setAttribute("aria-pressed", String(owner === "tbv"));
    const previous = offsetDay(selected, -1);
    const next = offsetDay(selected, 1);
    ui.prev.disabled = previous === null;
    ui.next.disabled = next === null;
    for (const [button, date] of [[ui.previousDate, previous], [ui.centerDate, selected], [ui.nextDate, next]]) {
      const isToday = date === currentDay;
      button.disabled = date === null;
      button.dataset.day = date ?? "";
      button.setAttribute("aria-pressed", String(date === selected));
      if (isToday) button.setAttribute("aria-current", "date");
      else button.removeAttribute("aria-current");
      if (date === null) {
        button.textContent = "—";
        button.removeAttribute("aria-label");
        continue;
      }
      const start = dateStart(date);
      const weekday = WEEKDAYS[new Date(start + DAY_MS / 2).getUTCDay()];
      button.textContent = (isToday ? "*" + weekday + "*" : weekday)
        + " " + date.slice(8) + "/" + date.slice(5, 7);
      button.setAttribute("aria-label", longDate.format(start) + (isToday ? " · Hôm nay" : "")
        + (button === ui.centerDate ? " · Chọn ngày khác" : ""));
    }
  }

  function renderStatus() {
    let message = notice;
    if (!message && !canAct()) message = "Mất kết nối. Bạn có thể xem ghi chú đã tải.";
    if (!message && phase === "error") message = "Chưa tải được ghi chú. Hãy mở lại sổ để thử.";
    if (!message && (phase === "loading" || snapshot.fromCache)) message = "Đang tải ghi chú…";
    if (!message && pending) message = "Đang lưu…";
    const completed = snapshot.tasks.filter(note => note.done).length;
    const text = message || completed + "/" + snapshot.tasks.length + " việc đã xong.";
    ui.status.hidden = false;
    ui.status.classList.toggle("sr-only", !notice && canAct() && phase !== "error");
    ui.status.dataset.error = String(Boolean(notice) || phase === "error");
    if (ui.status.textContent !== text) ui.status.textContent = text;
  }

  function renderControls() {
    const canWrite = writable();
    ui.compose.hidden = !editable();
    ui.input.disabled = !canWrite;
    ui.add.disabled = !canWrite || pending;
    for (const control of ui.list.querySelectorAll("input, button")) {
      control.disabled = !canWrite;
      if (pending) control.setAttribute("aria-disabled", "true");
      else control.removeAttribute("aria-disabled");
    }
    renderStatus();
  }

  function makeRow(note, canEdit) {
    const row = document.createElement("li");
    const entry = document.createElement(canEdit ? "label" : "span");
    const text = document.createElement("span");
    row.className = "notes-item";
    row.dataset.noteId = note.id;
    entry.className = "notes-entry";
    text.className = "notes-text";
    text.textContent = note.text;
    if (canEdit) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = note.done;
      checkbox.addEventListener("change", () => {
        const checked = checkbox.checked;
        checkbox.checked = note.done;
        void save((profile, date) => PocketDB.notes.setDone(profile, date, note.id, checked));
      });
      entry.append(checkbox);
    } else {
      const mark = document.createElement("span");
      mark.className = "notes-mark";
      mark.setAttribute("aria-hidden", "true");
      if (note.done) {
        mark.textContent = "✓";
        const description = document.createElement("span");
        description.className = "sr-only";
        description.textContent = "Đã xong. ";
        entry.append(description);
      }
      entry.append(mark);
    }
    entry.append(text);
    row.append(entry);
    if (canEdit) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "notes-delete";
      remove.textContent = "Xóa";
      remove.setAttribute("aria-label", "Xóa " + note.text);
      remove.addEventListener("click", () =>
        void save((profile, date) => PocketDB.notes.remove(profile, date, note.id)));
      row.append(remove);
    }
    return row;
  }

  function renderList() {
    const active = document.activeElement;
    const activeRow = active?.closest(".notes-item");
    const focusId = activeRow && ui.list.contains(activeRow) ? activeRow.dataset.noteId : null;
    const canEdit = editable();
    const rows = snapshot.tasks.map(note => makeRow(note, canEdit));
    for (let i = rows.length; i < RESERVED_ROWS; i++) {
      const blank = document.createElement("li");
      blank.className = "notes-placeholder";
      blank.setAttribute("aria-hidden", "true");
      rows.push(blank);
    }
    ui.list.replaceChildren(...rows);
    renderControls();
    if (focusId) {
      const row = rows.find(item => item.dataset.noteId === focusId);
      const control = row?.querySelector(active.tagName === "INPUT" ? "input" : "button");
      (control && !control.disabled ? control : ui.scroll).focus({ preventScroll: true });
    }
  }

  function loadSelection(keepInput = false) {
    const token = ++selectionToken;
    unsubscribe?.();
    unsubscribe = null;
    phase = "loading";
    notice = "";
    snapshot = { tasks: [], archived: false, fromCache: false };
    if (!keepInput) ui.input.value = "";
    ui.scroll.scrollTop = 0;
    renderCalendar();
    renderComposerHint(Date.now());
    renderList();
    const failed = () => {
      if (token !== selectionToken || !ui.drawer.open) return;
      phase = "error";
      renderControls();
    };
    try {
      unsubscribe = PocketDB.notes.subscribe(owner, selected, next => {
        if (token !== selectionToken || !ui.drawer.open) return;
        snapshot = next;
        phase = "ready";
        renderList();
      }, failed);
    } catch {
      failed();
    }
  }

  function selectDate(date, keepInput = false) {
    if (date === selected || dateStart(date) === null) return;
    selected = date;
    loadSelection(keepInput);
  }

  function selectOwner(profile) {
    if (profile === owner) return;
    owner = profile;
    loadSelection();
  }

  function ensureRollover() {
    if (!canAct() || rolledDay === currentDay || rollover) return;
    const day = currentDay;
    rollover = Promise.resolve()
      .then(() => PocketDB.notes.rollover())
      .then(() => { rolledDay = day; })
      .catch(() => {
        if (ui.drawer.open && selected === currentDay) {
          notice = "Chưa chuyển được việc dở sang hôm nay. Hãy mở lại sổ để thử.";
          renderStatus();
        }
      })
      .finally(() => {
        rollover = null;
        if (day !== currentDay) ensureRollover();
      });
  }

  function renderComposerHint(now) {
    const late = selected === currentDay && now - dateStart(currentDay) >= DAY_MS - 3600000;
    const hint = late ? "23:00 · Xem lại ghi chú" : "Thêm một việc…";
    if (ui.input.placeholder !== hint) ui.input.placeholder = hint;
  }

  function watchClock(now = Date.now()) {
    const day = today(now);
    if (day !== currentDay) {
      const followedToday = selected === currentDay;
      currentDay = day;
      ensureRollover();
      if (ui.drawer.open) {
        if (followedToday) selectDate(day, true);
        else {
          renderCalendar();
          renderList();
        }
      }
    }
    if (ui.drawer.open) renderComposerHint(now);
  }

  async function save(action, onSaved) {
    const token = selectionToken;
    watchClock();
    if (token !== selectionToken || pending || !writable()) return;
    pending = true;
    notice = "";
    renderControls();
    try {
      const result = await action(owner, selected);
      if (result && ui.drawer.open && token === selectionToken) onSaved?.();
    } catch {
      if (ui.drawer.open && token === selectionToken) {
        notice = canAct() ? "Chưa lưu được ghi chú. Hãy thử lại." : "Mất kết nối. Thay đổi chưa được lưu.";
      }
    } finally {
      pending = false;
      if (ui.drawer.open) renderControls();
    }
  }

  function hideDatePicker(restoreFocus = false) {
    ui.dateFallback.hidden = true;
    ui.dateFallback.classList.remove("is-native");
    ui.dateFallback.removeAttribute("aria-hidden");
    ui.datePicker.removeAttribute("tabindex");
    ui.dateApply.removeAttribute("tabindex");
    ui.centerDate.setAttribute("aria-expanded", "false");
    if (restoreFocus) ui.centerDate.focus({ preventScroll: true });
  }

  function openDatePicker() {
    if (!ui.dateFallback.hidden && !ui.dateFallback.classList.contains("is-native")) {
      hideDatePicker(true);
      return;
    }
    ui.datePicker.value = selected;
    ui.datePicker.setCustomValidity("");
    ui.dateFallback.hidden = false;
    if (typeof ui.datePicker.showPicker === "function") {
      ui.dateFallback.classList.add("is-native");
      ui.dateFallback.setAttribute("aria-hidden", "true");
      ui.datePicker.tabIndex = -1;
      ui.dateApply.tabIndex = -1;
      try {
        ui.datePicker.showPicker();
        return;
      } catch {
        hideDatePicker();
        ui.dateFallback.hidden = false;
      }
    }
    ui.centerDate.setAttribute("aria-expanded", "true");
    ui.datePicker.focus({ preventScroll: true });
  }

  function applyDate() {
    const date = ui.datePicker.value;
    if (dateStart(date) === null) {
      ui.datePicker.setCustomValidity("Chọn ngày hợp lệ.");
      ui.datePicker.reportValidity();
      return;
    }
    hideDatePicker(true);
    selectDate(date);
  }

  function mount() {
    ui.datePicker.min = "1970-01-02";
    ui.datePicker.max = "9999-12-30";
    if (ui.datePicker.type === "text") ui.datePicker.placeholder = "YYYY-MM-DD";
    ui.centerDate.setAttribute("aria-controls", "notesDateFallback");
    ui.centerDate.setAttribute("aria-expanded", "false");
    for (const [button, offset] of [[ui.prev, -1], [ui.previousDate, -1], [ui.nextDate, 1], [ui.next, 1]]) {
      button.addEventListener("click", () => { hideDatePicker(); selectDate(offsetDay(selected, offset)); });
    }
    for (const [button, profile] of [[ui.PPA, "ppa"], [ui.TBV, "tbv"]]) {
      button.addEventListener("click", () => { hideDatePicker(); selectOwner(profile); });
    }
    ui.centerDate.addEventListener("click", openDatePicker);
    ui.dateApply.addEventListener("click", applyDate);
    ui.datePicker.addEventListener("input", () => ui.datePicker.setCustomValidity(""));
    ui.datePicker.addEventListener("change", () => {
      if (ui.dateFallback.classList.contains("is-native")) applyDate();
    });
    ui.datePicker.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyDate();
    });
    ui.compose.addEventListener("submit", event => {
      event.preventDefault();
      const raw = ui.input.value;
      const text = raw.trim();
      if (!text) return;
      void save((profile, date) => PocketDB.notes.add(profile, date, text), () => {
        if (ui.input.value === raw) ui.input.value = "";
      });
    });
    ui.close.addEventListener("click", () => ui.drawer.close());
    ui.drawer.addEventListener("cancel", event => {
      if (!ui.dateFallback.hidden && !ui.dateFallback.classList.contains("is-native")) {
        event.preventDefault();
        hideDatePicker(true);
      }
    });
    ui.drawer.addEventListener("close", () => {
      if (ui.drawer.open) return;
      selectionToken++;
      unsubscribe?.();
      unsubscribe = null;
      hideDatePicker();
    });
  }

  function open() {
    if (ui.drawer.open) return;
    currentDay = today();
    owner = currentProfile() === "tbv" ? "tbv" : "ppa";
    selected = currentDay;
    hideDatePicker();
    ui.drawer.showModal();
    loadSelection();
    ui.centerDate.focus({ preventScroll: true });
    ensureRollover();
  }

  function connectionChanged() {
    const next = canAct();
    if (connected === next) return;
    connected = next;
    if (connected) {
      watchClock();
      ensureRollover();
    }
    if (!ui.drawer.open) return;
    if (connected && phase === "error") loadSelection(true);
    else renderControls();
  }

  return { mount, open, watchClock, connectionChanged };
}
