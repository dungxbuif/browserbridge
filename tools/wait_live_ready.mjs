import { createRequire } from "node:module";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const cfg = {
  bridgeHttpUrl: process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788",
  bridgeAuthToken: process.env.BROWSER_BRIDGE_AUTH_TOKEN || "",
  databaseUrl: process.env.DATABASE_URL || "",
  waitSeconds: positiveInt(args["wait-seconds"] || "120", "wait-seconds"),
  intervalSeconds: positiveInt(args["interval-seconds"] || "5", "interval-seconds"),
};

const deadline = Date.now() + cfg.waitSeconds * 1000;
let lastReport = null;

while (Date.now() <= deadline) {
  reloadEnv();
  lastReport = await readinessReport();
  printCompact(lastReport);
  if (lastReport.ok) {
    process.exit(0);
  }
  await sleep(cfg.intervalSeconds * 1000);
}

console.log(JSON.stringify({
  ok: false,
  timedOut: true,
  waitedSeconds: cfg.waitSeconds,
  lastReport,
}, null, 2));
process.exit(1);

async function readinessReport() {
  const env = {
    BROWSER_BRIDGE_AUTH_TOKEN: present(cfg.bridgeAuthToken),
    DATABASE_URL: present(cfg.databaseUrl),
    MEZON_BOT_ID: present(process.env.MEZON_BOT_ID),
    MEZON_BOT_TOKEN: present(process.env.MEZON_BOT_TOKEN),
    MEZON_CHANNEL_ID: present(process.env.MEZON_CHANNEL_ID),
    MEZON_ADMIN_USER_ID: present(process.env.MEZON_ADMIN_USER_ID),
  };
  const browserBridge = await bridgeStatus();
  const database = await databaseStatus();
  const ok = Object.values(env).every(Boolean) && browserBridge.ok && database.ok;
  const hints = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) hints.push(`Set ${name} in server/.env`);
  }
  if (!browserBridge.healthOk) hints.push("Start BrowserBridge server with ./scripts/run-server.sh or ./scripts/run-stack.sh");
  if (!browserBridge.extensionConnected) hints.push("Open Chrome extension options, set ws://127.0.0.1:8788/v1/extension, save token, and enable control");
  if (!database.ok) hints.push("Run ./scripts/setup-local-postgres.sh");
  return { ok, env, browserBridge, database, hints };
}

async function bridgeStatus() {
  if (!cfg.bridgeAuthToken) return { ok: false, healthOk: false, extensionConnected: false, error: "missing auth token" };
  try {
    const health = await fetchJSON("/healthz", false);
    const status = await fetchJSON("/v1/status", true);
    return {
      ok: Boolean(health?.ok) && Boolean(status?.extension_connected) && Boolean(status?.drive_configured) && Boolean(status?.media_store_set),
      healthOk: Boolean(health?.ok),
      extensionConnected: Boolean(status?.extension_connected),
      driveConfigured: Boolean(status?.drive_configured),
      driveFolderSet: Boolean(status?.drive_folder_set),
      mediaStoreSet: Boolean(status?.media_store_set),
      activeUploads: status?.active_uploads ?? null,
    };
  } catch (error) {
    return { ok: false, healthOk: false, extensionConnected: false, error: safeError(error) };
  }
}

async function databaseStatus() {
  if (!cfg.databaseUrl) return { ok: false, error: "missing database URL" };
  const client = new Client({ connectionString: cfg.databaseUrl });
  try {
    await client.connect();
    const counts = {};
    for (const table of ["social_users", "media_assets", "mezon_users", "media_reactions", "media_archives", "bot_media_posts"]) {
      counts[table] = await countTable(client, table);
    }
    return { ok: true, counts };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function fetchJSON(path, auth) {
  const headers = auth ? { Authorization: `Bearer ${cfg.bridgeAuthToken}` } : {};
  const response = await fetch(`${cfg.bridgeHttpUrl.replace(/\/+$/, "")}${path}`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function countTable(client, table) {
  const exists = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  if (!exists.rows[0]?.name) return null;
  const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

function printCompact(report) {
  console.log(JSON.stringify({
    ok: report.ok,
    env: report.env,
    browserBridge: report.browserBridge,
    database: report.database,
    hints: report.hints,
  }, null, 2));
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

function positiveInt(raw, name) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function present(value) {
  return String(value || "").trim().length > 0;
}

function safeError(error) {
  return String(error?.message || error).replaceAll(cfg.bridgeAuthToken, "[redacted]");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reloadEnv() {
  dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
  dotenv.config();
}
