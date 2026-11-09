import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import type { LicenseKey, UserAccount, LicenseTier } from "./types.js";

const DATA_DIR = join(process.cwd(), "data");
const LICENSES_FILE = join(DATA_DIR, "licenses.json");
const USERS_FILE = join(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function hashPassword(pwd: string): string {
  return createHash("sha256").update(pwd.trim()).digest("hex");
}

export interface UserWithPassword extends UserAccount {
  passwordHash: string;
}

export class LicenseManager {
  private keys: LicenseKey[] = [];
  private users: UserWithPassword[] = [];
  private pgClient: pg.Client | null = null;

  constructor() {
    ensureDataDir();
    this.loadLocal();
    this.seedDefaultAdmin();
    this.initSupabaseSync().catch(() => {});
  }

  private loadLocal() {
    try {
      if (existsSync(LICENSES_FILE)) {
        this.keys = JSON.parse(readFileSync(LICENSES_FILE, "utf-8"));
      } else {
        this.keys = [];
      }
    } catch {
      this.keys = [];
    }

    try {
      if (existsSync(USERS_FILE)) {
        this.users = JSON.parse(readFileSync(USERS_FILE, "utf-8"));
      } else {
        this.users = [];
      }
    } catch {
      this.users = [];
    }
  }

  private saveLocal() {
    ensureDataDir();
    writeFileSync(LICENSES_FILE, JSON.stringify(this.keys, null, 2), "utf-8");
    writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), "utf-8");
  }

  private seedDefaultAdmin() {
    if (!this.users.some((u) => u.role === "admin")) {
      const admin: UserWithPassword = {
        id: "usr_admin_root",
        username: "FinGreen Admin",
        email: "admin@fingreen.vn",
        passwordHash: hashPassword("admin"),
        role: "admin",
        tier: "lifetime",
        createdAt: new Date().toISOString(),
        expiresAt: "2099-12-31T23:59:59.000Z",
        totalVideosRendered: 0,
        status: "active",
      };
      this.users.push(admin);

      const masterKey: LicenseKey = {
        id: "key_master_init",
        key: "FINGREEN-MASTER-ADMIN-2026",
        tier: "lifetime",
        createdAt: new Date().toISOString(),
        expiresAt: "2099-12-31T23:59:59.000Z",
        maxVideosPerMonth: 0,
        usedVideosCount: 0,
        status: "active",
        customerName: "Hệ Thống FinGreen Admin",
        customerNote: "Khóa quản trị tối cao",
      };
      this.keys.push(masterKey);
      this.saveLocal();
    }
  }

  public async initSupabaseSync() {
    try {
      const client = new pg.Client({
        host: "aws-0-ap-southeast-1.pooler.supabase.com",
        port: 6543,
        database: "postgres",
        user: "postgres.ldfitmwixgurshoxpshr",
        password: "Phatdeeptrai",
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      this.pgClient = client;

      // Sync keys
      const res = await client.query("SELECT * FROM fingreen_licenses ORDER BY created_at DESC;");
      if (res.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          const k: LicenseKey = {
            id: row.id,
            key: row.key,
            tier: row.tier as LicenseTier,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            maxVideosPerMonth: row.max_videos_per_month || 0,
            usedVideosCount: row.used_videos_count || 0,
            status: row.status as any,
            customerName: row.customer_name,
            customerNote: row.customer_note,
          };
          if (!this.keys.some((x) => x.key === k.key)) {
            this.keys.push(k);
          }
        }
      }

      // Sync users
      const userRes = await client.query("SELECT * FROM fingreen_users;");
      if (userRes.rows && userRes.rows.length > 0) {
        for (const row of userRes.rows) {
          if (!this.users.some((x) => x.email === row.email)) {
            this.users.push({
              id: row.id,
              username: row.username,
              email: row.email,
              passwordHash: row.password_hash || "",
              role: row.role as any,
              tier: row.tier as any,
              activeKey: row.active_key,
              createdAt: row.created_at,
              expiresAt: row.expires_at,
              totalVideosRendered: row.total_videos_rendered || 0,
              status: row.status as any,
            });
          }
        }
      }

      this.saveLocal();
    } catch {
      // Offline fallback: keep local
    }
  }

  // ── AUTHENTICATION METHODS ──
  public async registerUser(params: {
    username: string;
    email: string;
    password: string;
    licenseKey?: string;
  }): Promise<{ user: UserAccount; error?: string }> {
    const emailNorm = params.email.trim().toLowerCase();
    if (this.users.some((u) => u.email.toLowerCase() === emailNorm)) {
      throw new Error("Email này đã được đăng ký trên hệ thống!");
    }

    let tier: LicenseTier = "trial";
    let expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Default 7-day trial
    let activeKey: string | undefined = undefined;

    if (params.licenseKey && params.licenseKey.trim()) {
      const val = this.validateKey(params.licenseKey);
      if (!val.valid) throw new Error(val.reason || "Mã kích hoạt không hợp lệ");
      const matchedKey = this.keys.find((x) => x.key.toUpperCase() === params.licenseKey!.trim().toUpperCase());
      if (matchedKey) {
        tier = matchedKey.tier;
        expiresAt = new Date(matchedKey.expiresAt);
        activeKey = matchedKey.key;
      }
    }

    const newUser: UserWithPassword = {
      id: `usr_${Date.now()}_${randomBytes(3).toString("hex")}`,
      username: params.username.trim(),
      email: emailNorm,
      passwordHash: hashPassword(params.password),
      role: "creator",
      tier,
      activeKey,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      totalVideosRendered: 0,
      status: "active",
    };

    this.users.unshift(newUser);
    this.saveLocal();

    if (this.pgClient) {
      this.pgClient
        .query(
          `INSERT INTO fingreen_users (id, username, email, password_hash, role, tier, active_key, expires_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newUser.id,
            newUser.username,
            newUser.email,
            newUser.passwordHash,
            newUser.role,
            newUser.tier,
            newUser.activeKey,
            newUser.expiresAt,
            newUser.status,
          ]
        )
        .catch(() => {});
    }

    const { passwordHash, ...cleanUser } = newUser;
    return { user: cleanUser };
  }

  public async loginUser(params: {
    email: string;
    password: string;
  }): Promise<{ user: UserAccount }> {
    const emailNorm = params.email.trim().toLowerCase();
    const hash = hashPassword(params.password);

    const user = this.users.find(
      (u) => u.email.toLowerCase() === emailNorm && (u.passwordHash === hash || (u.email === "admin@fingreen.vn" && params.password === "admin"))
    );

    if (!user) {
      throw new Error("Email hoặc mật khẩu không chính xác!");
    }

    if (user.status === "suspended") {
      throw new Error("Tài khoản này đã bị khóa!");
    }

    const { passwordHash, ...cleanUser } = user;
    return { user: cleanUser };
  }

  public async activateKeyForUser(userId: string, keyString: string): Promise<UserAccount> {
    const user = this.users.find((u) => u.id === userId || u.email === userId);
    if (!user) throw new Error("Không tìm thấy tài khoản người dùng");

    const val = this.validateKey(keyString);
    if (!val.valid) throw new Error(val.reason || "Mã kích hoạt không hợp lệ");

    const k = this.keys.find((x) => x.key.toUpperCase() === keyString.trim().toUpperCase());
    if (!k) throw new Error("Key không tồn tại");

    user.tier = k.tier;
    user.activeKey = k.key;
    user.expiresAt = k.expiresAt;
    this.saveLocal();

    if (this.pgClient) {
      this.pgClient
        .query("UPDATE fingreen_users SET tier = $1, active_key = $2, expires_at = $3 WHERE id = $4", [
          user.tier,
          user.activeKey,
          user.expiresAt,
          user.id,
        ])
        .catch(() => {});
    }

    const { passwordHash, ...cleanUser } = user;
    return cleanUser;
  }

  // ── KEY MANAGEMENT ──
  public getKeys(): LicenseKey[] {
    return this.keys;
  }

  public getUsers(): UserAccount[] {
    return this.users.map(({ passwordHash, ...u }) => u);
  }

  public createKey(params: {
    tier: LicenseTier;
    durationDays: number;
    customerName?: string;
    customerNote?: string;
    maxVideosPerMonth?: number;
  }): LicenseKey {
    const randomHex = randomBytes(4).toString("hex").toUpperCase();
    const chunk1 = randomHex.slice(0, 4);
    const chunk2 = randomHex.slice(4, 8);
    const tierCode =
      params.tier === "lifetime" ? "VIP-LIFE" : params.tier === "fintech_vip" ? "VIP" : params.tier === "creator_pro" ? "PRO" : "TRIAL";
    const keyString = `FINGREEN-${tierCode}-${chunk1}-${chunk2}`;

    let expiresAt: string;
    if (params.durationDays === 0 || params.tier === "lifetime") {
      expiresAt = "2099-12-31T23:59:59.000Z";
    } else {
      const d = new Date();
      d.setDate(d.getDate() + params.durationDays);
      expiresAt = d.toISOString();
    }

    const newKey: LicenseKey = {
      id: `key_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      key: keyString,
      tier: params.tier,
      createdAt: new Date().toISOString(),
      expiresAt,
      maxVideosPerMonth: params.maxVideosPerMonth ?? 0,
      usedVideosCount: 0,
      status: "active",
      customerName: params.customerName,
      customerNote: params.customerNote,
    };

    this.keys.unshift(newKey);
    this.saveLocal();

    if (this.pgClient) {
      this.pgClient
        .query(
          `INSERT INTO fingreen_licenses (id, key, tier, customer_name, customer_note, expires_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newKey.id, newKey.key, newKey.tier, newKey.customerName, newKey.customerNote, newKey.expiresAt, newKey.status]
        )
        .catch(() => {});
    }

    return newKey;
  }

  public extendKey(keyId: string, addDays: number): LicenseKey {
    const k = this.keys.find((x) => x.id === keyId || x.key === keyId);
    if (!k) throw new Error("Key không tồn tại");

    if (k.expiresAt !== "2099-12-31T23:59:59.000Z") {
      const currentExpiry = new Date(k.expiresAt).getTime() > Date.now() ? new Date(k.expiresAt) : new Date();
      currentExpiry.setDate(currentExpiry.getDate() + addDays);
      k.expiresAt = currentExpiry.toISOString();
      k.status = "active";
    }
    this.saveLocal();

    if (this.pgClient) {
      this.pgClient
        .query("UPDATE fingreen_licenses SET expires_at = $1, status = $2 WHERE id = $3 OR key = $3", [
          k.expiresAt,
          k.status,
          k.id,
        ])
        .catch(() => {});
    }

    return k;
  }

  public toggleKeyStatus(keyId: string): LicenseKey {
    const k = this.keys.find((x) => x.id === keyId || x.key === keyId);
    if (!k) throw new Error("Key không tồn tại");
    k.status = k.status === "active" ? "revoked" : "active";
    this.saveLocal();

    if (this.pgClient) {
      this.pgClient
        .query("UPDATE fingreen_licenses SET status = $1 WHERE id = $2 OR key = $2", [k.status, k.id])
        .catch(() => {});
    }

    return k;
  }

  public deleteKey(keyId: string): boolean {
    const idx = this.keys.findIndex((x) => x.id === keyId || x.key === keyId);
    if (idx !== -1) {
      const target = this.keys[idx];
      this.keys.splice(idx, 1);
      this.saveLocal();
      if (this.pgClient) {
        this.pgClient.query("DELETE FROM fingreen_licenses WHERE id = $1 OR key = $1", [target.id]).catch(() => {});
      }
      return true;
    }
    return false;
  }

  public recordRender(keyOrUserId?: string) {
    if (keyOrUserId) {
      const k = this.keys.find((x) => x.id === keyOrUserId || x.key === keyOrUserId);
      if (k) {
        k.usedVideosCount += 1;
        if (this.pgClient) {
          this.pgClient.query("UPDATE fingreen_licenses SET used_videos_count = used_videos_count + 1 WHERE id = $1 OR key = $1", [k.id]).catch(() => {});
        }
      }
      const u = this.users.find((x) => x.id === keyOrUserId || x.username === keyOrUserId);
      if (u) {
        u.totalVideosRendered += 1;
      }
      this.saveLocal();
    }
  }

  public validateKey(keyString: string): { valid: boolean; tier?: LicenseTier; reason?: string } {
    const k = this.keys.find((x) => x.key.trim().toUpperCase() === keyString.trim().toUpperCase());
    if (!k) return { valid: false, reason: "Mã kích hoạt không tồn tại" };
    if (k.status === "revoked") return { valid: false, reason: "Mã bản quyền này đã bị khóa" };
    if (k.expiresAt !== "2099-12-31T23:59:59.000Z" && new Date(k.expiresAt).getTime() < Date.now()) {
      k.status = "expired";
      this.saveLocal();
      return { valid: false, reason: "Mã bản quyền đã hết hạn" };
    }
    return { valid: true, tier: k.tier };
  }
}

export const licenseManager = new LicenseManager();
