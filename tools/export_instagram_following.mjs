import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { saveSocialUsersToDatabase, toCSV } from "./social_db.mjs";

const token = process.env.BROWSER_BRIDGE_AUTH_TOKEN;
const tabID = Number.parseInt(process.env.INSTAGRAM_TAB_ID || "", 10);
const serverURL = process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788";
const databaseURL = process.env.DATABASE_URL || "";
const maxPages = Number.parseInt(process.env.INSTAGRAM_FOLLOWING_MAX_PAGES || "200", 10);

if (!token) throw new Error("BROWSER_BRIDGE_AUTH_TOKEN is required");
if (!Number.isInteger(tabID) || tabID <= 0) throw new Error("INSTAGRAM_TAB_ID is required");

const expression = String.raw`
(async () => {
  const maxPages = ${Number.isInteger(maxPages) && maxPages > 0 ? maxPages : 200};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findViewer = () => {
    const scripts = [...document.querySelectorAll('script[type="application/json"], script:not([src])')];
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes('"username"') && !text.includes('"profile_id"') && !text.includes('"viewer"')) continue;
      const ids = [...text.matchAll(/"profile_id"\s*:\s*"?(\\d+)"?/g)].map((match) => match[1]);
      const usernames = [...text.matchAll(/"username"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
      if (ids.length > 0) {
        return { id: ids[0], username: usernames[0] || "" };
      }
    }
    return null;
  };
  const viewer = findViewer();
  if (!viewer?.id) {
    throw new Error("Instagram viewer/profile id not found. Open your Instagram profile tab first.");
  }

  const appID =
    document.querySelector('meta[property="al:ios:app_store_id"]')?.content ||
    document.querySelector('meta[name="apple-itunes-app"]')?.content?.match(/app-id=(\\d+)/)?.[1] ||
    "936619743392459";

  const users = [];
  const seen = new Set();
  let maxID = "";
  let page = 0;
  while (page < maxPages) {
    const params = new URLSearchParams({ count: "50" });
    if (maxID) params.set("max_id", maxID);
    const response = await fetch("/api/v1/friendships/" + viewer.id + "/following/?" + params.toString(), {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
        "x-ig-app-id": appID,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    if (!response.ok) throw new Error("Instagram following API HTTP " + response.status);
    const body = await response.json();
    const pageUsers = body.users || [];
    for (const user of pageUsers) {
      const id = String(user.pk || user.pk_id || user.id || "");
      const username = user.username || "";
      const key = id || username;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      users.push({
        id,
        username,
        fullName: user.full_name || "",
        isPrivate: Boolean(user.is_private),
        isVerified: Boolean(user.is_verified),
        avatarURL: user.profile_pic_url || "",
        profileURL: username ? "https://www.instagram.com/" + username + "/" : "",
        latestReelMedia: user.latest_reel_media || 0,
      });
    }
    maxID = body.next_max_id || "";
    page += 1;
    if (!maxID || pageUsers.length === 0) break;
    await sleep(500);
  }

  return {
    viewer,
    totalUnique: users.length,
    users,
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

const baseName = `instagram-following-${result.viewer?.username || result.viewer?.id || "unknown"}`;
const jsonPath = resolve(outputDir, `${baseName}.json`);
const csvPath = resolve(outputDir, `${baseName}.csv`);

await writeFile(jsonPath, JSON.stringify(result, null, 2));
await writeFile(csvPath, toCSV(users, ["username", "fullName", "id", "isPrivate", "isVerified", "avatarURL", "profileURL"]));

let dbSaved = 0;
if (databaseURL) {
  dbSaved = await saveSocialUsersToDatabase(databaseURL, "instagram", users);
}

console.log(JSON.stringify({
  viewer: result.viewer,
  totalUnique: users.length,
  dbSaved,
  jsonPath,
  csvPath,
  preview: users.slice(0, 10).map((user) => ({ username: user.username, fullName: user.fullName })),
}, null, 2));
