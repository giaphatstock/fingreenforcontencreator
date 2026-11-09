export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  imageUrl?: string;
  publishedAt: string;
  category: "vĩ-mô" | "chứng-khoán" | "bất-động-sản" | "ngân-hàng" | "thị-trường" | "doanh-nghiệp";
  badge?: string;
}

export type LicenseTier = "trial" | "creator_pro" | "fintech_vip" | "lifetime";

export interface LicenseKey {
  id: string;
  key: string;
  tier: LicenseTier;
  createdAt: string;
  expiresAt: string; // ISO date or "lifetime"
  maxVideosPerMonth: number; // 0 = unlimited
  usedVideosCount: number;
  status: "active" | "expired" | "revoked";
  customerName?: string;
  customerNote?: string;
  boundMachineId?: string;
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  role: "admin" | "creator";
  tier: LicenseTier;
  activeKey?: string;
  createdAt: string;
  expiresAt: string;
  totalVideosRendered: number;
  status: "active" | "suspended";
}

export interface RenderProgressEvent {
  jobId: string;
  status: "queued" | "extracting" | "scripting" | "voice" | "rendering" | "completed" | "failed";
  stepTitle: string;
  stepDescription: string;
  percent: number;
  currentFrame?: number;
  totalFrames?: number;
  elapsedSec: number;
  outputPath?: string;
  videoUrl?: string;
  error?: string;
}

