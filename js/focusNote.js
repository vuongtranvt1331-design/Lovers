import { PocketDB } from "./db.js?v=pocket-ios-1";
import { today } from "./gameTime.js";

export function createFocusNote(currentProfile, canAct, openNotes) {
  const ui = Object.fromEntries(["focusNote", "focusNoteCheck", "focusNoteText", "focusNoteCycle",
    "focusNoteStatus", "notesCount"].map(id => [id, document.getElementById(id)]));
  let owner;
  let day;
  let snapshot = { tasks: [], pinnedId: null, fromCache: true };
  let phase = "loading";
  let unsubscribe;
  let token = 0;
  let pending = false;
  let message = "";

  const unfinished = () => snapshot.tasks.filter(task => !task.done);
  const focused = () => unfinished().find(task => task.id === snapshot.pinnedId) || unfinished()[0];
  const writable = () => canAct() && phase === "ready" && !snapshot.fromCache && !pending;

  function render() {
    const task = focused();
    const done = snapshot.tasks.filter(item => item.done).length;
    ui.notesCount.textContent = done + "/" + snapshot.tasks.length;
    ui.notesCount.setAttribute("aria-label", owner?.toUpperCase() + " · " + done + "/" + snapshot.tasks.length + " việc hôm nay đã xong");
    const waiting = phase === "loading" || (snapshot.fromCache && canAct() && snapshot.tasks.length === 0);
    const text = task?.text || (waiting ? "Đang tải việc hôm nay…"
      : phase === "error" ? "Mở Notes để tải lại việc hôm nay…"
        : snapshot.tasks.length ? "Đã xong mọi việc hôm nay" : "Thêm một việc cho hôm nay…");
    if (ui.focusNoteText.textContent !== text) ui.focusNoteText.textContent = text;
    ui.focusNoteText.title = text;
    ui.focusNoteText.setAttribute("aria-label", text + " · Mở ghi chú hôm nay");
    ui.focusNoteCheck.checked = false;
    ui.focusNoteCheck.disabled = !task || !writable();
    ui.focusNoteCheck.setAttribute("aria-label", task ? "Hoàn thành " + task.text : "Chưa có việc cần hoàn thành");
    ui.focusNoteCycle.disabled = unfinished().length < 2 || !writable();
    ui.focusNoteCycle.setAttribute("aria-label", "Chọn và ghim việc chưa xong tiếp theo");
    ui.focusNote.dataset.pinned = String(Boolean(task && task.id === snapshot.pinnedId));
    ui.focusNote.dataset.offline = String(!canAct());
    ui.focusNote.setAttribute("aria-busy", String(phase === "loading" || pending));
    const status = message || (phase === "error" ? "Chưa tải được việc hôm nay. Mở Notes để thử lại."
      : !canAct() ? "Mất kết nối. Chưa thể đổi việc ưu tiên." : "");
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
      if (generation === token) message = canAct() ? "Chưa lưu được việc ưu tiên. Hãy thử lại." : "Mất kết nối. Thay đổi chưa được lưu.";
    } finally {
      pending = false;
      render();
    }
  }

  function mount() {
    ui.focusNoteText.addEventListener("click", openNotes);
    ui.focusNoteCheck.addEventListener("change", () => {
      ui.focusNoteCheck.checked = false;
      const task = focused();
      if (task) void save((profile, date) => PocketDB.notes.setDone(profile, date, task.id, true));
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
