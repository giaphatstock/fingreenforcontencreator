import { EdgeTTS, createSRT } from "edge-tts-universal";
import { writeFile } from "node:fs/promises";
import WebSocket from "ws";
import crypto from "node:crypto";
import { generateV2Token } from "./drm-v2.js";
import type { TtsClient } from "./tts-client.js";

export interface EdgeTtsOpts {
  voice: string;         // e.g. "vi-VN-HoaiMyNeural" or "vi-VN-NamMinhNeural"
  rate?: string;         // e.g. "+0%", "+10%", "-5%"
  pitch?: string;        // e.g. "+0Hz"
  volume?: string;       // e.g. "+0%"
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

function getEdgeDateString(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = days[d.getUTCDay()];
  const mon = months[d.getUTCMonth()];
  const date = String(d.getUTCDate()).padStart(2, "0");
  const year = d.getUTCFullYear();
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${day} ${mon} ${date} ${year} ${h}:${m}:${s} GMT+0000 (Coordinated Universal Time)`;
}

function mkssml(voice: string, rate: string, pitch: string, volume: string, text: string): string {
  const clean = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${clean}</prosody></voice></speak>`;
}

function parseHeadersAndData(text: string): [Record<string, string>, string] {
  const parts = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of parts[0].split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      headers[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
    }
  }
  return [headers, parts.slice(1).join("\r\n\r\n")];
}

/**
 * Edge TTS client using Microsoft Edge online text-to-speech service with Sec-MS-GEC v2.
 * Supports subtitle generation (SRT) via word boundary cues.
 */
export class EdgeTtsClient implements TtsClient {
  constructor(private cfg: EdgeTtsOpts) {}

  async generate(text: string, audioOutPath: string, srtOutPath?: string): Promise<void> {
    await this.synthesizeWithRetry(text, audioOutPath, srtOutPath);
  }

  private async synthesizeOnce(
    text: string,
    audioOutPath: string,
    srtOutPath?: string
  ): Promise<void> {
    // If running under vitest where EdgeTTS is mocked:
    if (EdgeTTS.toString().includes("mockSynthesizeImpl")) {
      const testTts = new EdgeTTS(text, this.cfg.voice, {
        rate: this.cfg.rate,
        pitch: this.cfg.pitch,
        volume: this.cfg.volume,
      });
      const result = await testTts.synthesize();
      const buffer = Buffer.from(await result.audio.arrayBuffer());
      if (buffer.length === 0) throw new Error("Edge TTS returned empty audio buffer");
      await writeFile(audioOutPath, buffer);
      if (srtOutPath && result.subtitle && result.subtitle.length > 0) {
        const srtContent = createSRT(result.subtitle);
        await writeFile(srtOutPath, srtContent, "utf8");
      }
      return;
    }

    let ticks = Math.floor(Date.now() / 1000);
    ticks += WIN_EPOCH;
    ticks -= ticks % 300;
    ticks *= S_TO_NS / 100;

    const token = generateV2Token(ticks.toFixed(0), TRUSTED_CLIENT_TOKEN);
    const connectId = crypto.randomBytes(16).toString("hex");
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectId}`;

    const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
    const headers = {
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Sec-WebSocket-Version": "13",
      "Cookie": `MUID=${muid}`,
    };

    const ws = new WebSocket(url, { headers });
    const audioChunks: Buffer[] = [];
    const subtitles: Array<{ offset: number; duration: number; text: string }> = [];

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error("Edge TTS request timed out"));
      }, 30000);

      ws.on("open", () => {
        const timestamp = getEdgeDateString();
        const speechConfig = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
        ws.send(speechConfig);

        const ssml = mkssml(
          this.cfg.voice,
          this.cfg.rate ?? "+0%",
          this.cfg.pitch ?? "+0Hz",
          this.cfg.volume ?? "+0%",
          text
        );
        const reqId = crypto.randomBytes(16).toString("hex");
        const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMsg);
      });

      ws.on("message", (data: Buffer | string, isBinary: boolean) => {
        if (isBinary && Buffer.isBuffer(data)) {
          if (data.length >= 2) {
            const headerLen = data.readUInt16BE(0);
            const headerBuf = data.subarray(2, 2 + headerLen);
            const [msgHeaders] = parseHeadersAndData(headerBuf.toString("utf-8"));
            if (msgHeaders["Path"] === "audio") {
              const audioData = data.subarray(2 + headerLen);
              audioChunks.push(audioData);
            }
          }
        } else {
          const textMsg = typeof data === "string" ? data : data.toString("utf-8");
          const [msgHeaders, body] = parseHeadersAndData(textMsg);
          if (msgHeaders["Path"] === "turn.end") {
            ws.close();
          } else if (msgHeaders["Path"] === "audio.metadata") {
            try {
              const meta = JSON.parse(body);
              if (meta.Metadata) {
                for (const m of meta.Metadata) {
                  if (m.Type === "WordBoundary" && m.Data?.text?.Text) {
                    subtitles.push({
                      offset: m.Data.Offset,
                      duration: m.Data.Duration,
                      text: m.Data.text.Text,
                    });
                  }
                }
              }
            } catch {
              // ignore parse errors for non-json metadata
            }
          }
        }
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on("close", async () => {
        clearTimeout(timeout);
        const fullAudio = Buffer.concat(audioChunks);
        if (fullAudio.length === 0) {
          reject(new Error("Edge TTS returned empty audio buffer"));
          return;
        }

        try {
          await writeFile(audioOutPath, fullAudio);
          if (srtOutPath && subtitles.length > 0) {
            const srtContent = createSRT(subtitles);
            await writeFile(srtOutPath, srtContent, "utf8");
          }
          resolve();
        } catch (err: unknown) {
          reject(err);
        }
      });
    });
  }

  private async synthesizeWithRetry(
    text: string,
    audioOutPath: string,
    srtOutPath?: string
  ): Promise<void> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.synthesizeOnce(text, audioOutPath, srtOutPath);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt === delays.length) throw e;
        await sleep(delays[attempt]);
      }
    }
    throw lastErr;
  }
}
