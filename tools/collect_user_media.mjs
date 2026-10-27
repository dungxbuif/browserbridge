import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BrowserBridgeClient } from "../bot/src/bridge-client.js";
import { MediaStore } from "../bot/src/store.js";
import { scrapeUser } from "../bot/src/media-worker-core.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

export function parseCollectUserMediaArgs(raw) {
  const args = {
    platform: "",
    username: "",
    profileUrl: "",
    sourceUserId: "",
    displayName: "",
    maxMedia: 200,
    active: false,
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    const next = raw[index + 1] || "";
    if (arg === "--platform") {
      args.platform = next.trim().toLowerCase();
      index += 1;
    } else if (arg === "--username") {
      args.username = next.replace(/^@/, "").trim();
      index += 1;
    } else if (arg === "--profile-url") {
      args.profileUrl = next.trim();
      index += 1;
    } else if (arg === "--source-id") {
      args.sourceUserId = next.replace(/^@/, "").trim();
      index += 1;
    } else if (arg === "--display-name") {
      args.displayName = next.trim();
      index += 1;
    } else if (arg === "--max-media") {
      args.maxMedia = parsePositiveInt(next, "max-media");
      index += 1;
    } else if (arg === "--active") {
      args.active = true;
    }
  }
  if (!["tiktok", "instagram"].includes(args.platform)) {
    throw new Error("--platform must be tiktok or instagram for the current bulk user-media runner");
  }
  if (!args.username && !args.profileUrl) {
    throw new Error("--username or --profile-url is required");
  }
  return args;
}

export function buildTargetUser(args) {
  const username = args.username || usernameFromProfileURL(args.platform, args.profileUrl);
  const sourceUserID = args.sourceUserId || username || args.profileUrl;
  return {
    id: 0,
    platform: args.platform,
    source_user_id: sourceUserID,
    username,
    display_name: args.displayName || "",
    profile_url: args.profileUrl || profileURL(args.platform, username),
    avatar_url: "",
    metadata: {
      collection_mode: "profile_media",
      seeded_by: "tools/collect_user_media.mjs",
      seeded_at: new Date().toISOString(),
    },
    last_scraped_at: null,
    scrape_claim_id: "",
  };
}

export async function upsertTargetUser(store, user) {
  const { rows } = await store.pool.query(
    `INSERT INTO social_users (platform, source_user_id, username, display_name, profile_url, avatar_url, metadata, last_scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     ON CONFLICT (platform, source_user_id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       profile_url = EXCLUDED.profile_url,
       avatar_url = EXCLUDED.avatar_url,
       metadata = social_users.metadata || EXCLUDED.metadata,
       last_scraped_at = NULL,
       scrape_claim_id = '',
       scrape_claimed_at = NULL,
       updated_at = now()
     RETURNING id, platform, source_user_id, username, display_name, profile_url, avatar_url, metadata, last_scraped_at, scrape_claim_id`,
    [
      user.platform,
      user.source_user_id,
      user.username,
      user.display_name || "",
      user.profile_url,
      user.avatar_url || "",
      JSON.stringify(user.metadata || {}),
    ],
  );
  return rows[0];
}

async function main() {
  dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
  dotenv.config();

  const args = parseCollectUserMediaArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL || "";
  const bridgeHttpUrl = process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788";
  const bridgeAuthToken = process.env.BROWSER_BRIDGE_AUTH_TOKEN || "";
  if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");
  if (!bridgeAuthToken.trim()) throw new Error("BROWSER_BRIDGE_AUTH_TOKEN is required");

  const store = new MediaStore(databaseUrl);
  try {
    await store.migrate();
    const user = await upsertTargetUser(store, buildTargetUser(args));
    const bridge = new BrowserBridgeClient({ baseUrl: bridgeHttpUrl, token: bridgeAuthToken });
    const summary = await scrapeUser({
      user,
      cfg: {
        platform: args.platform,
        maxMediaPerUser: args.maxMedia,
        openProfileActive: args.active,
        pageLoadWaitMs: parsePositiveInt(process.env.SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS || "5000", "SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS"),
      },
      store,
      bridge,
      log: console,
    });
    console.log(JSON.stringify({ ok: true, user, summary }, null, 2));
  } finally {
    await store.close();
  }
}

function profileURL(platform, username) {
  if (!username) return "";
  if (platform === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platform === "instagram") return `https://www.instagram.com/${username}/`;
  return "";
}

function usernameFromProfileURL(platform, rawURL) {
  try {
    const parsed = new URL(rawURL);
    const part = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (platform === "tiktok") return part.replace(/^@/, "");
    return part;
  } catch {
    return "";
  }
}

function parsePositiveInt(raw, name) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
