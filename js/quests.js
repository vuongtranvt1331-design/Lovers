import { DAILY_QUESTS } from "./catalog.js?v=pocket-ios-3";
import { FocusState } from "./state.js?v=pocket-ios-3";
import { AudioEngine } from "./audio.js";
import { PocketDB } from "./db.js?v=pocket-ios-3";

const questRoot = new URL("../assets/quests/", import.meta.url);

export function createQuestDrawer(currentProfile, commit, canAct, showCoupleQuest) {
  const ui = Object.fromEntries([
    "questDrawer", "questCount", "questProfile", "questGrid",
    "questFeedback", "questFeedbackImage", "questFeedbackText",
  ].map(id => [id, document.getElementById(id)]));
  const questCards = [];
  const questPending = new Set();
  const questFeedbackQueue = [];
  let questFeedbackPlaying = false;
  const feedbackHome = ui.questFeedback.parentElement;
  const noteQuest = DAILY_QUESTS.find(quest => quest.id === "complete_5_notes");
  const noteViews = new Map();
  const autoPending = new Set();
  const autoRetry = new Map();
  let autoDay;
  let unsubscribeNotes = [];

  function completedNotes(user) {
    return new Set((noteViews.get(user)?.tasks ?? []).filter(task => task.done).map(task => task.id)).size;
  }

  function watchNotes(day) {
    if (day === autoDay) return;
    autoDay = day;
    unsubscribeNotes.forEach(stop => stop());
    unsubscribeNotes = [];
    autoRetry.forEach(clearTimeout);
    autoRetry.clear();
    noteViews.clear();
    for (const user of ["ppa", "tbv"]) {
      unsubscribeNotes.push(PocketDB.notes.subscribe(user, day, snapshot => {
        if (autoDay !== day) return;
        noteViews.set(user, snapshot);
        renderQuests();
      }, () => { if (autoDay === day) noteViews.delete(user); }));
    }
  }

  async function claimAutomatic(user) {
    const day = autoDay;
    const view = noteViews.get(user);
    const { plant } = FocusState.data;
    const key = day + ":" + user;
    if (!noteQuest || !canAct() || autoPending.has(key) || !view || view.fromCache || view.archived
      || day !== FocusState.today() || plant.date !== day || completedNotes(user) < noteQuest.noteTarget
      || plant.dailyQuests[day]?.[noteQuest.id + "_" + user]) return;
    autoPending.add(key);
    clearTimeout(autoRetry.get(user));
    autoRetry.delete(user);
    let saved = false;
    try {
      // The state layer re-reads Notes in the same transaction as the reward.
      saved = await commit(() => FocusState.completeNotesQuest(user, day));
      if (saved) reward(noteQuest.id, user);
    } finally {
      autoPending.delete(key);
      renderQuests(false);
      if (!saved && autoDay === day && canAct()) {
        autoRetry.set(user, setTimeout(() => {
          autoRetry.delete(user);
          if (autoDay === day) void claimAutomatic(user);
        }, 10000));
      }
    }
  }

  function waterLabel(element, prefix, suffix = "") {
    const icon = document.createElement("span");
    icon.className = "drop";
    icon.setAttribute("aria-hidden", "true");
    element.classList.add("with-water-icon");
    element.replaceChildren(document.createTextNode(prefix), icon, document.createTextNode(suffix));
  }

  function questArtKey(quest, user) {
    if (quest.automatic) return "notes_" + user;
    return (quest.pair ? "" : user + "_") + "quest_" + quest.id;
  }

  function useQuestImage(image, key) {
    if (image.dataset.asset !== key) {
      image.dataset.asset = key;
      image.src = key.startsWith("notes_")
        ? new URL("../assets/notes/" + key.slice(6) + ".png", import.meta.url).href
        : new URL(key + ".png", questRoot).href;
    }
  }

  function renderQuests(checkAutomatic = true) {
    const { plant, messages } = FocusState.data;
    const currentDay = FocusState.today();
    watchNotes(currentDay);
    const current = plant.date === currentDay;
    const claims = current ? plant.dailyQuests[currentDay] || {} : {};
    const user = currentProfile();
    let count = 0;
    for (const { quest, image, button } of questCards) {
      const claim = quest.id + "_" + user;
      const done = claims[quest.pair ? quest.id + "_pair" : claim] === true || claims[claim] === true;
      const request = quest.pair && messages.find(message => message.kind === "quest_request"
        && message.questId === quest.id && message.questDate === currentDay && message.questStatus === "pending");
      const incoming = request?.to === user;
      count += Number(done);
      button.disabled = quest.automatic || !canAct() || !current || done || questPending.has(claim) || Boolean(request && !incoming);
      button.classList.toggle("is-complete", done);
      const progress = Math.min(quest.noteTarget ?? 0, completedNotes(user));
      button.textContent = done ? "✓ Đã xong" : quest.automatic
        ? progress + "/" + quest.noteTarget + (canAct() ? " · Tự động" : " · Chờ kết nối") : incoming ? "Xác nhận"
        : request ? "Chờ xác nhận" : quest.pair ? "Gửi yêu cầu" : "Làm rồi";
      button.setAttribute("aria-label", quest.title + " · " + button.textContent);
      if (ui.questDrawer.open) useQuestImage(image, questArtKey(quest, user));
    }
    ui.questCount.textContent = count + "/" + questCards.length;
    ui.questProfile.textContent = "Nhiệm vụ của " + user.toUpperCase()
      + (!current ? " · đang chờ đồng bộ ngày mới." : canAct() ? " · nhiệm vụ đôi cần cả hai xác nhận." : " · cần kết nối để nhận thưởng.");
    if (checkAutomatic) for (const user of ["ppa", "tbv"]) void claimAutomatic(user);
  }

  async function playQuestFeedback() {
    if (questFeedbackPlaying || !questFeedbackQueue.length) return;
    questFeedbackPlaying = true;
    const { quest, user } = questFeedbackQueue.shift();
    useQuestImage(ui.questFeedbackImage, questArtKey(quest, user));
    try { await ui.questFeedbackImage.decode(); } catch {}
    waterLabel(ui.questFeedbackText, "+" + quest.reward, " cho " + user.toUpperCase());
    document.querySelector("dialog[open]")?.append(ui.questFeedback);
    ui.questFeedback.hidden = false;
    ui.questFeedback.classList.add("is-playing");
    void AudioEngine.pop();
    setTimeout(() => {
      ui.questFeedback.hidden = true;
      ui.questFeedback.classList.remove("is-playing");
      feedbackHome.append(ui.questFeedback);
      questFeedbackPlaying = false;
      if (questFeedbackQueue.length) requestAnimationFrame(() => void playQuestFeedback());
    }, 1500);
  }

  async function claimQuest(quest) {
    if (quest.automatic) return;
    const user = currentProfile();
    const claim = quest.id + "_" + user;
    if (questPending.has(claim)) return;
    if (quest.pair) {
      const { plant, messages } = FocusState.data;
      const incoming = messages.find(message => message.kind === "quest_request" && message.questId === quest.id
        && message.questDate === plant.date && message.questStatus === "pending" && message.to === user);
      if (incoming) {
        showCoupleQuest(incoming);
        return;
      }
    }
    void AudioEngine.prepare();
    questPending.add(claim);
    renderQuests();
    try {
      if (quest.pair) await commit(() => FocusState.requestQuest(user, quest.id));
      else if (await commit(() => FocusState.completeQuest(user, quest.id))) reward(quest.id, user);
    } finally {
      questPending.delete(claim);
      renderQuests();
    }
  }

  function reward(id, user) {
    const quest = DAILY_QUESTS.find(item => item.id === id);
    if (!quest) return;
    questFeedbackQueue.push({ quest, user });
    void playQuestFeedback();
  }

  function buildQuests() {
    for (const quest of DAILY_QUESTS) {
      const card = document.createElement("article");
      card.className = "quest-card";
      card.dataset.quest = quest.id;
      const image = document.createElement("img");
      image.alt = "";
      image.width = image.height = 160;
      image.decoding = "async";
      const title = document.createElement("h3");
      title.textContent = quest.icon + " " + quest.title;
      const reward = document.createElement("span");
      reward.className = "quest-reward";
      waterLabel(reward, "+" + quest.reward, quest.pair ? " / người" : "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button quest-claim";
      if (quest.automatic) button.classList.add("is-automatic");
      if (quest.hint) {
        const hint = document.createElement("span");
        hint.id = "quest-hint-" + quest.id;
        hint.className = "muted";
        hint.textContent = quest.hint;
        title.append(document.createElement("br"), hint);
        button.setAttribute("aria-describedby", hint.id);
      }
      if (!quest.automatic) button.addEventListener("click", () => void claimQuest(quest));
      card.append(image, title, reward, button);
      ui.questGrid.append(card);
      questCards.push({ quest, image, button });
    }
    ui.questDrawer.addEventListener("toggle", renderQuests);
  }

  return { mount: buildQuests, render: renderQuests, reward };
}
