// FinGreen For Content Creator - Frontend Application Logic

let currentScript = null;
let currentOgImage = null;
let currentSourceDomain = "cafef.vn";
let sseEventSource = null;
let currentUser = null;

// Initialize when page loads
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  loadNews("all");
  loadSettings();
  loadAdminKeys();
  loadVideoGallery();
});

// ── 0. AUTHENTICATION & USER SESSION ──
function initAuth() {
  try {
    const raw = localStorage.getItem("fingreen_user");
    if (raw) {
      currentUser = JSON.parse(raw);
    }
  } catch { }
  renderUserAuthChip();
}

function renderUserAuthChip() {
  const container = document.getElementById("user-auth-section");
  const adminBtn = document.getElementById("nav-admin-btn");

  if (adminBtn) {
    if (currentUser && currentUser.role === "admin") {
      adminBtn.style.display = "flex";
    } else {
      adminBtn.style.display = "none";
      if (document.getElementById("tab-admin")?.classList.contains("active")) {
        switchTab("radar");
      }
    }
  }

  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `
      <button class="btn-primary" style="padding: 7px 16px; font-size: 13px;" onclick="openAuthModal('login')">
        <span>🔑</span> Đăng Nhập / Đăng Ký
      </button>
    `;
    return;
  }

  const isLifetime = currentUser.expiresAt && currentUser.expiresAt.startsWith("2099");
  let expiryLabel = "Vĩnh Viễn";
  if (!isLifetime && currentUser.expiresAt) {
    const diffDays = Math.ceil((new Date(currentUser.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    expiryLabel = diffDays > 0 ? `Còn ${diffDays} ngày` : `Hết hạn`;
  }

  const tierBadgeColor =
    currentUser.tier === "lifetime" ? "var(--gold-light)" : currentUser.tier === "fintech_vip" ? "var(--emerald-light)" : "#38bdf8";

  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); padding: 4px 10px 4px 6px; border-radius: 30px;">
      <div style="width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--emerald) 0%, var(--gold) 100%); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #fff;">
        ${(currentUser.username || "U").slice(0, 1).toUpperCase()}
      </div>
      <div style="display: flex; flex-direction: column;">
        <span style="font-size: 12px; font-weight: 700; color: #fff; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(currentUser.username)}
        </span>
        <span style="font-size: 10px; font-weight: 800; color: ${tierBadgeColor}; text-transform: uppercase;">
          ${escapeHtml(currentUser.tier)} · ${expiryLabel}
        </span>
      </div>
      <button class="btn-outline" style="padding: 2px 8px; font-size: 11px;" title="Kích hoạt mã Key" onclick="openAuthModal('activate')">
        💎
      </button>
      <button class="btn-outline" style="padding: 2px 8px; font-size: 11px; color: var(--danger);" title="Đăng xuất" onclick="logout()">
        ✕
      </button>
    </div>
  `;
}

function checkUserLicenseAccess() {
  if (!currentUser) {
    openAuthModal("login");
    alert("Vui lòng đăng nhập hoặc đăng ký tài khoản để sử dụng tính năng tạo video!\nLiên hệ gia hạn License qua Zalo: 0764894250 để được cấp phép.");
    return false;
  }
  const isLifetime = currentUser.expiresAt && currentUser.expiresAt.startsWith("2099");
  if (!isLifetime && currentUser.expiresAt && new Date(currentUser.expiresAt).getTime() < Date.now()) {
    openAuthModal("activate");
    alert("Tài khoản của bạn đã hết hạn bản quyền!\nVui lòng gia hạn License qua Zalo: 0764894250 để được kích hoạt tiếp tục sử dụng.");
    return false;
  }
  return true;
}

function openAuthModal(tab = "login") {
  const modal = document.getElementById("auth-modal");
  if (modal) {
    modal.classList.add("active");
    switchAuthTab(tab);
  }
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("active");
}

function switchAuthTab(tab) {
  document.getElementById("form-login").style.display = tab === "login" ? "flex" : "none";
  document.getElementById("form-register").style.display = tab === "register" ? "flex" : "none";
  document.getElementById("form-activate").style.display = tab === "activate" ? "flex" : "none";

  document.getElementById("auth-tab-login").classList.toggle("active", tab === "login");
  document.getElementById("auth-tab-register").classList.toggle("active", tab === "register");
  document.getElementById("auth-tab-activate").classList.toggle("active", tab === "activate");
}

function fillAdminAccount() {
  document.getElementById("login-email").value = "admin@fingreen.vn";
  document.getElementById("login-password").value = "admin";
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentUser = data.user;
    localStorage.setItem("fingreen_user", JSON.stringify(currentUser));
    renderUserAuthChip();
    closeAuthModal();
    alert(`Chào mừng ${currentUser.username} trở lại với FinGreen!`);
  } catch (err) {
    alert("Đăng nhập thất bại: " + err.message);
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("reg-username").value;
  const email = document.getElementById("reg-email").value;
  const password = document.getElementById("reg-password").value;
  const licenseKey = document.getElementById("reg-key").value;

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, licenseKey }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentUser = data.user;
    localStorage.setItem("fingreen_user", JSON.stringify(currentUser));
    renderUserAuthChip();
    closeAuthModal();
    if (licenseKey && licenseKey.trim()) {
      alert(`Đăng ký tài khoản thành công!\nGói bản quyền kích hoạt: ${currentUser.tier.toUpperCase()}`);
    } else {
      alert(`Đăng ký tài khoản thành công!\n⚠️ Vui lòng gia hạn License qua Zalo: 0764894250 để được cấp phép sử dụng đầy đủ các tính năng.`);
    }
  } catch (err) {
    alert("Đăng ký thất bại: " + err.message);
  }
}

async function handleActivateSubmit(e) {
  e.preventDefault();
  const licenseKey = document.getElementById("activate-key-input").value;
  const userId = currentUser ? currentUser.id : "guest";

  try {
    const res = await fetch("/api/auth/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, licenseKey }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentUser = data.user;
    localStorage.setItem("fingreen_user", JSON.stringify(currentUser));
    renderUserAuthChip();
    closeAuthModal();
    alert(`Chúc mừng! Tài khoản đã được nâng cấp lên gói: ${currentUser.tier.toUpperCase()}`);
  } catch (err) {
    alert("Kích hoạt thất bại: " + err.message);
  }
}

function logout() {
  if (confirm("Bạn có chắc chắn muốn đăng xuất?")) {
    currentUser = null;
    localStorage.removeItem("fingreen_user");
    renderUserAuthChip();
  }
}

// ── 1. NAVIGATION TABS ──
function switchTab(tabName) {
  if (tabName === "admin" && (!currentUser || currentUser.role !== "admin")) {
    alert("⚠️ Quyền truy cập bị từ chối!\nBạn cần đăng nhập bằng tài khoản có vai trò Quản trị viên (Admin) trong Supabase để mở Admin Panel.");
    openAuthModal("login");
    return;
  }

  document.querySelectorAll(".tab-pane").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((el) => el.classList.remove("active"));

  const targetPane = document.getElementById(`tab-${tabName}`);
  if (targetPane) targetPane.classList.add("active");

  const btns = document.querySelectorAll(".nav-btn");
  btns.forEach((btn) => {
    if (btn.getAttribute("onclick")?.includes(tabName)) {
      btn.classList.add("active");
    }
  });

  if (tabName === "videos") loadVideoGallery();
  if (tabName === "admin") loadAdminKeys();
}

// ── 2. MARKET RADAR (NEWS SCANNER) ──
async function loadNews(source = "all") {
  const container = document.getElementById("news-grid-container");
  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--emerald-light);">
      <div style="font-size: 24px; margin-bottom: 8px;">📡</div>
      Đang quét tin tức thời gian thực từ các cổng tài chính chứng khoán...
    </div>
  `;

  try {
    const res = await fetch(`/api/news?source=${source}`);
    const data = await res.json();
    if (!data.success || !data.articles || data.articles.length === 0) {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">Không tìm thấy tin tức. Hãy thử lại hoặc dán link bài báo vào ô tìm kiếm trên.</div>`;
      return;
    }

    container.innerHTML = data.articles
      .map(
        (a) => `
      <div class="news-card">
        <div>
          <div class="news-meta">
            <span class="news-source-badge">${escapeHtml(a.source)}</span>
            <span class="news-time">${escapeHtml(a.publishedAt || "Mới nhận")}</span>
          </div>
          <h3 class="news-title">${escapeHtml(a.title)}</h3>
          <p class="news-summary">${escapeHtml(a.summary)}</p>
        </div>
        <div class="news-footer">
          <a href="${escapeHtml(a.url)}" target="_blank" style="font-size: 12px; color: var(--text-dim); text-decoration: none;">Xem gốc ↗</a>
          <button class="btn-render-trigger" onclick="extractAndPrepare('${escapeJs(a.url)}')">
            <span>⚡</span> Tạo Video
          </button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">Lỗi kết nối máy chủ tin tức: ${err.message}</div>`;
  }
}

function filterSource(source, btn) {
  document.querySelectorAll(".source-pill").forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
  loadNews(source);
}

// ── 3. EXTRACT ARTICLE & GENERATE SCRIPT ──
async function extractAndPrepare(url) {
  if (!checkUserLicenseAccess()) return;

  if (!url || !url.trim().startsWith("http")) {
    alert("Vui lòng nhập hoặc dán đường dẫn (URL) bài báo hợp lệ!");
    return;
  }

  switchTab("studio");
  logToConsole(`[BƯỚC 1] Bắt đầu quét bài báo: ${url}`, "highlight");
  setStepState("step-extract", "active");
  setProgress(10);

  const aiBanner = document.getElementById("ai-processing-banner");
  if (aiBanner) aiBanner.style.display = "flex";

  try {
    // 1. Extract
    const extRes = await fetch("/api/news/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const extData = await extRes.json();
    if (!extData.success) throw new Error(extData.error);

    setStepState("step-extract", "completed");
    logToConsole(`[BƯỚC 1] Trích xuất thành công: "${extData.data.title}"`);
    currentOgImage = extData.data.ogImage;
    currentSourceDomain = extData.data.domain;

    // 2. Generate Script with Gemini
    setStepState("step-gemini", "active");
    setProgress(25);
    logToConsole(`[BƯỚC 2] Đang chuyển thể sang kịch bản TikTok ngắn 60s bằng Google Gemini AI...`, "highlight");

    const scRes = await fetch("/api/pipeline/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: extData.data.title,
        content: extData.data.content,
        sourceDomain: extData.data.domain,
      }),
    });
    const scData = await scRes.json();
    if (!scData.success) throw new Error(scData.error);

    currentScript = scData.script;
    setStepState("step-gemini", "completed");
    setProgress(35);
    logToConsole(`[BƯỚC 2] Kịch bản hoàn tất gồm ${currentScript.scenes.length} scenes.`);

    renderScriptEditor(currentScript);
    logToConsole(`[SẴN SÀNG] Bạn có thể kiểm tra lời thoại bên phải và bấm "Bắt Đầu Render Video" để xuất MP4!`);
  } catch (err) {
    logToConsole(`[LỖI] ${err.message}`, "error");
    alert("Lỗi trích xuất: " + err.message);
  } finally {
    if (aiBanner) aiBanner.style.display = "none";
  }
}

