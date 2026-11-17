// Installation is independent from Firestore, so its guide works before data loads.
const byId = id => document.getElementById(id);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const secure = window.isSecureContext && /^https?:$/.test(location.protocol);
let installPrompt;
let registration;
let refreshing = false;
let requestedUpdate = false;

function installationState() {
  const installed = standalone();
  document.documentElement.dataset.standalone = String(installed);
  byId("installOpen").textContent = installed ? "Ứng dụng & bộ nhớ offline" : "Cài lên màn hình chính";
  byId("installState").textContent = installed ? "Bạn đang dùng Pocket Space từ màn hình chính."
    : ios ? "Thêm một lần để mở app từ biểu tượng riêng, không có thanh địa chỉ."
    : "Thêm Pocket Space để mở nhanh như một ứng dụng.";
  byId("iosInstallSteps").hidden = installed || !ios;
  byId("otherInstallHelp").hidden = installed || ios || Boolean(installPrompt);
  byId("installNative").hidden = installed || !installPrompt;
}

byId("installOpen").addEventListener("click", () => {
  byId("profileDialog").close();
  installationState();
  byId("installDialog").showModal();
});
byId("installClose").addEventListener("click", () => byId("installDialog").close());
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installationState();
});
window.addEventListener("appinstalled", () => { installPrompt = undefined; installationState(); });
matchMedia("(display-mode: standalone)").addEventListener?.("change", installationState);
byId("installNative").addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  byId("installNative").disabled = true;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { /* The manual browser-menu instructions remain available. */ }
  finally { installPrompt = undefined; byId("installNative").disabled = false; installationState(); }
});

function showUpdate() {
  if (registration?.waiting && navigator.serviceWorker.controller) byId("appUpdate").hidden = false;
}
byId("dismissUpdate").addEventListener("click", () => { byId("appUpdate").hidden = true; });
byId("applyUpdate").addEventListener("click", () => {
  if (!registration?.waiting) return;
  requestedUpdate = true;
  byId("applyUpdate").disabled = true;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
});

async function registerOffline() {
  const status = byId("offlineReady");
  if (!secure || !("serviceWorker" in navigator)) {
    status.textContent = "Mở đường dẫn HTTPS của Pocket Space để dùng bộ nhớ offline và cài từ trình duyệt.";
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (requestedUpdate && !refreshing) { refreshing = true; location.reload(); }
  });
  try {
    const script = new URL("../sw.js", import.meta.url);
    registration = await navigator.serviceWorker.register(script, { scope: new URL("../", import.meta.url).pathname, updateViaCache: "none" });
    const ready = () => {
      status.textContent = "Đã lưu giao diện để mở lại khi mất mạng. Dữ liệu và hình đã tải được giữ trên thiết bị này.";
      showUpdate();
    };
    if (registration.active) ready();
    else void navigator.serviceWorker.ready.then(ready);
    showUpdate();
    const watchInstalling = () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (navigator.serviceWorker.controller) showUpdate();
          else ready();
        } else if (worker.state === "redundant" && !registration.active) {
          status.textContent = "Chưa tải đủ bộ nhớ offline. Kết nối mạng rồi mở lại ứng dụng nhé.";
        }
      });
    };
    registration.addEventListener("updatefound", watchInstalling);
    watchInstalling();
    // Check on resume, at most hourly; keep the existing tab until the user reloads.
    let lastCheck = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && navigator.onLine && Date.now() - lastCheck >= 60 * 60 * 1000) {
        lastCheck = Date.now();
        void registration.update().catch(() => {});
      }
    });
    window.addEventListener("online", () => { void registration.update().catch(() => {}); });
  } catch {
    status.textContent = "Chưa lưu được bộ nhớ offline. Ứng dụng vẫn dùng được khi có mạng; thử mở lại để tải đủ.";
  }
}

installationState();
void registerOffline();
