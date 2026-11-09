import pg from "pg";

const client = new pg.Client({
  host: "aws-0-ap-southeast-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  user: "postgres.ldfitmwixgurshoxpshr",
  password: "Phatdeeptrai",
  ssl: { rejectUnauthorized: false },
});

const schema = `
CREATE TABLE IF NOT EXISTS fingreen_licenses (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'creator_pro',
  customer_name TEXT,
  customer_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_videos_per_month INT DEFAULT 0,
  used_videos_count INT DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS fingreen_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'creator',
  tier TEXT DEFAULT 'creator_pro',
  active_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  total_videos_rendered INT DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS fingreen_rendered_videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'FinGreen',
  video_url TEXT,
  thumbnail_url TEXT,
  duration_sec NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id TEXT
);
`;

async function main() {
  await client.connect();
  console.log("Connected to Supabase PostgreSQL!");
  await client.query(schema);
  console.log("Schema fingreen_licenses, fingreen_users, fingreen_rendered_videos created!");

  const insertMaster = `
    INSERT INTO fingreen_licenses (id, key, tier, customer_name, customer_note, expires_at, status)
    VALUES ('key_master_init', 'FINGREEN-MASTER-ADMIN-2026', 'lifetime', 'FinGreen Root Admin', 'Khóa quản trị tối cao', '2099-12-31 23:59:59+00', 'active')
    ON CONFLICT (key) DO NOTHING;
  `;
  await client.query(insertMaster);
  console.log("Master Admin Key seeded successfully into Supabase!");
  await client.end();
}

main().catch((e) => {
  console.error("Migration error:", e);
  process.exit(1);
});

