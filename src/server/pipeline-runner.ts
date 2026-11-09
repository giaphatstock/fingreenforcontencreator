import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { type Script } from "../render/script-schema.js";
import { loadConfig } from "../config.js";
import { createTtsClient } from "../tts/tts-client.js";
import { getDurationSec, concatWithSilence } from "../assets/audio-tools.js";
import { composeHtml } from "../render/html-composer.js";
import { toSlug } from "../utils/slug.js";
import type { RenderProgressEvent } from "./types.js";

const SCENE_GAP_SEC = 0.3;
const OUTRO_HOLD_SEC = 3.0;

export class PipelineRunner {
  private activeJobs = new Map<string, RenderProgressEvent>();
  private listeners = new Map<string, (event: RenderProgressEvent) => void>();

  public onProgress(jobId: string, cb: (event: RenderProgressEvent) => void) {
    this.listeners.set(jobId, cb);
  }

  public getJob(jobId: string): RenderProgressEvent | undefined {
    return this.activeJobs.get(jobId);
  }

  private emit(event: RenderProgressEvent) {
    this.activeJobs.set(event.jobId, event);
    const cb = this.listeners.get(event.jobId);
    if (cb) cb(event);
  }

  public async run(script: Script, ogImageUrl?: string): Promise<string> {
    const jobId = `job_${Date.now()}`;
    const startTime = Date.now();
    const cfg = loadConfig();

    const slug = toSlug(script.metadata.title).slice(0, 35);
    const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 12);
    const outputDir = join(process.cwd(), "output", `${slug}-${dateStr}`);
    await mkdir(outputDir, { recursive: true });

    const voiceDir = join(outputDir, "voice");
    await mkdir(voiceDir, { recursive: true });

