import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { MediaStore } from "../bot/src/store.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const runId = `verify-social-once-${Date.now()}`;
const cases = {
  tiktok: {
    tabId: 111,
    workerTabId: 222,
    sourceUserId: `${runId}-tiktok`,
    username: `${runId}-tiktok`,
    ownerUrl: "https://www.tiktok.com/@owner/following",
    profileUrl(username) {
      return `https://www.tiktok.com/@${username}`;
    },
  },
  instagram: {
    tabId: 333,
    workerTabId: 444,
    sourceUserId: `${runId}-instagram`,
    username: `${runId}-instagram`,
    ownerUrl: "https://www.instagram.com/owner/following/",
    profileUrl(username) {
      return `https://www.instagram.com/${username}/`;
    },
  },
};
const token = "verify-token";
const requests = [];
const uploadCount = { tiktok: 0, instagram: 0 };
let port = 0;

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message || error) }));
  }
});

const store = new MediaStore(databaseUrl);

try {
  await store.migrate();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;

  const results = {};
  for (const platform of ["tiktok", "instagram"]) {
    const result = await runSocialOnce(platform);
    if (result.code !== 0) throw new Error(`run-social-once ${platform} failed: ${result.stderr || result.stdout}`);
    if (uploadCount[platform] !== 1) throw new Error(`expected 1 ${platform} upload, got ${uploadCount[platform]}`);
    results[platform] = await readSavedUser(platform);
  }

  console.log(JSON.stringify({
    ok: true,
    platforms: results,
    fakeBridge: {
      port,
      requests: requests.map((item) => `${item.method} ${item.path}`),
      uploadCount,
    },
  }, null, 2));
} finally {
  for (const platform of Object.keys(cases)) {
    await store.pool.query("DELETE FROM media_assets WHERE platform = $1 AND source_user_id = $2", [platform, cases[platform].sourceUserId]).catch(() => undefined);
    await store.pool.query("DELETE FROM social_users WHERE platform = $1 AND source_user_id = $2", [platform, cases[platform].sourceUserId]).catch(() => undefined);
  }
  await store.close().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port || 0}`);
  requests.push({ method: req.method, path: url.pathname });
  if (url.pathname !== "/healthz" && req.headers.authorization !== `Bearer ${token}`) {
    return json(res, 401, { error: "unauthorized" });
  }
  if (req.method === "GET" && url.pathname === "/v1/tabs") {
    return json(res, 200, Object.entries(cases).map(([platform, item]) => ({
      id: item.tabId,
      url: item.ownerUrl,
      title: `${platform} owner`,
    })));
  }
  if (req.method === "POST" && url.pathname === "/v1/runtime/evaluate") {
    const body = await readJSON(req);
    const exportPlatform = platformForTab(body.tab_id, "tabId");
    if (exportPlatform) return json(res, 200, followingPayload(exportPlatform));
    const workerPlatform = platformForTab(body.tab_id, "workerTabId");
    if (workerPlatform) return json(res, 200, mediaPayload(workerPlatform));
    return json(res, 400, { error: `unexpected tab ${body.tab_id}` });
  }
  if (req.method === "POST" && url.pathname === "/v1/tabs") {
    const body = await readJSON(req);
    const match = Object.entries(cases).find(([, item]) => body.url === item.profileUrl(item.username));
    if (!match) return json(res, 400, { error: `unexpected open URL ${body.url}` });
    return json(res, 200, { id: match[1].workerTabId });
  }
  if (req.method === "POST" && url.pathname === "/v1/media/transfers") {
    const body = await readJSON(req);
    const item = cases[body.platform];
    if (!item || body.source_user_id !== item.sourceUserId || body.media_id !== `${item.sourceUserId}-media`) {
      return json(res, 400, { error: `unexpected upload ${JSON.stringify(body)}` });
    }
    uploadCount[body.platform] += 1;
    return json(res, 200, { status: "complete" });
  }
  for (const [platform, item] of Object.entries(cases)) {
    if (req.method === "DELETE" && url.pathname === `/v1/tabs/${item.workerTabId}`) {
      return json(res, 200, { ok: true, id: item.workerTabId, platform });
    }
  }
  return json(res, 404, { error: "not found" });
}

function platformForTab(tabId, key) {
  return Object.entries(cases).find(([, item]) => item[key] === tabId)?.[0] || "";
}

function followingPayload(platform) {
  const item = cases[platform];
  if (platform === "tiktok") {
    return {
      viewer: { id: "owner", secUid: "owner-sec", uniqueId: "owner", nickname: "Owner" },
      totalUnique: 1,
      users: [{
        id: item.sourceUserId,
        secUid: item.sourceUserId,
        uniqueId: item.username,
        nickname: "Verify TikTok Creator",
        signature: "",
        verified: false,
        privateAccount: false,
        followerCount: 0,
        followingCount: 0,
        profileURL: item.profileUrl(item.username),
      }],
    };
  }
  return {
    viewer: { id: "owner-instagram", username: "owner" },
    totalUnique: 1,
    users: [{
      id: item.sourceUserId,
      username: item.username,
      fullName: "Verify Instagram Creator",
      isPrivate: false,
      isVerified: false,
      avatarURL: "https://cdn.example/instagram-avatar.jpg",
      profileURL: item.profileUrl(item.username),
    }],
  };
}

function mediaPayload(platform) {
  const item = cases[platform];
  return {
    url: item.profileUrl(item.username),
    title: item.username,
    media: [{
      media_id: `${item.sourceUserId}-media`,
      post_id: `${item.sourceUserId}-post`,
      media_url: `https://cdn.example/${platform}-social-once.jpg`,
      media_type: "image",
      mime_type: "image/jpeg",
      preview_url: `https://cdn.example/${platform}-social-once-preview.jpg`,
      source: "verify",
      metadata: { rank: 1, platform },
    }],
  };
}

async function readSavedUser(platform) {
  const item = cases[platform];
  const { rows } = await store.pool.query(
    `SELECT source_user_id, username, display_name, profile_url, last_scraped_at, metadata, scrape_claim_id
     FROM social_users
     WHERE platform = $1 AND source_user_id = $2`,
    [platform, item.sourceUserId],
  );
  const row = rows[0];
  if (!row) throw new Error(`${platform} social user was not saved`);
  if (!row.last_scraped_at) throw new Error(`${platform} worker did not mark social user scraped`);
  if (row.scrape_claim_id !== "") throw new Error(`${platform} scrape claim not cleared: ${row.scrape_claim_id}`);
  if (row.metadata.last_media_upload_count !== 1) throw new Error(`unexpected ${platform} metadata ${JSON.stringify(row.metadata)}`);
  return {
    sourceUserId: row.source_user_id,
    username: row.username,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    scraped: Boolean(row.last_scraped_at),
    uploadCount: row.metadata.last_media_upload_count,
  };
}

async function runSocialOnce(platform) {
  const child = spawn("bash", ["scripts/run-social-once.sh"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      BROWSER_BRIDGE_HTTP_URL: `http://127.0.0.1:${port}`,
      BROWSER_BRIDGE_AUTH_TOKEN: token,
      SOCIAL_MEDIA_PLATFORM: platform,
      SOCIAL_MEDIA_USER_COOLDOWN_SECONDS: "1",
      SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS: "60",
      SOCIAL_MEDIA_MAX_USERS_PER_TICK: "1",
      SOCIAL_MEDIA_MAX_MEDIA_PER_USER: "5",
      SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

async function readJSON(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
