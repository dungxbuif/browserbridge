import { createRequire } from "node:module";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const platform = args.platform || "";
const username = args.username || "";
if (!["tiktok", "instagram"].includes(platform)) throw new Error("--platform must be tiktok or instagram");
if (!username && !args.profileUrl) throw new Error("--username or --profile-url is required");

const sourceUserId = args.sourceId || username || args.profileUrl;
const profileUrl = args.profileUrl || profileURL(platform, username);

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(`
CREATE TABLE IF NOT EXISTS social_users (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_user_id)
)`);
  const { rows } = await client.query(
    `INSERT INTO social_users (platform, source_user_id, username, display_name, profile_url, metadata, last_scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     ON CONFLICT (platform, source_user_id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       profile_url = EXCLUDED.profile_url,
       metadata = social_users.metadata || EXCLUDED.metadata,
       last_scraped_at = NULL,
       updated_at = now()
     RETURNING id, platform, source_user_id, username, profile_url`,
    [
      platform,
      sourceUserId,
      username,
      args.displayName || "",
      profileUrl,
      JSON.stringify({ seeded_by: "tools/upsert_social_user.mjs", seeded_at: new Date().toISOString() }),
    ],
  );
  console.log(JSON.stringify({ ok: true, user: rows[0] }, null, 2));
} finally {
  await client.end();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || "";
    if (arg === "--platform") {
      result.platform = next;
      index += 1;
    } else if (arg === "--username") {
      result.username = next.replace(/^@/, "");
      index += 1;
    } else if (arg === "--source-id") {
      result.sourceId = next;
      index += 1;
    } else if (arg === "--profile-url") {
      result.profileUrl = next;
      index += 1;
    } else if (arg === "--display-name") {
      result.displayName = next;
      index += 1;
    }
  }
  return result;
}

function profileURL(platform, username) {
  if (!username) return "";
  if (platform === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platform === "instagram") return `https://www.instagram.com/${username}/`;
  return "";
}