    try {
      // ── Step 1: Voice Generation ──
      this.emit({
        jobId,
        status: "voice",
        stepTitle: "Tạo Giọng Thuyết Minh AI",
        stepDescription: "Đang chuyển văn bản kịch bản sang giọng đọc tiếng Việt chuẩn...",
        percent: 15,
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });

      const sceneAudios: { id: string; path: string; durationSec: number }[] = [];
      const totalScenes = script.scenes.length;
      const tts = createTtsClient(cfg);

      for (let i = 0; i < totalScenes; i++) {
        const scene = script.scenes[i];
        const audioPath = join(voiceDir, `scene-${scene.id}.mp3`);

        this.emit({
          jobId,
          status: "voice",
          stepTitle: "Tạo Giọng Thuyết Minh AI",
          stepDescription: `Đang lồng tiếng scene ${i + 1}/${totalScenes}: "${scene.id}"`,
          percent: 15 + Math.floor((i / totalScenes) * 20),
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
        });

        await tts.generate(scene.voiceText, audioPath);

        const dur = await getDurationSec(audioPath);
        sceneAudios.push({ id: scene.id, path: audioPath, durationSec: dur });
      }

      // Concat voice
      const fullVoicePath = join(outputDir, "voice.mp3");
      await concatWithSilence(
        sceneAudios.map((a) => a.path),
        SCENE_GAP_SEC,
        fullVoicePath
      );

      // Save script.json
      await writeFile(join(outputDir, "script.json"), JSON.stringify(script, null, 2), "utf-8");

      // Copy assets (avatar, logo)
      let brandLogoFile: string | null = null;
      const bundledLogo = join(process.cwd(), "assets", "logo.png");
      if (existsSync(bundledLogo)) {
        brandLogoFile = "brand-logo.png";
        await copyFile(bundledLogo, join(outputDir, brandLogoFile));
      }

      let bundledAvatar: string | null = null;
      for (const ext of ["png", "jpg", "jpeg", "webp"]) {
        const p = join(process.cwd(), "assets", `avatar.${ext}`);
        if (existsSync(p)) {
          bundledAvatar = p;
          break;
        }
      }
      let ttAvatarFile: string | null = null;
      if (bundledAvatar) {
        const ext = bundledAvatar.split(".").pop()!;
        ttAvatarFile = `tiktok-avatar.${ext}`;
        await copyFile(bundledAvatar, join(outputDir, ttAvatarFile));
      }

      // Download ogImage if present
      let bgImageRelPath: string | null = null;
      if (ogImageUrl) {
        try {
          const imgDir = join(outputDir, "images");
          await mkdir(imgDir, { recursive: true });
          const imgPath = join(imgDir, "bg.jpg");
          const { fetchImage } = await import("../assets/image-fetcher.js");
          await fetchImage(ogImageUrl, imgPath);
          bgImageRelPath = "images/bg.jpg";
        } catch {}
      }

      // ── Step 2: Compose HTML ──
      this.emit({
        jobId,
        status: "rendering",
        stepTitle: "Dựng Khung Video 9:16",
        stepDescription: "Đang biên soạn hoạt họa motion graphic, typography & layout...",
        percent: 40,
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });

      const html = composeHtml({
        script,
        sceneAudio: sceneAudios.map((a) => ({ id: a.id, durationSec: a.durationSec })),
        gapSec: SCENE_GAP_SEC,
        bgImageRelPath: bgImageRelPath,
        audioRelPath: "voice.mp3",
        tiktok: cfg.tiktok,
        tiktokAvatarRelPath: ttAvatarFile || undefined,
        brandLogoRelPath: brandLogoFile || undefined,
        outroHoldSec: OUTRO_HOLD_SEC,
      });

      await writeFile(join(outputDir, "index.html"), html, "utf-8");
      await writeFile(
        join(outputDir, "hyperframes.json"),
        JSON.stringify(
          {
            $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
            registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
            paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
          },
          null,
          2
        ),
        "utf-8"
      );

      const tplDir = join(process.cwd(), "src", "render", "templates");
      await copyFile(join(tplDir, "styles.css"), join(outputDir, "styles.css"));
      await copyFile(join(tplDir, "animations.js"), join(outputDir, "animations.js"));

      // ── Step 3: Hyperframes Render ──
      this.emit({
        jobId,
        status: "rendering",
        stepTitle: "Đang Render Video MP4",
        stepDescription: "Đang chụp từng khung hình Full HD và xuất video...",
        percent: 45,
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });

      const videoMp4Path = join(outputDir, "video.mp4");
      await this.runHyperframesRender(outputDir, videoMp4Path, (curFrame, totalFrames) => {
        const renderProgress = Math.min(50, Math.floor((curFrame / totalFrames) * 50));
        this.emit({
          jobId,
          status: "rendering",
          stepTitle: "Đang Render Video MP4",
          stepDescription: `Đang render khung hình: ${curFrame} / ${totalFrames} frames`,
          percent: 45 + renderProgress,
          currentFrame: curFrame,
          totalFrames,
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
        });
      });

      // Extract thumbnail
      const thumbPath = join(outputDir, "thumbnail.jpg");
      await this.extractThumbnail(videoMp4Path, thumbPath);

      const outputFolderRel = basename(outputDir);
      const videoUrl = `/output/${outputFolderRel}/video.mp4`;

      this.emit({
        jobId,
        status: "completed",
        stepTitle: "Hoàn Tất Xuất Video!",
        stepDescription: "Video đã render thành công Full HD 9:16 và sẵn sàng đăng tải.",
        percent: 100,
        outputPath: videoMp4Path,
        videoUrl,
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });

      return videoMp4Path;
    } catch (err: any) {
      this.emit({
        jobId,
        status: "failed",
        stepTitle: "Lỗi Render Video",
        stepDescription: err?.message || "Đã xảy ra lỗi trong quá trình tạo video.",
        percent: 0,
        error: err?.message || String(err),
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });
      throw err;
    }
  }

  private runHyperframesRender(
    compDir: string,
    outputPath: string,
    onProgress: (cur: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "npx",
        ["hyperframes", "render", compDir, "-o", outputPath, "--fps", "30", "--strict=false"],
        { shell: true, stdio: ["ignore", "pipe", "pipe"] }
      );

      let totalFrames = 1500;
      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        const m = text.match(/Capturing frame (\d+)\/(\d+)/);
        if (m) {
          const cur = parseInt(m[1], 10);
          totalFrames = parseInt(m[2], 10);
          onProgress(cur, totalFrames);
        }
      });

      let errBuf = "";
      child.stderr.on("data", (data: Buffer) => {
        errBuf += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Hyperframes render failed with exit code ${code}: ${errBuf.slice(-400)}`));
      });
    });
  }

  private extractThumbnail(videoPath: string, thumbPath: string): Promise<void> {
    return new Promise((resolve) => {
      const p = spawn("ffmpeg", ["-y", "-ss", "00:00:03", "-i", videoPath, "-vframes", "1", thumbPath], {
        shell: true,
      });
      p.on("close", () => resolve());
    });
  }
}

export const pipelineRunner = new PipelineRunner();
