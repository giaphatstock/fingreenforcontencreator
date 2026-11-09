import express from "express";
import cors from "cors";
import { join, basename } from "node:path";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { scanFinancialNews, extractArticleContent } from "./news-scanner.js";
import { generateScriptWithGemini } from "./gemini-script-service.js";
import { pipelineRunner } from "./pipeline-runner.js";
import { licenseManager } from "./license-manager.js";
import { loadConfig } from "../config.js";
import { spawn } from "node:child_process";

const app = express();
const PORT = 3721;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static directories
const PUBLIC_DIR = join(process.cwd(), "public");
const OUTPUT_DIR = join(process.cwd(), "output");
const ASSETS_DIR = join(process.cwd(), "assets");

app.use(express.static(PUBLIC_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.use("/assets", express.static(ASSETS_DIR));

// ── 1. NEWS SCANNER ENDPOINTS ──
app.get("/api/news", async (req, res) => {
  try {
    const source = (req.query.source as string) || "all";
    const articles = await scanFinancialNews(source);
    res.json({ success: true, count: articles.length, articles });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/news/extract", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "Vui lòng nhập URL bài báo" });
    const data = await extractArticleContent(url);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 2. SCRIPT GENERATION (GEMINI) ──
app.post("/api/pipeline/script", async (req, res) => {
  try {
    const { title, content, sourceDomain, apiKey } = req.body;
    const cfg = loadConfig();
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY || "";

    const script = await generateScriptWithGemini({
      title,
      content,
      sourceDomain: sourceDomain || "cafef.vn",
      apiKey: effectiveKey,
      channelName: cfg.tiktok.displayName,
      channelHandle: cfg.tiktok.handle,
    });

    res.json({ success: true, script });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 3. PIPELINE RENDER & PROGRESS (SSE) ──
let currentJobId = "";

app.post("/api/pipeline/render", async (req, res) => {
  try {
    const { script, ogImageUrl, licenseKey } = req.body;
    if (!script) return res.status(400).json({ success: false, error: "Thiếu dữ liệu script" });

    currentJobId = `job_${Date.now()}`;
    licenseManager.recordRender(licenseKey);

    // Run pipeline asynchronously
    pipelineRunner.run(script, ogImageUrl).catch((e) => console.error("Render failed:", e));

    res.json({ success: true, jobId: currentJobId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/pipeline/progress/:jobId", (req, res) => {
  const { jobId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const initial = pipelineRunner.getJob(jobId);
  if (initial) sendEvent(initial);

  pipelineRunner.onProgress(jobId, (event) => {
    sendEvent(event);
    if (event.status === "completed" || event.status === "failed") {
      setTimeout(() => res.end(), 1000);
    }
  });

  req.on("close", () => {
    // client disconnected
  });
});

// ── 4. VIDEO HISTORY & LIST ──
app.get("/api/videos", (req, res) => {
  try {
    if (!existsSync(OUTPUT_DIR)) return res.json({ success: true, videos: [] });
    const items = readdirSync(OUTPUT_DIR);
    const videos: any[] = [];

    for (const item of items) {
      const dirPath = join(OUTPUT_DIR, item);
      const stat = statSync(dirPath);
      if (stat.isDirectory()) {
        const videoPath = join(dirPath, "video.mp4");
        if (existsSync(videoPath)) {
          const scriptPath = join(dirPath, "script.json");
          let title = item;
          let channel = "FinGreen";
          if (existsSync(scriptPath)) {
            try {
              const sc = JSON.parse(readFileSync(scriptPath, "utf-8"));
              title = sc.metadata?.title || item;
              channel = sc.metadata?.channel || "FinGreen";
            } catch {}
          }
          const videoStat = statSync(videoPath);
          videos.push({
            id: item,
            title,
            channel,
            createdAt: stat.mtime.toISOString(),
            sizeMb: (videoStat.size / (1024 * 1024)).toFixed(1),
            videoUrl: `/output/${item}/video.mp4`,
            thumbnailUrl: existsSync(join(dirPath, "thumbnail.jpg")) ? `/output/${item}/thumbnail.jpg` : null,
            dirPath,
          });
        }
      }
    }

    // Sort newest first
    videos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, videos });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open folder on Windows explorer
app.post("/api/videos/open-folder", (req, res) => {
  const { dirPath } = req.body;
  if (dirPath && existsSync(dirPath)) {
    spawn("explorer.exe", [dirPath], { detached: true });
    return res.json({ success: true });
  }
  res.status(404).json({ success: false, error: "Thư mục không tồn tại" });
});

// ── 5. SETTINGS ENDPOINTS ──
app.get("/api/settings", (req, res) => {
  try {
    const cfg = loadConfig();
    res.json({
      success: true,
      settings: {
        channelName: cfg.tiktok.displayName,
        channelHandle: cfg.tiktok.handle,
        followers: cfg.tiktok.followers,
        voice: cfg.edgeTtsVoice,
        rate: cfg.edgeTtsRate,
        theme: cfg.videoTheme,
        geminiApiKey: process.env.GEMINI_API_KEY || "",
        supabaseUrl: process.env.SUPABASE_URL || "",
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const { channelName, channelHandle, followers, voice, rate, geminiApiKey, supabaseUrl, supabaseAnonKey } = req.body;
    const envPath = join(process.cwd(), ".env.local");
    let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";

    const updateOrAppend = (key: string, val: string) => {
      const reg = new RegExp(`^${key}=.*$`, "m");
      if (reg.test(content)) {
        content = content.replace(reg, `${key}=${val}`);
      } else {
        content += `\n${key}=${val}`;
      }
    };

    if (channelName !== undefined) updateOrAppend("TIKTOK_DISPLAY_NAME", channelName);
    if (channelHandle !== undefined) updateOrAppend("TIKTOK_HANDLE", channelHandle);
    if (followers !== undefined) updateOrAppend("TIKTOK_FOLLOWERS", followers);
    if (voice !== undefined) updateOrAppend("EDGE_TTS_VOICE", voice);
    if (rate !== undefined) updateOrAppend("EDGE_TTS_RATE", rate);
    if (geminiApiKey !== undefined) updateOrAppend("GEMINI_API_KEY", geminiApiKey);
    if (supabaseUrl !== undefined) updateOrAppend("SUPABASE_URL", supabaseUrl);
    if (supabaseAnonKey !== undefined) updateOrAppend("SUPABASE_ANON_KEY", supabaseAnonKey);

    await writeFile(envPath, content, "utf-8");
    await writeFile(join(process.cwd(), ".env"), content, "utf-8");

    res.json({ success: true, message: "Đã lưu cấu hình thành công!" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload Logo 1 or Logo 2
app.post("/api/settings/upload-logo", async (req, res) => {
  try {
    const { type, base64Data } = req.body; // type: "header" | "avatar"
    if (!base64Data) return res.status(400).json({ success: false, error: "Thiếu dữ liệu ảnh" });

    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ success: false, error: "Định dạng ảnh không hợp lệ" });
    }

    const buffer = Buffer.from(matches[2], "base64");
    if (type === "header") {
      const dest = join(ASSETS_DIR, "logo.png");
      await writeFile(dest, buffer);
      res.json({ success: true, message: "Đã cập nhật Logo góc trên bên trái!", url: `/assets/logo.png?t=${Date.now()}` });
    } else {
      const dest = join(ASSETS_DIR, "avatar.png");
      await writeFile(dest, buffer);
      res.json({ success: true, message: "Đã cập nhật Avatar thẻ Outro!", url: `/assets/avatar.png?t=${Date.now()}` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 5.5 AUTHENTICATION ENDPOINTS ──
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password, licenseKey } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập đầy đủ Tên, Email và Mật khẩu" });
    }
    const result = await licenseManager.registerUser({ username, email, password, licenseKey });
    res.json({ success: true, user: result.user });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập Email và Mật khẩu" });
    }
    const result = await licenseManager.loginUser({ email, password });
    res.json({ success: true, user: result.user });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/activate", async (req, res) => {
  try {
    const { userId, licenseKey } = req.body;
    if (!userId || !licenseKey) {
      return res.status(400).json({ success: false, error: "Vui lòng cung cấp mã Key kích hoạt" });
    }
    const user = await licenseManager.activateKeyForUser(userId, licenseKey);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── 6. ADMIN & LICENSE MANAGEMENT ──
app.get("/api/admin/keys", (req, res) => {
  res.json({ success: true, keys: licenseManager.getKeys() });
});

app.post("/api/admin/keys/create", (req, res) => {
  try {
    const { tier, durationDays, customerName, customerNote } = req.body;
    const newKey = licenseManager.createKey({
      tier: tier || "creator_pro",
      durationDays: parseInt(durationDays ?? 30, 10),
      customerName,
      customerNote,
    });
    res.json({ success: true, key: newKey });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/admin/keys/extend", (req, res) => {
  try {
    const { keyId, days } = req.body;
    const updated = licenseManager.extendKey(keyId, parseInt(days || 30, 10));
    res.json({ success: true, key: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/admin/keys/toggle", (req, res) => {
  try {
    const { keyId } = req.body;
    const updated = licenseManager.toggleKeyStatus(keyId);
    res.json({ success: true, key: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/admin/keys/:id", (req, res) => {
  try {
    const deleted = licenseManager.deleteKey(req.params.id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/admin/users", (req, res) => {
  res.json({ success: true, users: licenseManager.getUsers() });
});

export default app;
export { app };

// Start Server locally if not running under Vercel serverless
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` FinGreen For Content Creator Server is Running!`);
    console.log(` Web & API: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

