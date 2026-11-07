import { DAILY_QUESTS } from "./catalog.js";
import { FocusState } from "./state.js?v=watering";
import { AudioEngine } from "./audio.js";

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

  function questArtKey(quest, user) {
    return (quest.pair ? "" : user + "_") + "quest_" + quest.id;
  }

  function useQuestImage(image, key) {
    if (image.dataset.asset !== key) {
      image.dataset.asset = key;
      image.src = new URL(key + ".png", questRoot).href;
    }
  }

  function renderQuests() {
    const { plant, messages } = FocusState.data;
    const claims = plant.dailyQuests[plant.date] || {};
    const user = currentProfile();
    let count = 0;
    for (const { quest, image, button } of questCards) {
      const claim = quest.id + "_" + user;
      const done = claims[quest.pair ? quest.id + "_pair" : claim] === true || claims[claim] === true;
      const request = quest.pair && messages.find(message => message.kind === "quest_request"
        && message.questId === quest.id && message.questDate === plant.date && message.questStatus === "pending");
      const incoming = request?.to === user;
      count += Number(done);
      button.disabled = !canAct() || done || questPending.has(claim) || Boolean(request && !incoming);
      button.classList.toggle("is-complete", done);
      button.textContent = done ? "✓ Đã xong" : incoming ? "Xác nhận"
        : request ? "Chờ xác nhận" : quest.pair ? "Gửi yêu cầu" : "Làm rồi";
      button.setAttribute("aria-label", quest.title + " · " + button.textContent);
      if (ui.questDrawer.open) useQuestImage(image, questArtKey(quest, user));
    }
    ui.questCount.textContent = count + "/" + questCards.length;
    ui.questProfile.textContent = "Nhiệm vụ của " + user.toUpperCase()
      + (canAct() ? " · nhiệm vụ đôi cần cả hai xác nhận." : " · cần kết nối để nhận thưởng.");
  }

  async function playQuestFeedback() {
    if (questFeedbackPlaying || !questFeedbackQueue.length) return;
    questFeedbackPlaying = true;
    const { quest, user } = questFeedbackQueue.shift();
    useQuestImage(ui.questFeedbackImage, questArtKey(quest, user));
    try { await ui.questFeedbackImage.decode(); } catch {}
    ui.questFeedbackText.textContent = "+" + quest.reward + " 💧 cho " + user.toUpperCase();
    if (ui.questDrawer.open) ui.questDrawer.append(ui.questFeedback);
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
      reward.textContent = "+" + quest.reward + " 💧" + (quest.pair ? " / người" : "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button quest-claim";
      button.addEventListener("click", () => void claimQuest(quest));
      card.append(image, title, reward, button);
      ui.questGrid.append(card);
      questCards.push({ quest, image, button });
    }
    ui.questDrawer.addEventListener("toggle", renderQuests);
  }

  return { mount: buildQuests, render: renderQuests, reward };
}
