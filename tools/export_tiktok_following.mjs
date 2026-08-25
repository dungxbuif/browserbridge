import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { saveSocialUsersToDatabase, toCSV } from "./social_db.mjs";

const token = process.env.BROWSER_BRIDGE_AUTH_TOKEN;
const tabID = Number.parseInt(process.env.TIKTOK_TAB_ID || "", 10);
const serverURL = process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788";
const databaseURL = process.env.DATABASE_URL || "";

if (!token) throw new Error("BROWSER_BRIDGE_AUTH_TOKEN is required");
if (!Number.isInteger(tabID) || tabID <= 0) throw new Error("TIKTOK_TAB_ID is required");

async function evaluate(expression) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${serverURL}/v1/runtime/evaluate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tab_id: tabID, world: "MAIN", expression }),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt < 5 && (res.status === 503 || res.status === 502)) {
      process.stderr.write(`  [retry ${attempt}/5] HTTP ${res.status} — waiting 1.5s\n`);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`evaluate failed HTTP ${res.status}: ${text}`);
  }
}

// Step 1: get viewer secUid from page universal state
const viewer = await evaluate(`(()=>{
  const el=document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if(!el)throw new Error("universal state not found");
  const s=JSON.parse(el.textContent);
  const u=(s.__DEFAULT_SCOPE__||{})["webapp.app-context"]?.user||{};
  if(!u.secUid)throw new Error("viewer secUid not found — open a TikTok page first");
  return {uid:u.uid,secUid:u.secUid,uniqueId:u.uniqueId,nickname:u.nickName||u.nickname};
})()`);

process.stderr.write(`viewer: @${viewer.uniqueId} (${viewer.uid})\n`);

// Step 2: paginate from Node — each page = one short evaluate
const allUsers = new Map();
let minCursor = 0;
let maxCursor = 0;
let hasMore = true;
let page = 0;
const MAX_PAGES = 150;

while (hasMore && page < MAX_PAGES) {
  const params = JSON.stringify({
    aid: "1988", app_name: "tiktok_web", device_platform: "web_pc",
    count: "30",
    maxCursor: String(maxCursor),
    minCursor: String(minCursor),
    secUid: viewer.secUid,
  });

  const body = await evaluate(`(async()=>{
    const p=new URLSearchParams(${params});
    const r=await fetch("/api/user/list/?"+p.toString(),{
      credentials:"include",headers:{accept:"application/json, text/plain, */*"}
    });
    const b=await r.json();
    return {ok:r.status,code:b.statusCode??b.status_code,hasMore:!!b.hasMore,
            minCursor:b.minCursor,maxCursor:b.maxCursor,
            users:(b.userList||[]).map(i=>({
              id:(i.user||{}).id||"",
              secUid:(i.user||{}).secUid||"",
              uniqueId:(i.user||{}).uniqueId||"",
              nickname:(i.user||{}).nickname||"",
              signature:(i.user||{}).signature||"",
              verified:!!(i.user||{}).verified,
              privateAccount:!!(i.user||{}).privateAccount,
              followerCount:Number((i.statsV2||i.stats||{}).followerCount||0),
              followingCount:Number((i.statsV2||i.stats||{}).followingCount||0),
            }))};
  })()`);

  if (body.code !== 0 && body.code !== undefined) {
    throw new Error(`TikTok API status code ${body.code} on page ${page}`);
  }

  for (const u of body.users || []) {
    const key = u.uniqueId || u.secUid || u.id;
    if (key && !allUsers.has(key)) allUsers.set(key, u);
  }

  process.stderr.write(`  page ${page + 1}: +${(body.users||[]).length} users (total unique: ${allUsers.size})\n`);

  hasMore = body.hasMore && (body.users || []).length > 0;
  minCursor = body.minCursor ?? minCursor;
  maxCursor = body.maxCursor ?? maxCursor;
  page += 1;
}

const users = [...allUsers.values()];

// Step 3: save to files + DB
const outputDir = resolve("exports");
await mkdir(outputDir, { recursive: true });
const baseName = `tiktok-following-${viewer.uniqueId || "unknown"}`;
await writeFile(resolve(outputDir, `${baseName}.json`), JSON.stringify({ viewer, users }, null, 2));
await writeFile(resolve(outputDir, `${baseName}.csv`), toCSV(users, ["uniqueId","nickname","id","secUid","verified","privateAccount","followerCount","followingCount","signature"]));

let dbSaved = 0;
if (databaseURL) {
  dbSaved = await saveSocialUsersToDatabase(databaseURL, "tiktok", users.map(u => ({
    ...u,
    username: u.uniqueId,
    displayName: u.nickname,
    profileURL: u.uniqueId ? `https://www.tiktok.com/@${u.uniqueId}` : "",
  })));
}

console.log(JSON.stringify({
  viewer,
  totalUnique: users.length,
  pages: page,
  dbSaved,
  jsonPath: resolve(outputDir, `${baseName}.json`),
  csvPath: resolve(outputDir, `${baseName}.csv`),
  preview: users.slice(0, 5).map(u => ({ uniqueId: u.uniqueId, nickname: u.nickname })),
}, null, 2));
