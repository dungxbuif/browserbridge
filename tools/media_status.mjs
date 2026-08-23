import { createRequire } from "node:module";
import { MediaStore } from "../bot/src/store.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const store = new MediaStore(databaseUrl);
try {
  await store.migrate();
  const [tables, socialByPlatform, mediaByPlatform, botCounts, topUsers] = await Promise.all([
    tableCounts(),
    socialCounts(),
    mediaCounts(),
    botActivityCounts(),
    topSocialUsers(),
  ]);
  console.log(JSON.stringify({
    ok: true,
    tables,
    socialByPlatform,
    mediaByPlatform,
    bot: botCounts,
    topSocialUsers: topUsers,
  }, null, 2));
} finally {
  await store.close();
}

async function tableCounts() {
  const out = {};
  for (const table of ["social_users", "media_assets", "mezon_users", "media_reactions", "media_archives", "bot_media_posts", "bot_event_dedup"]) {
    const { rows } = await store.pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    out[table] = rows[0].count;
  }
  return out;
}

async function socialCounts() {
  const { rows } = await store.pool.query(`
    SELECT
      platform,
      count(*)::int AS total,
      count(*) FILTER (WHERE last_scraped_at IS NULL)::int AS never_scraped,
      count(*) FILTER (WHERE scrape_claim_id <> '')::int AS claimed,
      count(*) FILTER (WHERE COALESCE(profile_url, '') <> '' OR COALESCE(username, '') <> '')::int AS scrape_candidates,
      max(last_scraped_at) AS latest_scraped_at
    FROM social_users
    GROUP BY platform
    ORDER BY platform
  `);
  return Object.fromEntries(rows.map((row) => [row.platform, normalizeRow(row)]));
}

async function mediaCounts() {
  const { rows } = await store.pool.query(`
    SELECT
      platform,
      count(*)::int AS total,
      count(*) FILTER (WHERE archived_at IS NULL)::int AS active,
      count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
      count(*) FILTER (WHERE posting_claim_id <> '')::int AS claimed_for_posting,
      count(*) FILTER (WHERE archived_at IS NULL AND posting_claim_id = '')::int AS postable_now,
      sum(post_count)::int AS total_posts,
      max(uploaded_at) AS latest_uploaded_at,
      max(last_posted_at) AS latest_posted_at
    FROM media_assets
    GROUP BY platform
    ORDER BY platform
  `);
  return Object.fromEntries(rows.map((row) => [row.platform, normalizeRow(row)]));
}

async function botActivityCounts() {
  const [posts, reactions, archives] = await Promise.all([
    store.pool.query("SELECT count(*)::int AS count, max(created_at) AS latest_at FROM bot_media_posts"),
    store.pool.query(`
      SELECT
        count(*)::int AS count,
        count(*) FILTER (WHERE reaction = 'like')::int AS likes,
        count(*) FILTER (WHERE reaction = 'dislike')::int AS dislikes,
        max(updated_at) AS latest_at
      FROM media_reactions
    `),
    store.pool.query("SELECT count(*)::int AS count, max(created_at) AS latest_at FROM media_archives"),
  ]);
  return {
    posts: normalizeRow(posts.rows[0]),
    reactions: normalizeRow(reactions.rows[0]),
    archives: normalizeRow(archives.rows[0]),
  };
}

async function topSocialUsers() {
  const { rows } = await store.pool.query(`
    SELECT
      platform,
      source_user_id,
      username,
      display_name,
      count(media_assets.id)::int AS media_count,
      max(media_assets.uploaded_at) AS latest_uploaded_at
    FROM social_users
    LEFT JOIN media_assets USING (platform, source_user_id)
    GROUP BY social_users.platform, social_users.source_user_id, social_users.username, social_users.display_name
    ORDER BY media_count DESC, latest_uploaded_at DESC NULLS LAST
    LIMIT 10
  `);
  return rows.map(normalizeRow);
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}
