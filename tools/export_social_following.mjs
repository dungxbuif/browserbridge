import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { BrowserBridgeClient } from "../bot/src/bridge-client.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const platform = String(args.platform || "all").toLowerCase();
const cfg = {
  bridgeHttpUrl: process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788",
  bridgeAuthToken: process.env.BROWSER_BRIDGE_AUTH_TOKEN || "",
  tiktokTabId: positiveOptionalInt(args["tiktok-tab-id"] || process.env.TIKTOK_TAB_ID, "tiktok-tab-id"),
  instagramTabId: positiveOptionalInt(args["instagram-tab-id"] || process.env.INSTAGRAM_TAB_ID, "instagram-tab-id"),
};

if (!cfg.bridgeAuthToken) throw new Error("BROWSER_BRIDGE_AUTH_TOKEN is required");
if (!["all", "tiktok", "instagram"].includes(platform)) throw new Error("--platform must be all, tiktok, or instagram");

const bridge = new BrowserBridgeClient({ baseUrl: cfg.bridgeHttpUrl, token: cfg.bridgeAuthToken });
let tabs = [];
try {
  tabs = await bridge.listTabs();
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    bridgeHttpUrl: cfg.bridgeHttpUrl,
    error: sanitize(error?.message || error),
    hints: [
      "Run ./scripts/run-server.sh or ./scripts/run-live-uat.sh",
      "Connect BrowserBridge Chrome extension, then retry",
    ],
  }, null, 2));
  process.exit(1);
}
const selected = {
  tiktok: cfg.tiktokTabId || selectTab(tabs, "tiktok"),
  instagram: cfg.instagramTabId || selectTab(tabs, "instagram"),
};

const jobs = [];
if (platform === "all" || platform === "tiktok") jobs.push(["tiktok", selected.tiktok, "tools/export_tiktok_following.mjs", "TIKTOK_TAB_ID"]);
if (platform === "all" || platform === "instagram") jobs.push(["instagram", selected.instagram, "tools/export_instagram_following.mjs", "INSTAGRAM_TAB_ID"]);

const report = {
  ok: true,
  bridgeHttpUrl: cfg.bridgeHttpUrl,
  tabsSeen: Array.isArray(tabs) ? tabs.length : 0,
  selected,
  results: [],
  hints: [],
};

for (const [name, tabId, script, envName] of jobs) {
  if (!tabId) {
    report.ok = false;
    report.results.push({ platform: name, ok: false, error: `no ${name} tab found` });
    report.hints.push(`Open a logged-in ${name} tab, or pass --${name}-tab-id <tab-id>`);
    continue;
  }
  const result = await runExporter({ name, tabId, script, envName });
  if (!result.ok) report.ok = false;
  report.results.push(result);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function selectTab(tabs, name) {
  if (!Array.isArray(tabs)) return 0;
  const matcher = name === "tiktok"
    ? (url) => /(^|\.)tiktok\.com/i.test(hostname(url))
    : (url) => /(^|\.)instagram\.com/i.test(hostname(url));
  const tab = tabs.find((item) => matcher(item.url || item.pendingUrl || ""));
  return positiveOptionalInt(tab?.id || tab?.tab_id || tab?.tabId, name);
}

async function runExporter({ name, tabId, script, envName }) {
  const env = { ...process.env, [envName]: String(tabId) };
  const child = spawn(process.execPath, [script], {
    cwd: new URL("..", import.meta.url).pathname,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) {
    return { platform: name, tabId, ok: false, exitCode: code, error: sanitize(stderr || stdout) };
  }
  return { platform: name, tabId, ok: true, output: parseJSON(stdout) || sanitize(stdout) };
}

function hostname(rawURL) {
  try {
    return new URL(rawURL).hostname;
  } catch {
    return "";
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitize(text) {
  return String(text || "").replaceAll(cfg.bridgeAuthToken, "[redacted]").trim();
}

function parseArgs(raw) {
  const out = {};
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = raw[i + 1];
    out[key] = next && !next.startsWith("--") ? next : "true";
    if (out[key] === next) i += 1;
  }
  return out;
}

function positiveOptionalInt(raw, name) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
