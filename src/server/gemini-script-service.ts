import axios from "axios";
import { type Script, ScriptSchema } from "../render/script-schema.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `Bạn là biên kịch video tin tức ngắn TikTok/Reels chuyên nghiệp cho kênh tài chính "FinGreen".
Mục tiêu: Chuyển thể nội dung bài báo tài chính/chứng khoán thành kịch bản video motion graphic 9:16 (~60 giây).

QUY TẮC CỐT LÕI:
1. Số scenes: 5 đến 7 scenes (Bắt buộc: 1 scene "hook", 3 đến 5 scene "body", 1 scene "outro").
2. voiceText (lời đọc):
   - Tổng ~150 - 200 từ (~50-60 giây). Văn nói dứt khoát, lôi cuốn, giật tít hook mạnh mẽ.
   - TUYỆT ĐỐI KHÔNG dùng emoji, ký tự lạ trong voiceText.
   - PHIÊN ÂM TIẾNG VIỆT CHO SỐ VÀ KÝ HIỆU (RẤT QUAN TRỌNG VÌ TTS ĐỌC NGUYÊN BẢN):
     + "8.5%" -> "tám phẩy năm phần trăm"
     + "22.000 tỷ" -> "hai mươi hai nghìn tỷ"
     + "VN-Index" -> "Vê En In Đếch"
     + "FinGreen" -> "Phin Rin"
     + "5G" -> "năm gờ"
     + "Apple / OpenAI / TikTok" -> giữ nguyên từ tiếng Anh thông dụng.
3. templateData:
   - scene "hook": { "template": "hook", "headline": "Tiêu đề ngắn < 40 ký tự", "subhead": "Phụ đề < 40 ký tự", "kenBurns": "zoom-in" }
   - scene "body": Chọn 1 trong các template phù hợp với dữ liệu:
     + "stat-hero": { "template": "stat-hero", "value": "120.000 TỶ", "label": "Thanh khoản bùng nổ", "context": "Tăng 35% so với phiên trước" }
     + "callout": { "template": "callout", "statement": "Nhận định quan trọng hoặc cảnh báo", "tag": "LƯU Ý" }
     + "feature-list": { "template": "feature-list", "title": "3 Điểm Nhấn Chính", "bullets": ["Điểm 1", "Điểm 2", "Điểm 3"] }
     + "comparison": { "template": "comparison", "left": { "label": "Lãi suất cũ", "value": "9.5%", "color": "purple" }, "right": { "label": "Lãi suất mới", "value": "6.8%", "color": "cyan", "winner": true } }
   - scene "outro": { "template": "outro", "ctaTop": "Xem tin mới mỗi ngày", "channelName": "FinGreen", "source": "Domain nguồn (vd: cafef.vn)" }
   - voiceText của outro BẮT BUỘC là: "Follow kênh Phin Rin để cập nhật thông tin mới nhất."

Trả về đúng JSON theo định dạng kịch bản chuẩn.`;

export async function generateScriptWithGemini(params: {
  title: string;
  content: string;
  sourceDomain: string;
  apiKey: string;
  channelName?: string;
  channelHandle?: string;
}): Promise<Script> {
  const channel = params.channelName || "FinGreen";
  const userPrompt = `Bài báo cần chuyển thể:
Tiêu đề: ${params.title}
Nguồn: ${params.sourceDomain}
Nội dung:
${params.content.slice(0, 3000)}

Hãy viết kịch bản JSON hoàn chỉnh cho kênh ${channel}.`;

  const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

  for (const model of models) {
    try {
      const url = `${GEMINI_API_URL}/${model}:generateContent?key=${params.apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
          },
        },
        { timeout: 25000 }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        // Fix metadata if missing
        if (!parsed.metadata) {
          parsed.metadata = {
            title: params.title.slice(0, 80),
            channel,
            createdAt: new Date().toISOString(),
          };
        }
        if (!parsed.voice) {
          parsed.voice = {
            provider: "edge-tts",
            voiceId: "vi-VN-NamMinhNeural",
            speedRate: 1.0,
          };
        }
        // Validate with schema
        const validated = ScriptSchema.parse(parsed);
        return validated;
      }
    } catch {}
  }

  // Fallback: Smart rule-based synthesizer
  return generateFallbackScript(params);
}

export function generateFallbackScript(params: {
  title: string;
  content: string;
  sourceDomain: string;
  channelName?: string;
}): Script {
  const channel = params.channelName || "FinGreen";
  const titleClean = params.title.slice(0, 40);

  const sentences = params.content
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const body1Text = sentences[0] || "Thị trường tài chính vừa ghi nhận diễn biến rất đáng chú ý.";
  const body2Text = sentences[1] || "Các chuyên gia khuyến nghị nhà đầu tư theo dõi sát diễn biến dòng tiền.";
  const body3Text = sentences[2] || "Đây là tín hiệu quan trọng tác động trực tiếp đến danh mục đầu tư.";

  const script: Script = {
    version: "1.0",
    metadata: {
      title: params.title.slice(0, 80),
      channel,
      source: {
        url: "https://" + (params.sourceDomain || "cafef.vn"),
        domain: params.sourceDomain || "cafef.vn",
        image: null,
      },
    },
    voice: {
      provider: "edge-tts",
      voiceId: "vi-VN-NamMinhNeural",
      speed: 1.0,
    },
    scenes: [
      {
        id: "hook",
        type: "hook",
        voiceText: `Tin nóng tài chính mới nhất: ${titleClean}! Hãy cùng kênh ${channel === "FinGreen" ? "Phin Rin" : channel} điểm nhanh ngay sau đây.`,
        templateData: {
          template: "hook",
          headline: titleClean,
          subhead: "Tiêu điểm tài chính",
          kenBurns: "zoom-in",
        },
      },
      {
        id: "body-1",
        type: "body",
        voiceText: body1Text,
        templateData: {
          template: "callout",
          statement: body1Text.slice(0, 80),
          tag: "TÂM ĐIỂM",
        },
      },
      {
        id: "body-2",
        type: "body",
        voiceText: body2Text,
        templateData: {
          template: "stat-hero",
          value: "DIỄN BIẾN NÓNG",
          label: "Thị trường chứng khoán",
          context: "Cập nhật thời gian thực",
        },
      },
      {
        id: "body-3",
        type: "body",
        voiceText: body3Text,
        templateData: {
          template: "feature-list",
          title: "Khuyến Nghị Hành Động",
          bullets: ["Quản trị rủi ro chặt chẽ", "Bảo toàn tỷ trọng danh mục", "Theo dõi dòng tiền lớn"],
        },
      },
      {
        id: "outro",
        type: "outro",
        voiceText: `Follow kênh ${channel === "FinGreen" ? "Phin Rin" : channel} để cập nhật thông tin mới nhất.`,
        templateData: {
          template: "outro",
          ctaTop: "Xem tin mới mỗi ngày",
          channelName: channel,
          source: params.sourceDomain || "cafef.vn",
        },
      },
    ],
  };

  return script;
}

