import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { saveSocialUsersToDatabase, toCSV } from "./social_db.mjs";

const token = process.env.BROWSER_BRIDGE_AUTH_TOKEN;
const tabID = Number.parseInt(process.env.TIKTOK_TAB_ID || "", 10);
const serverURL = process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788";
const databaseURL = process.env.DATABASE_URL || "";

if (!token) throw new Error("BROWSER_BRIDGE_AUTH_TOKEN is required");
if (!Number.isInteger(tabID) || tabID <= 0) throw new Error("TIKTOK_TAB_ID is required");

const expression = String.raw`
(async () => {
  const stateEl = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!stateEl) throw new Error("TikTok universal state not found");
  const state = JSON.parse(stateEl.textContent);
  const viewer = state.__DEFAULT_SCOPE__["webapp.app-context"].user;
  if (!viewer?.secUid) throw new Error("TikTok viewer secUid not found");

  const users = [];
  let minCursor = 0;
  let maxCursor = 0;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < 100) {
    const params = new URLSearchParams({
      aid: "1988",
      app_name: "tiktok_web",
      device_platform: "web_pc",
      count: "30",
      maxCursor: String(maxCursor),
      minCursor: String(minCursor),
      secUid: viewer.secUid,
    });
    const response = await fetch("/api/user/list/?" + params.toString(), {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" },
    });
    if (!response.ok) throw new Error("TikTok following API HTTP " + response.status);
    const body = await response.json();
    if (body.statusCode !== 0 && body.status_code !== 0) {
      throw new Error("TikTok following API status " + (body.statusCode ?? body.status_code));
    }
    for (const item of body.userList || []) {
      const user = item.user || {};
      const stats = item.statsV2 || item.stats || {};
      users.push({
        id: user.id || "",
        secUid: user.secUid || "",
        uniqueId: user.uniqueId || "",
        nickname: user.nickname || "",
        signature: user.signature || "",
        verified: Boolean(user.verified),
        privateAccount: Boolean(user.privateAccount),
        followerCount: Number(stats.followerCount || 0),
        followingCount: Number(stats.followingCount || 0),
      });
    }
    hasMore = Boolean(body.hasMore) && (body.userList || []).length > 0;
    minCursor = body.minCursor ?? minCursor;
    maxCursor = body.maxCursor ?? maxCursor;
    page += 1;
  }

  const byUniqueID = new Map();
  for (const user of users) {
    const key = user.uniqueId || user.secUid || user.id;
    if (key && !byUniqueID.has(key)) byUniqueID.set(key, user);
  }
  return {
    viewer: {
      id: viewer.uid,
      secUid: viewer.secUid,
      uniqueId: viewer.uniqueId,
      nickname: viewer.nickName,
    },
    totalReported: users.length ? undefined : 0,
    totalUnique: byUniqueID.size,
    users: [...byUniqueID.values()],
  };
})()
`;

const response = await fetch(`${serverURL}/v1/runtime/evaluate`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ tab_id: tabID, world: "MAIN", expression }),
});

if (!response.ok) {
  throw new Error(`BrowserBridge evaluate failed: HTTP ${response.status} ${await response.text()}`);
}

const result = await response.json();
const users = result.users || [];
const outputDir = resolve("exports");
await mkdir(outputDir, { recursive: true });

const baseName = `tiktok-following-${result.viewer?.uniqueId || "unknown"}`;
const jsonPath = resolve(outputDir, `${baseName}.json`);
const csvPath = resolve(outputDir, `${baseName}.csv`);

await writeFile(jsonPath, JSON.stringify(result, null, 2));
await writeFile(csvPath, toCSV(users, ["uniqueId", "nickname", "id", "secUid", "verified", "privateAccount", "followerCount", "followingCount", "signature"]));
let dbSaved = 0;
if (databaseURL) {
  dbSaved = await saveSocialUsersToDatabase(databaseURL, "tiktok", users.map((user) => ({
    ...user,
    username: user.uniqueId,
    displayName: user.nickname,
    profileURL: user.uniqueId ? `https://www.tiktok.com/@${user.uniqueId}` : "",
  })));
}

console.log(JSON.stringify({
  viewer: result.viewer,
  totalUnique: users.length,
  dbSaved,
  jsonPath,
  csvPath,
  preview: users.slice(0, 10).map((user) => ({ uniqueId: user.uniqueId, nickname: user.nickname })),
}, null, 2));