function renderScriptEditor(script) {
  document.getElementById("script-title-input").value = script.metadata.title;
  const container = document.getElementById("scene-editor-container");

  container.innerHTML = script.scenes
    .map(
      (s, idx) => `
    <div class="scene-card">
      <div class="scene-header">
        <span class="scene-badge">SCENE ${idx + 1}: ${s.id.toUpperCase()} (${s.templateData.template})</span>
        <small style="color: var(--text-dim); font-size: 11px;">Mẫu hiển thị: ${s.templateData.template}</small>
      </div>
      <div style="margin-bottom: 8px;">
        <label style="font-size: 11px; color: var(--text-dim); font-weight: 700; margin-bottom: 4px; display: block;">LỜI ĐỌC THUYẾT MINH (PHIÊN ÂM CHUẨN TTS)</label>
        <textarea class="scene-textarea" onchange="updateSceneVoiceText('${s.id}', this.value)">${escapeHtml(s.voiceText)}</textarea>
      </div>
    </div>
  `
    )
    .join("");
}

function updateSceneVoiceText(sceneId, newText) {
  if (!currentScript) return;
  const target = currentScript.scenes.find((s) => s.id === sceneId);
  if (target) target.voiceText = newText;
}

// ── 4. RENDER PIPELINE & LIVE PROGRESS ──
async function startCurrentRender() {
  if (!checkUserLicenseAccess()) return;

  if (!currentScript) {
    alert("Chưa có kịch bản nào! Vui lòng chọn một bài báo ở Trạm Quét Tin trước.");
    return;
  }

  // Update title from input
  currentScript.metadata.title = document.getElementById("script-title-input").value;

  const btn = document.getElementById("btn-start-render");
  btn.disabled = true;
  btn.innerText = "⏳ Đang Xử Lý...";

  // Reset steps
  setStepState("step-voice", "active");
  setStepState("step-render", "");
  document.getElementById("video-preview-card").style.display = "none";

  logToConsole(`[RENDER] Bắt đầu khởi chạy Pipeline sản xuất video...`, "highlight");

  try {
    const res = await fetch("/api/pipeline/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: currentScript,
        ogImageUrl: currentOgImage,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const jobId = data.jobId;
    listenJobProgress(jobId);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<span>🚀</span> Bắt Đầu Render Video`;
    logToConsole(`[LỖI RENDER] ${err.message}`, "error");
    alert("Lỗi: " + err.message);
  }
}

function listenJobProgress(jobId) {
  if (sseEventSource) sseEventSource.close();

  sseEventSource = new EventSource(`/api/pipeline/progress/${jobId}`);

  sseEventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      setProgress(event.percent);

      if (event.status === "voice") {
        setStepState("step-voice", "active");
        logToConsole(`[VOICE] ${event.stepDescription}`);
      } else if (event.status === "rendering") {
        setStepState("step-voice", "completed");
        setStepState("step-render", "active");
        if (event.currentFrame && event.totalFrames) {
          logToConsole(`[RENDER FRAME] ${event.currentFrame} / ${event.totalFrames} frames (${event.elapsedSec}s)`);
        } else {
          logToConsole(`[RENDER] ${event.stepDescription}`);
        }
      } else if (event.status === "completed") {
        setStepState("step-render", "completed");
        setProgress(100);
        logToConsole(`[HOÀN TẤT] Video MP4 đã tạo thành công trong ${event.elapsedSec} giây!`, "highlight");

        const btn = document.getElementById("btn-start-render");
        btn.disabled = false;
        btn.innerHTML = `<span>🚀</span> Render Lại Video`;

        // Show player
        if (event.videoUrl) {
          showVideoPreview(event.videoUrl);
        }
        sseEventSource.close();
      } else if (event.status === "failed") {
        setStepState("step-render", "");
        logToConsole(`[LỖI] ${event.error || event.stepDescription}`, "error");
        const btn = document.getElementById("btn-start-render");
        btn.disabled = false;
        btn.innerHTML = `<span>🚀</span> Thử Lại`;
        sseEventSource.close();
      }
    } catch { }
  };

  sseEventSource.onerror = () => {
    sseEventSource.close();
  };
}

function showVideoPreview(url) {
  const card = document.getElementById("video-preview-card");
  const player = document.getElementById("main-video-player");
  const dlBtn = document.getElementById("btn-download-video");

  player.src = url;
  dlBtn.href = url;
  card.style.display = "block";
  card.scrollIntoView({ behavior: "smooth" });
}

function openCurrentOutputFolder() {
  fetch("/api/videos")
    .then((r) => r.json())
    .then((d) => {
      if (d.videos && d.videos.length > 0) {
        fetch("/api/videos/open-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dirPath: d.videos[0].dirPath }),
        });
      }
    });
}

// ── 5. VIDEO GALLERY ──
async function loadVideoGallery() {
  const container = document.getElementById("gallery-grid-container");
  container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">Đang tải kho video...</div>`;

  try {
    const res = await fetch("/api/videos");
    const data = await res.json();
    if (!data.success || !data.videos || data.videos.length === 0) {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">Chưa có video nào trong kho. Hãy bắt đầu tạo video đầu tiên!</div>`;
      return;
    }

    container.innerHTML = data.videos
      .map(
        (v) => `
      <div class="news-card">
        <div>
          <div style="background: #000; border-radius: 8px; overflow: hidden; margin-bottom: 12px; height: 180px; display: flex; align-items: center; justify-content: center; position: relative;">
            ${v.thumbnailUrl
            ? `<img src="${v.thumbnailUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`
            : `<div style="font-size: 32px;">🎬</div>`
          }
            <button onclick="playModalVideo('${v.videoUrl}')" style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: var(--emerald); border: none; color: #fff; font-size: 18px; cursor: pointer; box-shadow: 0 0 16px var(--emerald-glow);">▶</button>
          </div>
          <div class="news-meta">
            <span class="news-source-badge">${escapeHtml(v.channel)}</span>
            <span class="news-time">${v.sizeMb} MB</span>
          </div>
          <h3 class="news-title" style="-webkit-line-clamp: 2;">${escapeHtml(v.title)}</h3>
        </div>
        <div class="news-footer">
          <a href="${v.videoUrl}" download class="btn-outline" style="text-decoration: none; font-size: 12px;">Tải về MP4</a>
          <button class="btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="openFolder('${escapeJs(v.dirPath)}')">📁 Mở Thư Mục</button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1/-1; color: var(--danger);">Lỗi tải thư viện: ${err.message}</div>`;
  }
}

function openFolder(path) {
  fetch("/api/videos/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dirPath: path }),
  });
}

function playModalVideo(url) {
  switchTab("studio");
  showVideoPreview(url);
}

// ── 6. BRAND SETTINGS ──
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      if (document.getElementById("cfg-channel-name")) document.getElementById("cfg-channel-name").value = s.channelName || "FinGreen";
      if (document.getElementById("cfg-channel-handle")) document.getElementById("cfg-channel-handle").value = s.channelHandle || "@fingreenvn";
      if (document.getElementById("cfg-followers")) document.getElementById("cfg-followers").value = s.followers || "";
      if (document.getElementById("cfg-voice")) document.getElementById("cfg-voice").value = s.voice || "vi-VN-NamMinhNeural";
      if (document.getElementById("cfg-rate")) document.getElementById("cfg-rate").value = s.rate || "+0%";
      if (document.getElementById("cfg-gemini-key")) document.getElementById("cfg-gemini-key").value = s.geminiApiKey || "";
      if (document.getElementById("admin-supabase-url")) document.getElementById("admin-supabase-url").value = s.supabaseUrl || "https://ldfitmwixgurshoxpshr.supabase.co";
      if (document.getElementById("admin-supabase-key")) document.getElementById("admin-supabase-key").value = s.supabaseAnonKey || "sb_publishable_PR0PhZ92DH9Ky8EonRCKtw_4X5C3lHN";
    }
  } catch { }
}

async function saveSettings() {
  const body = {
    channelName: document.getElementById("cfg-channel-name").value,
    channelHandle: document.getElementById("cfg-channel-handle").value,
    followers: document.getElementById("cfg-followers").value,
    voice: document.getElementById("cfg-voice").value,
    rate: document.getElementById("cfg-rate").value,
    geminiApiKey: document.getElementById("cfg-gemini-key").value,
  };

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (d.success) alert("Đã lưu cấu hình thương hiệu FinGreen thành công!");
    else alert("Lỗi: " + d.error);
  } catch (e) {
    alert("Lỗi lưu cài đặt: " + e.message);
  }
}

function handleLogoUpload(input, type) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Data = e.target.result;
    try {
      const res = await fetch("/api/settings/upload-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, base64Data }),
      });
      const d = await res.json();
      if (d.success) {
        if (type === "header") {
          document.getElementById("preview-logo-1").src = d.url;
          document.getElementById("nav-logo-img").src = d.url;
        } else {
          document.getElementById("preview-logo-2").src = d.url;
        }
        alert(d.message);
      } else {
        alert("Lỗi: " + d.error);
      }
    } catch (err) {
      alert("Lỗi tải ảnh: " + err.message);
    }
  };
  reader.readAsDataURL(file);
}

// ── 7. ADMIN & LICENSE MANAGEMENT ──
async function loadAdminKeys() {
  const tbody = document.getElementById("admin-keys-tbody");
  try {
    const res = await fetch("/api/admin/keys");
    const data = await res.json();
    if (!data.success) return;

    const keys = data.keys || [];
    document.getElementById("stat-total-keys").innerText = keys.length;
    document.getElementById("stat-active-keys").innerText = keys.filter((k) => k.status === "active").length;

    // Videos total
    const vRes = await fetch("/api/videos");
    const vData = await vRes.json();
    if (vData.videos) document.getElementById("stat-total-videos").innerText = vData.videos.length;

    if (keys.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">Chưa có key bản quyền nào được tạo.</td></tr>`;
      return;
    }

    tbody.innerHTML = keys
      .map((k) => {
        const isExpired = k.expiresAt !== "2099-12-31T23:59:59.000Z" && new Date(k.expiresAt).getTime() < Date.now();
        const displayStatus = k.status === "revoked" ? "ĐÃ KHÓA" : isExpired ? "HẾT HẠN" : "HOẠT ĐỘNG";
        const statusClass = k.status === "active" && !isExpired ? "active" : "revoked";
        const expiryText = k.expiresAt.startsWith("2099") ? "VĨNH VIỄN (LIFETIME)" : new Date(k.expiresAt).toLocaleDateString("vi-VN");

        return `
        <tr>
          <td>
            <span class="key-code">${escapeHtml(k.key)}</span>
            <button class="btn-outline" style="padding: 2px 6px; font-size: 10px; margin-left: 6px;" onclick="copyKey('${k.key}')">Copy</button>
          </td>
          <td><span style="font-weight: 700; text-transform: uppercase;">${escapeHtml(k.tier)}</span></td>
          <td>${escapeHtml(k.customerName || "Khách hàng")}</td>
          <td>${expiryText}</td>
          <td><span class="status-pill ${statusClass}">${displayStatus}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="adminExtendKey('${k.id}', 30)">+30 Ngày</button>
              <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="adminExtendKey('${k.id}', 90)">+90 Ngày</button>
              <button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: ${k.status === "active" ? "var(--danger)" : "var(--emerald-light)"}" onclick="adminToggleKey('${k.id}')">
                ${k.status === "active" ? "Khóa" : "Mở"}
              </button>
              <button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--danger);" onclick="adminDeleteKey('${k.id}')">Xóa</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");
  } catch { }
}

async function adminCreateKey() {
  const tierVal = document.getElementById("admin-key-tier").value;
  let duration = 30;
  let tier = "creator_pro";

  if (tierVal === "trial") {
    duration = 7;
    tier = "trial";
  } else if (tierVal === "creator_pro") {
    duration = 30;
    tier = "creator_pro";
  } else if (tierVal === "fintech_vip") {
    duration = 90;
    tier = "fintech_vip";
  } else if (tierVal === "fintech_vip_year") {
    duration = 365;
    tier = "fintech_vip";
  } else if (tierVal === "lifetime") {
    duration = 0;
    tier = "lifetime";
  }

  const customerName = document.getElementById("admin-key-customer").value;
  const customerNote = document.getElementById("admin-key-note").value;

  try {
    const res = await fetch("/api/admin/keys/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, durationDays: duration, customerName, customerNote }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`Đã tạo key thành công:\n${data.key.key}\n(Đã đồng bộ lên Supabase Cloud)`);
      document.getElementById("admin-key-customer").value = "";
      document.getElementById("admin-key-note").value = "";
      loadAdminKeys();
    }
  } catch (err) {
    alert("Lỗi tạo key: " + err.message);
  }
}

async function adminExtendKey(keyId, days) {
  try {
    const res = await fetch("/api/admin/keys/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId, days }),
    });
    const d = await res.json();
    if (d.success) {
      alert(`Đã gia hạn thành công thêm ${days} ngày cho key!`);
      loadAdminKeys();
    }
  } catch (e) {
    alert("Lỗi gia hạn: " + e.message);
  }
}

async function adminToggleKey(keyId) {
  try {
    const res = await fetch("/api/admin/keys/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId }),
    });
    const d = await res.json();
    if (d.success) loadAdminKeys();
  } catch (e) {
    alert("Lỗi thao tác: " + e.message);
  }
}

async function adminDeleteKey(keyId) {
  if (!confirm("Bạn có chắc chắn muốn xóa key bản quyền này?")) return;
  try {
    await fetch(`/api/admin/keys/${keyId}`, { method: "DELETE" });
    loadAdminKeys();
  } catch (e) {
    alert("Lỗi xóa: " + e.message);
  }
}

function copyKey(k) {
  navigator.clipboard.writeText(k);
  alert("Đã sao chép mã Key: " + k);
}

async function saveSupabaseConfig() {
  const supabaseUrl = document.getElementById("admin-supabase-url").value;
  const supabaseAnonKey = document.getElementById("admin-supabase-key").value;

  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supabaseUrl, supabaseAnonKey }),
    });
    alert("✓ Kết nối Supabase Cloud thành công!\nToàn bộ dữ liệu Key và Khách hàng đã được đồng bộ với Supabase.");
  } catch (e) {
    alert("Lỗi lưu Supabase: " + e.message);
  }
}

// ── UTILITIES ──
function setProgress(pct) {
  document.getElementById("render-percent").innerText = `${pct}%`;
  document.getElementById("render-progress-bar").style.width = `${pct}%`;
}

function setStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.classList.remove("active", "completed");
  if (state) el.classList.add(state);
}

function logToConsole(msg, type = "normal") {
  const consoleEl = document.getElementById("render-console");
  const time = new Date().toLocaleTimeString("vi-VN");
  const div = document.createElement("div");
  const color = type === "highlight" ? "var(--emerald-light)" : type === "error" ? "var(--danger)" : "#cbd5e1";
  div.innerHTML = `<span class="log-time">[${time}]</span> <span style="color: ${color};">${escapeHtml(msg)}</span>`;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeJs(str) {
  if (!str) return "";
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

