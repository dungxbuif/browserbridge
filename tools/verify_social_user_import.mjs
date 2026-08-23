import { createRequire } from "node:module";
import { saveSocialUsersToDatabase } from "./social_db.mjs";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const unique = `verify-import-${Date.now()}`;
const client = new Client({ connectionString: databaseUrl });

await client.connect();
try {
  const saved = await saveSocialUsersToDatabase(databaseUrl, "tiktok", [
    {
      secUid: unique,
      uniqueId: unique,
      nickname: "Verify Import",
      profileURL: `https://www.tiktok.com/@${unique}`,
      avatarURL: "https://example.test/avatar.jpg",
    },
  ]);
  if (saved !== 1) throw new Error(`expected 1 saved user, got ${saved}`);

  const { rows } = await client.query(
    `SELECT id, platform, source_user_id, username, display_name, profile_url, avatar_url,
            last_scraped_at, scrape_claim_id, scrape_claimed_at, metadata
     FROM social_users
     WHERE platform = $1 AND source_user_id = $2`,
    ["tiktok", unique],
  );
  const row = rows[0];
  if (!row) throw new Error("imported social user not found");
  assertEqual(row.platform, "tiktok", "platform");
  assertEqual(row.source_user_id, unique, "source_user_id");
  assertEqual(row.username, unique, "username");
  assertEqual(row.display_name, "Verify Import", "display_name");
  assertEqual(row.profile_url, `https://www.tiktok.com/@${unique}`, "profile_url");
  assertEqual(row.avatar_url, "https://example.test/avatar.jpg", "avatar_url");
  if (row.last_scraped_at !== null) throw new Error("import should not mark media scrape completed");
  if (row.scrape_claim_id !== "") throw new Error("import should not set scrape claim");
  if (row.scrape_claimed_at !== null) throw new Error("import should not set scrape claimed timestamp");
  if (!row.metadata?.imported_at) throw new Error("import metadata missing imported_at");
  assertEqual(row.metadata.secUid, unique, "metadata.secUid");
  assertEqual(row.metadata.uniqueId, unique, "metadata.uniqueId");
  assertEqual(row.metadata.nickname, "Verify Import", "metadata.nickname");

  console.log(JSON.stringify({
    ok: true,
    saved,
    user: {
      id: row.id,
      platform: row.platform,
      sourceUserId: row.source_user_id,
      username: row.username,
      displayName: row.display_name,
      profileUrl: row.profile_url,
      avatarUrl: row.avatar_url,
      lastScrapedAt: row.last_scraped_at,
      scrapeClaimId: row.scrape_claim_id,
      metadataKeys: Object.keys(row.metadata).sort(),
    },
  }, null, 2));
} finally {
  await client.query("DELETE FROM social_users WHERE platform = $1 AND source_user_id = $2", ["tiktok", unique]).catch(() => undefined);
  await client.end();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
