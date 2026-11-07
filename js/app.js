import { ACTIVITY_GROUPS, ACTIVITY_TITLES, canSelectActivity, DAILY_QUESTS } from "./catalog.js?v=home-scenes";
import { AudioEngine } from "./audio.js";
import { CanvasRenderer, AnimationManager } from "./canvasRenderer.js?v=home-scenes";
import { FocusState } from "./state.js?v=home-scenes";
import { Timeline } from "./timeline.js?v=home-scenes";
import { createQuestDrawer } from "./quests.js?v=home-scenes";
import { PocketDB } from "./db.js";
import { offsetDay } from "./gameTime.js";

const FocusUI = (() => {
  const byId = id => document.getElementById(id);
  const ui = Object.fromEntries([
    "appDate", "activeProfileName", "profileButton", "profileDialog", "profileClose", "choosePPA",
    "chooseTBV", "plantCanvas", "plantPoke", "plantStage", "plantStatus", "partnerWater",
    "ownWater", "waterTotal", "waterTarget", "waterPartnerBar", "waterOwnBar", "rulesDialog", "rulesClose",
    "plantHelp", "plantGalleryOpen", "plantGallery", "plantGalleryClose", "plantGalleryGrid", "rulesStreak", "galleryStreak",
    "plantAvailable", "plantWaterDialog", "plantWaterClose", "plantWaterDescription", "plantWaterConfirm",
    "plantPPACanvas", "plantTBVCanvas", "plantWaterHeart",
    "streakText", "streakDots", "streakHint", "streakBadge", "streakBadgeText",
    "wiltToast", "wiltToastText", "wiltToastClose",
    "waterHistory", "partnerCanvas", "partnerPoke", "partnerName", "partnerActivity", "partnerElapsed", "speechBubble", "partnerEffects",
    "partnerDialog", "partnerClose", "messageForm", "messageInput", "quickActions", "ownCanvas",
    "ownPoke", "ownName", "ownActivity", "ownElapsed", "ownEffects", "timerStatus", "activityDialog", "activityClose", "dock",
    "historyButton", "historyDialog", "historyClose", "appStatus", "togetherStatus", "togetherElapsed", "plant",
    "questDrawer", "questOpen", "questClose",
    "topBar", "syncStatus", "syncButton",
    "coupleQuestDialog", "coupleQuestClose", "coupleQuestText", "coupleQuestAccept", "coupleQuestDecline",
  ].map(id => [id, byId(id)]));
  const names = { ppa: "PPA", tbv: "TBV" };
  const plantNames = ["Mầm hạt", "Chồi non", "Bonsai mini", "Đơm hoa", "Cổ thụ"];
  const plantTargets = [40, 55, 70, 85, 100];
  const streakGoal = 21;
  const quick = { heart: "❤️ Gửi bạn một trái tim", kiss: "💋 Mwah!", bonk: "🥊 Bonk!" };
  const localDate = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit",
  });
  const renderers = {};
  const visibleKeys = {};
  const renderUser = {};
  const dialogs = [...document.querySelectorAll("dialog")];
  const activityButtons = [];
  const galleryTiles = [];
  const galleryVisible = new Set();
  const artRetries = new Map();
  const seenMessages = new Map();
  const effectTimers = new Map();
  const promptedQuests = new Set();
  const reportedQuests = new Set();
  let profile = "ppa";
  let connectionStatus = "connecting";
  const canAct = () => connectionStatus === "online";
  const quests = createQuestDrawer(() => profile, commit, canAct, showCoupleQuest);
  let syncing = false;
  let pouring = false;
  let lastDay = "";
  let plantRenderDay = "";
  let together = null;
  let togetherWindow = null;
  let wiltToastDay = "";
  let wiltToastTimer;
  let clockTimer;
  let renderScope = "";
  let ownStartTime;
  let partnerStartTime;
  let galleryObserver;
  let selectedQuest = null;
  let hydratedRemote = false;
  let lockedScroll = null;

  const partner = () => profile === "ppa" ? "tbv" : "ppa";

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function labelDate(now) {
    ui.appDate.textContent = localDate.format(now);
  }

  function elapsed(ms, precise = false) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return seconds + " giây";
    if (minutes < 60) return minutes + " phút" + (precise ? " " + seconds % 60 + " giây" : "");
    return Math.floor(minutes / 60) + " giờ " + minutes % 60 + " phút";
  }

  function displayArt(slot, user, key, columns, rows, { transparent = false, url } = {}) {
    if (renderUser[slot] !== user) {
      let canvas = ui[slot + "Canvas"];
      if (renderUser[slot]) {
        renderers[slot].dispose();
        const replacement = canvas.cloneNode(false);
        canvas.replaceWith(replacement);
        ui[slot + "Canvas"] = replacement;
        canvas = replacement;
      }
      renderers[slot] = CanvasRenderer.create(canvas, user, { transparent });
      renderUser[slot] = user;
      visibleKeys[slot] = null;
    }
    if (visibleKeys[slot] !== key) {
      visibleKeys[slot] = key;
      clearTimeout(artRetries.get(slot));
      const renderer = renderers[slot];
      function load(retry) {
        void renderer.load(key, columns, rows, url).then(loaded => {
          if (visibleKeys[slot] !== key || renderers[slot] !== renderer) return;
          syncRenderScope();
          if (!loaded && retry) artRetries.set(slot, setTimeout(() => load(false), 5000));
        });
      }
      load(true);
      renderer.restart(AnimationManager.tick);
    }
  }

  function renderClocks(now = Date.now()) {
    ui.ownElapsed.textContent = ownStartTime == null ? "—" : elapsed(FocusState.elapsedMs(profile, now), true);
    ui.partnerElapsed.textContent = partnerStartTime == null ? "—" : elapsed(FocusState.elapsedMs(partner(), now), true);
    const matched = togetherWindow !== null && now >= togetherWindow.start && now < togetherWindow.end;
    if (matched) ui.togetherElapsed.textContent = elapsed(now - togetherWindow.start, true);
    if (matched !== together) {
      together = matched;
      ui.togetherStatus.hidden = !matched;
      document.body.dataset.together = String(matched);
      if (matched) {
        renderers.own.restart(AnimationManager.tick);
        renderers.partner.restart(AnimationManager.tick);
      }
    }
  }

  function renderPlant(now = Date.now()) {
    const { plant, users } = FocusState.data;
    plantRenderDay = FocusState.today(now);
    const currentDay = plant.date === plantRenderDay;
    const target = plant.targetDrops;
    const own = currentDay ? users[profile].waterDropsToday : 0;
    const other = currentDay ? users[partner()].waterDropsToday : 0;
    const total = own + other;
    const stage = plant.currentStage;
    const dry = plant.wilted;
    const plantScene = ui.plantPoke.closest(".plant-scene");
    plantScene.dataset.milestone = String(plant.visualMilestone ?? 0);
    plantScene.dataset.stage = String(stage);
    plantScene.dataset.wilted = String(dry);
    ui.plantStage.textContent = "Giai đoạn " + stage + " · " + plantNames[stage - 1];
    ui.partnerWater.textContent = names[partner()] + " · " + other + " 💧";
    ui.ownWater.textContent = names[profile] + " · " + own + " 💧";
    ui.waterTotal.textContent = String(total);
    ui.waterTarget.textContent = String(target);
    const shown = Math.max(target, total);
    ui.waterPartnerBar.style.width = other / shown * 100 + "%";
    ui.waterOwnBar.style.width = own / shown * 100 + "%";
    ui.plantStatus.textContent = !currentDay ? "Đang chờ đồng bộ số nước của ngày mới."
      : dry
      ? "Cây đang héo · cần tưới thêm " + (target - total) + " giọt để hồi phục."
      : total > target ? "Đã tưới vượt mục tiêu " + (total - target) + " giọt."
      : total === target ? "Đã tưới đủ nước hôm nay." : "Cần tưới thêm " + (target - total) + " giọt hôm nay.";
    const key = "bonsai_" + String(stage).padStart(2, "0") + (dry ? "_dry" : "_healthy");
    displayArt("plant", "plant", key, dry ? 1 : 5, 1);
    renderPlantWaterers(currentDay ? plant.date : null, users);
    renderWaterControls(currentDay ? users[profile].waterDropsAvailable ?? 0 : 0, currentDay);
    renderStreak(plant, total);
    if (currentDay) showWiltToastIfNeeded(plant);
  }

  function renderPlantWaterers(date, users) {
    for (const [user, slot] of [["ppa", "plantPPA"], ["tbv", "plantTBV"]]) {
      const active = date !== null && users[user].lastWateredDate === date;
      ui[slot + "Canvas"].hidden = !active;
      if (active && !renderers[slot]) {
        const key = user + "_plant_watering";
        const url = new URL("../assets/sprites/" + user + "/" + key + "_sheet.png", import.meta.url).href;
        displayArt(slot, user, key, 3, 2, { transparent: true, url });
      } else if (!active && renderers[slot]) {
        clearTimeout(artRetries.get(slot));
        artRetries.delete(slot);
        renderers[slot].dispose();
        delete renderers[slot];
        delete renderUser[slot];
        delete visibleKeys[slot];
      }
    }
    ui.plantWaterHeart.hidden = ui.plantPPACanvas.hidden || ui.plantTBVCanvas.hidden;
  }

  function renderWaterControls(available, currentDay) {
    ui.plantAvailable.textContent = available + " 💧";
    const description = !currentDay ? "Đang chờ đồng bộ số nước của ngày mới."
      : available > 0
      ? names[profile] + " có " + available + " giọt nước. Tưới hết số giọt này cho bonsai nhé?"
      : names[profile] + " chưa có nước để tưới. Hoàn thành hoạt động hoặc nhiệm vụ để nhận giọt nước.";
    const message = canAct() ? description : description + " Cần có kết nối để tưới.";
    if (ui.plantWaterDescription.textContent !== message) ui.plantWaterDescription.textContent = message;
    ui.plantWaterConfirm.textContent = available > 0 ? "Tưới hết " + available + " giọt" : "Tưới hết nước có sẵn";
    ui.plantWaterConfirm.disabled = pouring || !canAct() || !currentDay || available === 0;
  }

  async function waterPlant() {
    if (ui.plantWaterConfirm.disabled) return;
    const user = profile;
    pouring = true;
    ui.plantWaterConfirm.disabled = true;
    void AudioEngine.prepare();
    try {
      const amount = await commit(() => FocusState.waterPlant(user));
      if (amount > 0) {
        if (ui.plantWaterDialog.open && profile === user) ui.plantWaterDialog.close();
        const slot = user === "ppa" ? "plantPPA" : "plantTBV";
        if (!ui[slot + "Canvas"].hidden) {
          renderers[slot]?.restart(AnimationManager.tick);
          feedback(ui.plantPoke, AudioEngine.waterDrop);
        }
        showActionStatus(names[user] + " đã tưới " + amount + " giọt.", null);
      }
    } finally {
      pouring = false;
      renderPlant();
    }
  }

  function renderStreak(plant, total) {
    const settled = plant.streakDays;
    const todayMet = total >= plant.targetDrops;
    const days = Math.min(streakGoal, settled + Number(todayMet));
    const stage = plant.currentStage;
    const label = "Tiến trình " + days + " / " + streakGoal + " ngày";
    ui.streakText.textContent = label;
    ui.streakBadgeText.textContent = days + "/" + streakGoal + " ngày";
    if (days === streakGoal && todayMet && stage < plantNames.length) {
      ui.streakHint.textContent = "Đủ ngày thứ 21 · lên Giai đoạn " + (stage + 1) + " lúc 00:00.";
    } else if (todayMet && settled < streakGoal) {
      ui.streakHint.textContent = "Đủ nước hôm nay · chốt ngày lúc 00:00.";
    } else if (plant.shieldAvailable) {
      ui.streakHint.textContent = "🛡️ Có 1 khiên bảo vệ tiến độ.";
    } else {
      ui.streakHint.textContent = stage === plantNames.length ? "Cây đã đạt giai đoạn cuối." : "";
    }
    for (const [index, dot] of Array.from(ui.streakDots.children).entries()) {
      dot.classList.toggle("is-filled", index < days);
      dot.classList.toggle("is-pending", index >= settled && index < days);
    }
    const summary = "Giai đoạn " + stage + " · " + label;
    ui.rulesStreak.textContent = summary;
    ui.galleryStreak.textContent = summary;
    for (const { tile, badge, stage: tileStage, dry } of galleryTiles) {
      const current = stage === tileStage && plant.wilted === dry;
      tile.classList.toggle("is-current", current);
      badge.hidden = !current;
      if (current) badge.textContent = days + "/" + streakGoal;
    }
  }

  function hideWiltToast() {
    clearTimeout(wiltToastTimer);
    ui.wiltToast.hidden = true;
  }

  function showWiltToastIfNeeded(plant) {
    if (!plant.wilted || wiltToastDay === plant.date) return;
    const yesterday = offsetDay(plant.date, -1);
    if (plant.historyStatusByDate[yesterday] !== "failed") return;
    wiltToastDay = plant.date;
    clearTimeout(wiltToastTimer);
    const reset = plant.consecutiveMissedDays > 0 && plant.consecutiveMissedDays % 3 === 0;
    ui.wiltToastText.textContent = reset
      ? "🥀 Cây thiếu nước ba ngày liên tiếp. Tiến độ đã trở về 0."
      : plant.lastShieldUseDate === yesterday
        ? "🛡️ Hôm qua cây thiếu nước. Khiên đã giữ tiến độ của hai bạn."
        : "🥀 Hôm qua cây thiếu nước. Tiến độ hiện còn " + plant.streakDays + "/" + streakGoal + " ngày.";
    ui.wiltToast.hidden = false;
    wiltToastTimer = setTimeout(hideWiltToast, 8000);
  }

  function openPlantGallery() {
    if (!galleryTiles.length) {
      for (let index = 0; index < plantNames.length; index++) {
        for (const variant of ["healthy", "dry"]) {
          const dry = variant === "dry";
          const tile = document.createElement("figure");
          tile.className = "plant-gallery-tile";
          tile.dataset.state = variant;
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 160;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", plantNames[index] + (dry ? " héo" : " xanh tốt"));
          const caption = document.createElement("figcaption");
          const title = document.createElement("strong");
          title.textContent = (index + 1) + " · " + plantNames[index];
          const label = document.createElement("small");
          label.textContent = dry ? "Héo" : plantTargets[index] + " 💧";
          const badge = document.createElement("small");
          badge.className = "gallery-streak";
          badge.hidden = true;
          caption.append(title, label, badge);
          tile.append(canvas, caption);
          ui.plantGalleryGrid.append(tile);
          galleryTiles.push({ tile, canvas, badge, stage: index + 1, dry });
        }
      }
    }
    const { plant } = FocusState.data;
    renderStreak(plant, plant.dropsToday);
    openDialog(ui.plantGallery);
    ui.plantGallery.scrollTop = 0;
    syncGallery();
  }

  function showGalleryTile(entry) {
    if (!entry.renderer) {
      const renderer = CanvasRenderer.create(entry.canvas, "plant");
      entry.renderer = renderer;
      const variant = entry.dry ? "dry" : "healthy";
      const key = "bonsai_" + String(entry.stage).padStart(2, "0") + "_" + variant;
      const load = () => renderer.load(key, entry.dry ? 1 : 5, 1);
      void load().then(loaded => {
        if (!loaded && entry.renderer === renderer) {
          entry.retry = setTimeout(() => {
            if (entry.renderer === renderer && galleryVisible.has(entry)) void load();
          }, 5000);
        }
      });
      renderer.restart(AnimationManager.tick);
    }
    galleryVisible.add(entry);
  }

  function syncGallery() {
    galleryObserver?.disconnect();
    if (!ui.plantGallery.open) {
      galleryVisible.clear();
      for (const entry of galleryTiles) {
        clearTimeout(entry.retry);
        entry.renderer?.dispose();
        entry.renderer = null;
      }
      return;
    }
    if (typeof IntersectionObserver !== "function") {
      updateGalleryFallback();
      return;
    }
    galleryObserver = new IntersectionObserver(changes => {
      if (!ui.plantGallery.open) return;
      for (const change of changes) {
        const entry = galleryTiles.find(record => record.tile === change.target);
        if (change.isIntersecting) showGalleryTile(entry);
        else galleryVisible.delete(entry);
      }
      syncRenderScope();
    }, { root: ui.plantGallery });
    galleryTiles.forEach(entry => galleryObserver.observe(entry.tile));
  }

  function updateGalleryFallback() {
    if (typeof IntersectionObserver === "function" || !ui.plantGallery.open) return;
    const bounds = ui.plantGallery.getBoundingClientRect();
    for (const entry of galleryTiles) {
      const rect = entry.tile.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom) showGalleryTile(entry);
      else galleryVisible.delete(entry);
    }
    syncRenderScope();
  }

  function renderWaterHistory() {
    const { plant, users } = FocusState.data;
    const today = FocusState.today();
    const records = {
      ...plant.waterHistoryByDate,
      [plant.date]: { ppa: users.ppa.waterDropsToday, tbv: users.tbv.waterDropsToday },
    };
    ui.waterHistory.replaceChildren();
    for (const [day, amounts] of Object.entries(records).sort(([a], [b]) => b.localeCompare(a))) {
      const entry = document.createElement("li");
      const [year, month, date] = day.split("-").map(Number);
      const label = day === today ? "Hôm nay" : new Intl.DateTimeFormat("vi-VN").format(new Date(year, month - 1, date));
      entry.textContent = label + " · PPA " + amounts.ppa + " · TBV " + amounts.tbv
        + " · " + (amounts.ppa + amounts.tbv) + " giọt";
      ui.waterHistory.append(entry);
    }
  }

  function openPlantRules() {
    renderWaterHistory();
    openDialog(ui.rulesDialog);
  }

  function latestMessage(messages, user) {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].to === user && messages[index].kind !== "quest_request") return messages[index];
    }
    return null;
  }

  function renderPeople() {
    const { users, messages } = FocusState.data;
    const own = users[profile];
    const other = users[partner()];
    ownStartTime = own.startTime ?? own.idleStartedAt;
    partnerStartTime = other.startTime ?? other.idleStartedAt;
    ui.activeProfileName.textContent = names[profile];
    ui.ownName.textContent = names[profile];
    ui.partnerName.textContent = names[partner()];
    ui.ownActivity.textContent = ACTIVITY_TITLES.get(own.currentActivity);
    ui.partnerActivity.textContent = ACTIVITY_TITLES.get(other.currentActivity);
    ui.choosePPA.setAttribute("aria-pressed", String(profile === "ppa"));
    ui.chooseTBV.setAttribute("aria-pressed", String(profile === "tbv"));
    ui.messageInput.setAttribute("aria-label", "Tin nhắn gửi " + names[partner()]);
    const recent = latestMessage(messages, profile);
    ui.speechBubble.hidden = !recent;
    ui.speechBubble.textContent = recent ? (quick[recent.kind] || recent.text) : "";

    displayArt("own", profile, profile + "_" + own.currentActivity, 3, 2);
    displayArt("partner", partner(), partner() + "_" + other.currentActivity, 3, 2);
    const group = FocusState.pairGroup(own.currentActivity);
    const sharedGroup = own.explicitSession && other.explicitSession
      && group !== null && group === FocusState.pairGroup(other.currentActivity);
    togetherWindow = sharedGroup ? {
      start: Math.max(own.startTime, other.startTime),
      end: Math.min(own.plannedEndTime ?? Infinity, other.plannedEndTime ?? Infinity),
    } : null;
    if (recent && seenMessages.get(profile) !== recent.id) {
      seenMessages.set(profile, recent.id);
      if (quick[recent.kind]) playNudge("own", recent.kind);
    }
    for (const button of activityButtons) {
      button.hidden = !canSelectActivity(profile, button.dataset.activity);
      button.setAttribute("aria-pressed", String(button.dataset.activity === own.currentActivity));
    }
  }

  function renderTimer() {
    const info = FocusState.rewardInfo(profile);
    if (ownStartTime == null) {
      ui.timerStatus.textContent = "Chọn một hoạt động để bắt đầu phiên.";
    } else if (!info.category) {
      ui.timerStatus.textContent = "Hoạt động này không nhận nước tưới.";
    } else if (info.wakeOnly) {
      ui.timerStatus.textContent = "Khi thức dậy · đủ 7 giờ +5 giọt · đủ 8 giờ +10 giọt.";
    } else if (info.cap != null && info.creditedToday >= info.cap) {
      ui.timerStatus.textContent = "Đã nhận đủ " + info.cap + " giọt cho nhóm này hôm nay.";
    } else {
      ui.timerStatus.textContent = "Đủ " + info.minutes + " phút sẽ nhận " + info.reward + " giọt để tưới cây.";
    }
  }

  function render() {
    labelDate(Date.now());
    renderPlant();
    renderPeople();
    renderTimer();
    renderClocks();
    quests.render();
    showNewQuestRewards();
    if (ui.rulesDialog.open) renderWaterHistory();
    if (ui.coupleQuestDialog.open && !FocusState.data.messages.some(message => message.id === selectedQuest
      && message.questStatus === "pending" && message.questDate === FocusState.data.plant.date)) {
      ui.coupleQuestDialog.close();
      selectedQuest = null;
    }
    offerCoupleQuest();
  }

  async function refresh() {
    if (syncing || !canAct()) return;
    syncing = true;
    try {
      const updated = await FocusState.refresh();
      lastDay = FocusState.today();
      if (updated) {
        render();
        void Timeline.refresh();
      }
    } catch {
      // The adapter publishes the connection error and retains the last confirmed data.
    } finally {
      syncing = false;
    }
  }

  function showActionStatus(message, dialog = dialogs.findLast(item => item.open)) {
    ui.appStatus.textContent = message;
    if (!dialog) return;
    let status = dialog.querySelector(".action-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "small action-status";
      status.setAttribute("role", "status");
      dialog.firstElementChild.after(status);
    }
    status.textContent = message;
    status.hidden = !message;
  }

  async function commit(action) {
    const dialog = dialogs.findLast(item => item.open);
    if (!canAct()) {
      showActionStatus("Cần kết nối để lưu thay đổi. Hãy kiểm tra trạng thái ở đầu trang.", dialog);
      return false;
    }
    try {
      const result = await action();
      if (result) showActionStatus("", dialog);
      render();
      void Timeline.refresh();
      return result;
    } catch {
      showActionStatus("Chưa lưu được thay đổi. Bạn có thể thử lại.", dialog);
      return false;
    }
  }

  function feedback(button, sound = AudioEngine.chime) {
    try { navigator.vibrate?.(50); } catch {}
    void sound();
    if (button.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      button.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 240 });
    }
  }

  function playNudge(role, kind, sound = true) {
    const layer = ui[role + "Effects"];
    const portrait = ui[role + "Poke"];
    clearTimeout(effectTimers.get(role));
    layer.replaceChildren();
    portrait.classList.remove("bonked");
    function effect(className) {
      const element = document.createElement("span");
      element.className = className;
      layer.append(element);
      return element;
    }
    if (kind === "heart") {
      for (const [index, offset] of [-22, 0, 22].entries()) {
        const heart = effect("nudge-heart");
        heart.style.setProperty("--dx", offset + "px");
        heart.style.setProperty("--delay", index * 90 + "ms");
      }
    } else if (kind === "kiss") {
      effect("nudge-kiss");
      effect("nudge-blush");
    } else if (kind === "bonk") {
      effect("nudge-bonk");
      void portrait.offsetWidth;
      portrait.classList.add("bonked");
      if (sound) void AudioEngine.bonk();
    }
    effectTimers.set(role, setTimeout(() => {
      layer.replaceChildren();
      portrait.classList.remove("bonked");
    }, kind === "kiss" ? 3000 : 1200));
  }

  function switchProfile(user) {
    profile = user;
    try { sessionStorage.setItem("pocket-focus-profile", user); } catch {}
    ui.profileDialog.close();
    render();
  }

  function showCoupleQuest(request) {
    if (request.to !== profile || !canAct()) return;
    const quest = DAILY_QUESTS.find(item => item.id === request.questId);
    if (!quest) return;
    selectedQuest = request.id;
    promptedQuests.add(request.id);
    ui.coupleQuestText.textContent = names[request.from] + " muốn cùng bạn hoàn thành “" + quest.title
      + "”. Nếu đồng ý, hai bạn mỗi người nhận 2 giọt nước.";
    openDialog(ui.coupleQuestDialog);
  }

  function offerCoupleQuest() {
    if (!canAct() || dialogs.some(dialog => dialog.open)) return;
    const { plant, messages } = FocusState.data;
    const pending = messages.find(message => message.kind === "quest_request" && message.to === profile
      && message.questDate === plant.date && message.questStatus === "pending" && !promptedQuests.has(message.id));
    if (pending) showCoupleQuest(pending);
  }

  async function answerCoupleQuest(accept) {
    if (!selectedQuest || ui.coupleQuestAccept.disabled) return;
    const request = selectedQuest;
    ui.coupleQuestAccept.disabled = ui.coupleQuestDecline.disabled = true;
    if (accept) void AudioEngine.prepare();
    try {
      if (await commit(() => FocusState.respondToQuest(profile, request, accept))) {
        ui.coupleQuestDialog.close();
        selectedQuest = null;
      }
    } finally {
      ui.coupleQuestAccept.disabled = ui.coupleQuestDecline.disabled = false;
    }
  }

  function syncConnection({ status, raw, error }) {
    const previousStatus = connectionStatus;
    connectionStatus = status;
    ui.topBar.dataset.connection = status;
    const connectionLabel = error?.code === "clock-range" ? error.message : ({
      connecting: "Đang kiểm tra kết nối…",
      online: "Đã kết nối · thay đổi được đồng bộ",
      offline: "Kết nối gián đoạn · chưa thể lưu thay đổi",
      error: "Chưa thể đồng bộ · hãy kiểm tra lại kết nối",
    }[status] ?? "Chưa thể đồng bộ");
    if (ui.syncStatus.textContent !== connectionLabel) ui.syncStatus.textContent = connectionLabel;
    ui.syncButton.hidden = status !== "offline" && status !== "error";
    const adopted = raw ? FocusState.applyRemote(raw) : false;
    if (!hydratedRemote && raw) {
      hydratedRemote = true;
      const messages = raw.messages ?? [];
      for (const user of Object.keys(names)) seenMessages.set(user, latestMessage(messages, user)?.id);
      for (const message of messages) {
        if (message.questStatus === "confirmed") {
          reportedQuests.add(message.id + ":" + message.from);
          reportedQuests.add(message.id + ":" + message.to);
        }
      }
    }
    if (status === "online") ui.appStatus.textContent = "";
    render();
    if (adopted) void Timeline.refresh();
    if (status === "online" && (!raw || previousStatus !== "online"
      || FocusState.nextRefreshAt() <= Date.now())) void refresh();
  }

  function showNewQuestRewards() {
    if (!canAct()) return;
    const { messages, plant } = FocusState.data;
    for (const message of messages) {
      const key = message.id + ":" + profile;
      if (message.kind !== "quest_request" || message.questDate !== plant.date
        || message.questStatus !== "confirmed" || reportedQuests.has(key)
        || (message.from !== profile && message.to !== profile)) continue;
      reportedQuests.add(key);
      quests.reward(message.questId, profile);
    }
  }

  function buildDock() {
    for (const [title, activities] of ACTIVITY_GROUPS) {
      const group = document.createElement("section");
      const heading = document.createElement("h3");
      const grid = document.createElement("div");
      group.className = "dock-group";
      heading.textContent = title;
      grid.className = "dock-grid";
      for (const [id, name, icon] of activities) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "activity-button";
        button.dataset.activity = id;
        const glyph = document.createElement("span");
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = icon;
        const caption = document.createElement("span");
        caption.textContent = name;
        button.append(glyph, caption);
        button.addEventListener("click", async () => {
          const user = profile;
          const version = FocusState.data.users[user].sessionVersion;
          if (await commit(() => FocusState.changeActivity(user, id, Date.now(), version))) {
            ui.activityDialog.close();
          } else if (canAct() && FocusState.data.users[user].sessionVersion !== version) {
            showActionStatus("Hoạt động vừa đổi trên thiết bị khác. Đã tải trạng thái mới nhất.");
          }
        });
        grid.append(button);
        activityButtons.push(button);
      }
      group.append(heading, grid);
      ui.dock.append(group);
    }
  }

  function watchClock(force = false) {
    clearTimeout(clockTimer);
    const now = Date.now();
    Timeline.watchClock(now);
    if (document.hidden) return;
    labelDate(now);
    renderClocks(now);
    if (FocusState.today(now) !== plantRenderDay) {
      renderPlant(now);
      if (ui.rulesDialog.open) renderWaterHistory();
      syncRenderScope();
    }
    const due = FocusState.nextRefreshAt(now) <= now;
    if (force || due || FocusState.today(now) !== lastDay) void refresh();
    clockTimer = setTimeout(watchClock, 1000 - now % 1000);
  }

  function syncRenderScope() {
    const modal = dialogs.find(dialog => dialog.open);
    let next = "";
    if (!document.hidden) {
      if (!modal) next = "main";
      else if (modal === ui.plantGallery) next = "gallery";
      else if (modal === ui.historyDialog) next = "history";
    }
    const changed = next !== renderScope;
    renderScope = next;
    const animated = next === "main" ? Object.values(renderers).some(renderer => renderer.animated)
      : next === "gallery" ? [...galleryVisible].some(entry => entry.renderer.animated)
        : next === "history" && Timeline.hasVisibleAnimation();
    AnimationManager.setActive(animated);
    if (changed) AnimationManager.redraw();
  }

  function dialogChanged() {
    if (dialogs.some(dialog => dialog.open)) {
      if (lockedScroll === null) {
        lockedScroll = window.scrollY;
        document.body.style.setProperty("--modal-scroll-y", lockedScroll + "px");
        document.body.classList.add("modal-open");
        document.documentElement.classList.add("modal-open");
      }
    } else if (lockedScroll !== null) {
      document.body.classList.remove("modal-open");
      document.documentElement.classList.remove("modal-open");
      document.body.style.removeProperty("--modal-scroll-y");
      window.scrollTo({ top: lockedScroll, behavior: "instant" });
      lockedScroll = null;
      offerCoupleQuest();
    }
    syncRenderScope();
  }

  function updateViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const style = document.documentElement.style;
    style.setProperty("--visual-viewport-height", viewport.height + "px");
    style.setProperty("--visual-viewport-top", viewport.offsetTop + "px");
  }

  async function mount() {
    try {
      const chosen = sessionStorage.getItem("pocket-focus-profile");
      if (chosen === "ppa" || chosen === "tbv") profile = chosen;
    } catch {}
    lastDay = FocusState.today();
    buildDock();
    quests.mount();
    for (let index = 0; index < streakGoal; index++) {
      const dot = document.createElement("span");
      dot.className = "streak-dot";
      ui.streakDots.append(dot);
    }
    render();
    AnimationManager.start(tick => {
      if (renderScope === "main") Object.values(renderers).forEach(renderer => renderer.draw(tick));
      else if (renderScope === "gallery") galleryVisible.forEach(entry => entry.renderer.draw(tick));
      else if (renderScope === "history") Timeline.draw(tick);
    }, false);
    Timeline.onVisibilityChange(syncRenderScope);
    const modalObserver = new MutationObserver(dialogChanged);
    dialogs.forEach(dialog => {
      modalObserver.observe(dialog, { attributes: true, attributeFilter: ["open"] });
      dialog.addEventListener("close", () => {
        const status = dialog.querySelector(".action-status");
        if (status) status.hidden = true;
      });
    });
    syncRenderScope();

    ui.profileButton.addEventListener("click", () => openDialog(ui.profileDialog));
    ui.choosePPA.addEventListener("click", () => switchProfile("ppa"));
    ui.chooseTBV.addEventListener("click", () => switchProfile("tbv"));
    ui.plantPoke.addEventListener("click", () => {
      renderPlant();
      openDialog(ui.plantWaterDialog);
    });
    ui.plantWaterConfirm.addEventListener("click", () => void waterPlant());
    ui.plantGalleryOpen.addEventListener("click", openPlantGallery);
    ui.plantHelp.addEventListener("click", openPlantRules);
    ui.streakBadge.addEventListener("click", () => {
      ui.plant.focus({ preventScroll: true });
      ui.plant.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    ui.questOpen.addEventListener("click", () => { openDialog(ui.questDrawer); quests.render(); });
    ui.questClose.addEventListener("click", () => ui.questDrawer.close());
    ui.syncButton.addEventListener("click", async () => {
      ui.syncButton.disabled = true;
      try {
        await PocketDB.reconnect();
      } catch {
        ui.syncStatus.textContent = "Chưa kết nối được. Bạn có thể kiểm tra lại.";
      } finally {
        ui.syncButton.disabled = false;
      }
    });
    ui.coupleQuestClose.addEventListener("click", () => ui.coupleQuestDialog.close());
    ui.coupleQuestAccept.addEventListener("click", () => void answerCoupleQuest(true));
    ui.coupleQuestDecline.addEventListener("click", () => void answerCoupleQuest(false));
    ui.plantGallery.addEventListener("close", () => { syncGallery(); syncRenderScope(); });
    ui.plantGallery.addEventListener("scroll", updateGalleryFallback, { passive: true });
    window.addEventListener("resize", updateGalleryFallback);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    updateViewport();
    ui.wiltToastClose.addEventListener("click", hideWiltToast);
    ui.partnerPoke.addEventListener("click", () => { feedback(ui.partnerPoke); openDialog(ui.partnerDialog); });
    ui.ownPoke.addEventListener("click", () => { feedback(ui.ownPoke); openDialog(ui.activityDialog); });
    for (const [button, dialog] of [[ui.profileClose, ui.profileDialog], [ui.rulesClose, ui.rulesDialog],
      [ui.plantGalleryClose, ui.plantGallery], [ui.plantWaterClose, ui.plantWaterDialog],
      [ui.partnerClose, ui.partnerDialog], [ui.activityClose, ui.activityDialog]]) {
      button.addEventListener("click", () => dialog.close());
    }

    ui.quickActions.addEventListener("click", async event => {
      const button = event.target.closest("[data-nudge]");
      if (!button) return;
      const kind = button.dataset.nudge;
      if (!quick[kind]) return;
      void AudioEngine.prepare();
      if (await commit(() => FocusState.send(profile, partner(), kind, quick[kind]))) {
        feedback(button, kind === "bonk" ? AudioEngine.bonk : AudioEngine.chime);
        ui.partnerDialog.close();
        playNudge("partner", kind, false);
      }
    });
    ui.messageForm.addEventListener("submit", async event => {
      event.preventDefault();
      const text = [...ui.messageInput.value.trim()].slice(0, 49).join("");
      if (!text) return;
      if (await commit(() => FocusState.send(profile, partner(), "text", text))) {
        ui.messageInput.value = "";
        ui.partnerDialog.close();
      }
    });
    ui.historyButton.addEventListener("click", () => void Timeline.open(profile));
    ui.historyClose.addEventListener("click", () => Timeline.close());
    PocketDB.subscribe(syncConnection);
    void PocketDB.start().catch(() => {});
    watchClock();
    window.addEventListener("focus", () => watchClock(true));
    document.addEventListener("visibilitychange", () => {
      syncRenderScope();
      watchClock(true);
    });
  }

  return { mount };
})();

void FocusUI.mount().catch(error => {
  document.getElementById("appStatus").textContent = "Pocket Space chưa mở được dữ liệu. Hãy tải lại trang.";
  console.error(error);
});
