import { PocketDB } from "./db.js?v=pocket-ios-4";
import { today } from "./gameTime.js";

export function createFocusNote(currentProfile, canAct, openNotes) {
  const ui = Object.fromEntries(["focusNote", "focusNoteCheck", "focusNoteText", "focusNoteCycle",
    "focusNoteStatus", "notesCount"].map(id => [id, document.getElementById(id)]));
  const rows = [...ui.focusNote.querySelectorAll("[data-focus-row]")].map(element => ({
    element, check: element.querySelector("input"), text: element.querySelector(".focus-note-text"), taskId: null,
  }));
  const limit = rows.length;
  let owner;
  let day;
  let snapshot = { tasks: [], pinnedId: null, fromCache: true };
  let phase = "loading";
  let unsubscribe;
  let token = 0;
  let pending = false;
  let message = "";

  const unfinished = () => snapshot.tasks.filter(task => !task.done);
  const focused = () => unfinished().length > limit
    ? unfinished().find(task => task.id === snapshot.pinnedId) || unfinished()[0] : unfinished()[0];
  function visibleTasks() {
    const tasks = unfinished();
    const first = Math.max(0, tasks.findIndex(task => task.id === focused()?.id));
    return Array.from({ length: Math.min(limit, tasks.length) }, (_, index) => tasks[(first + index) % tasks.length]);
  }
  const writable = () => canAct() && phase === "ready" && !snapshot.fromCache && !pending;

  function render() {
    const tasks = visibleTasks();
    const done = snapshot.tasks.filter(item => item.done).length;
    ui.notesCount.textContent = done + "/" + snapshot.tasks.length;
    ui.notesCount.setAttribute("aria-label", owner?.toUpperCase() + " · " + done + "/" + snapshot.tasks.length + " việc hôm nay đã xong");
    const waiting = phase === "loading" || (snapshot.fromCache && canAct() && snapshot.tasks.length === 0);
    const emptyText = waiting ? "Đang tải việc hôm nay…"
      : phase === "error" ? "Mở Notes để tải lại việc hôm nay…"
        : snapshot.tasks.length ? "Đã xong mọi việc hôm nay" : "Thêm một việc cho hôm nay…";
    rows.forEach((row, index) => {
      const task = tasks[index];
      row.taskId = task?.id ?? null;
      row.element.hidden = index > 0 && !task;
      row.element.dataset.noteId = task?.id ?? "";
      const text = task?.text ?? (index === 0 ? emptyText : "");
      if (row.text.textContent !== text) row.text.textContent = text;
      row.text.title = text;
      row.text.setAttribute("aria-label", text + " · Mở ghi chú hôm nay");
      row.check.checked = false;
      row.check.disabled = !task || !writable();
      row.check.setAttribute("aria-label", task ? "Hoàn thành " + task.text : "Chưa có việc cần hoàn thành");
    });
    ui.focusNoteCycle.disabled = unfinished().length <= limit || !writable();
    ui.focusNoteCycle.setAttribute("aria-label", "Hiển thị ghi chú tiếp theo");
    ui.focusNote.dataset.pinned = String(tasks.some(task => task.id === snapshot.pinnedId));
    ui.focusNote.dataset.offline = String(!canAct());
    ui.focusNote.setAttribute("aria-busy", String(phase === "loading" || pending));
    const status = message || (phase === "error" ? "Chưa tải được việc hôm nay. Mở Notes để thử lại."
      : !canAct() ? "Mất kết nối. Chưa thể tích hoàn thành ghi chú." : "");
    if (ui.focusNoteStatus.textContent !== status) ui.focusNoteStatus.textContent = status;
  }

  function subscribe() {
    const generation = ++token;
    unsubscribe?.();
    owner = currentProfile() === "tbv" ? "tbv" : "ppa";
    day = today();
    phase = "loading";
    message = "";
    snapshot = { tasks: [], pinnedId: null, fromCache: true };
    render();
    const fail = () => {
      if (generation !== token) return;
      phase = "error";
      render();
    };
    try {
      unsubscribe = PocketDB.notes.subscribe(owner, day, next => {
        if (generation !== token) return;
        snapshot = next;
        phase = "ready";
        render();
      }, fail);
    } catch {
      fail();
    }
  }

  async function save(action) {
    watchClock();
    if (!writable()) return;
    const generation = token;
    pending = true;
    message = "";
    render();
    try {
      await action(owner, day);
    } catch {
      if (generation === token) message = canAct() ? "Chưa lưu được ghi chú. Hãy thử lại." : "Mất kết nối. Thay đổi chưa được lưu.";
    } finally {
      pending = false;
      render();
    }
  }

  function mount() {
    rows.forEach(row => {
      row.text.addEventListener("click", openNotes);
      row.check.addEventListener("change", () => {
        const id = row.taskId;
        row.check.checked = false;
        if (id) void save((profile, date) => PocketDB.notes.setDone(profile, date, id, true));
      });
    });
    ui.focusNoteCycle.addEventListener("click", () => {
      const tasks = unfinished();
      const index = tasks.findIndex(task => task.id === focused()?.id);
      const next = tasks[(index + 1) % tasks.length];
      if (next) void save((profile, date) => PocketDB.notes.pin(profile, date, next.id));
    });
    subscribe();
  }

  function watchClock(now = Date.now()) {
    if (day !== today(now) || owner !== currentProfile()) subscribe();
  }

  function connectionChanged() {
    watchClock();
    if (canAct() && phase === "error") subscribe();
    else render();
  }

  return {
    mount, watchClock, connectionChanged,
    retry: () => { if (phase === "error") subscribe(); },
    profileChanged: subscribe,
    todayCounts: () => ({ completed: snapshot.tasks.filter(task => task.done).length, total: snapshot.tasks.length }),
  };
}
