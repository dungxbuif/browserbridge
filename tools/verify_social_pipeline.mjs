import { createRequire } from "node:module";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const cfg = {
  bridgeHttpUrl: process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788",
  bridgeAuthToken: process.env.BROWSER_BRIDGE_AUTH_TOKEN || "",
  databaseUrl: process.env.DATABASE_URL || "",
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
  googleDriveAccessToken: process.env.GOOGLE_DRIVE_ACCESS_TOKEN || "",
  googleDriveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "",
  mezonBotId: process.env.MEZON_BOT_ID || "",
  mezonBotToken: process.env.MEZON_BOT_TOKEN || "",
  mezonChannelId: process.env.MEZON_CHANNEL_ID || "",
  mezonAdminUserId: process.env.MEZON_ADMIN_USER_ID || "",
};

const report = {
  ok: true,
  env: {
    BROWSER_BRIDGE_AUTH_TOKEN: present(cfg.bridgeAuthToken),
    DATABASE_URL: present(cfg.databaseUrl),
    GOOGLE_DRIVE_FOLDER_ID: present(cfg.googleDriveFolderId),
    GOOGLE_DRIVE_TOKEN: present(cfg.googleDriveAccessToken || cfg.googleDriveRefreshToken),
    MEZON_BOT_ID: present(cfg.mezonBotId),
    MEZON_BOT_TOKEN: present(cfg.mezonBotToken),
    MEZON_CHANNEL_ID: present(cfg.mezonChannelId),
    MEZON_ADMIN_USER_ID: present(cfg.mezonAdminUserId),
  },
  browserBridge: null,
  database: null,
  hints: [],
};

for (const [name, value] of Object.entries(report.env)) {
  if (!value) {
    report.ok = false;
    report.hints.push(name === "DATABASE_URL" ? "Run ./scripts/setup-local-postgres.sh or set DATABASE_URL in server/.env" : `Set ${name} in server/.env`);
  }
}

await checkBrowserBridge();
await checkDatabase();

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

async function checkBrowserBridge() {
  if (!cfg.bridgeAuthToken) {
    report.browserBridge = { ok: false, url: redactedBridgeURL(), error: "missing auth token" };
    return;
  }
  try {
    const health = await fetchJSON("/healthz", { auth: false });
    const statusResult = await fetchOptionalJSON("/v1/status", { auth: true });
    const status = statusResult.ok ? statusResult.data : null;
    const tabs = status?.extension_connected ? await fetchJSON("/v1/tabs", { auth: true }) : null;
    report.browserBridge = {
      ok: Boolean(health?.ok) && Boolean(status?.drive_configured) && Boolean(status?.media_store_set) && Boolean(status?.extension_connected),
      url: redactedBridgeURL(),
      healthOk: Boolean(health?.ok),
      statusOk: statusResult.ok,
      statusError: statusResult.ok ? null : statusResult.error,
      extensionConnected: Boolean(status?.extension_connected),
      driveConfigured: Boolean(status?.drive_configured),
      driveFolderSet: Boolean(status?.drive_folder_set),
      mediaStoreSet: Boolean(status?.media_store_set),
      activeUploads: status?.active_uploads ?? null,
      tabCount: Array.isArray(tabs) ? tabs.length : 0,
    };
    if (!report.browserBridge.ok) {
      report.ok = false;
      if (!report.browserBridge.statusOk) {
        report.hints.push("BROWSER_BRIDGE_HTTP_URL points to a server without /v1/status; restart BrowserBridge or fix the port");
      } else if (!report.browserBridge.driveConfigured || !report.browserBridge.mediaStoreSet) {
        report.hints.push("Restart ./scripts/run-server.sh so it loads current server/.env");
      }
      if (!report.browserBridge.extensionConnected) {
        report.hints.push("Connect BrowserBridge Chrome extension, then retry /v1/status");
      }
    }
  } catch (error) {
    report.ok = false;
    report.browserBridge = { ok: false, url: redactedBridgeURL(), error: safeError(error) };
    report.hints.push("Run ./scripts/run-server.sh and make sure extension is enabled/connected");
  }
}

async function checkDatabase() {
  if (!cfg.databaseUrl) {
    report.database = { ok: false, error: "missing database URL" };
    return;
  }
  const client = new Client({ connectionString: cfg.databaseUrl });
  try {
    await client.connect();
    const counts = {};
    for (const table of ["social_users", "media_assets", "mezon_users", "media_reactions", "media_archives", "bot_media_posts", "bot_event_dedup"]) {
      counts[table] = await countTable(client, table);
    }
    const dueUsers = await client.query(`
      SELECT platform, count(*)::int AS count
      FROM social_users
      WHERE COALESCE(profile_url, '') <> '' OR COALESCE(username, '') <> ''
      GROUP BY platform
      ORDER BY platform
    `);
    const readyMedia = await client.query(`
      SELECT platform, count(*)::int AS count
      FROM media_assets
      WHERE archived_at IS NULL
      GROUP BY platform
      ORDER BY platform
    `);
    report.database = {
      ok: true,
      counts,
      scrapeCandidatesByPlatform: Object.fromEntries(dueUsers.rows.map((row) => [row.platform, row.count])),
      postableMediaByPlatform: Object.fromEntries(readyMedia.rows.map((row) => [row.platform, row.count])),
    };
  } catch (error) {
    report.ok = false;
    report.database = { ok: false, error: safeError(error) };
    report.hints.push("Run ./scripts/setup-local-postgres.sh, or start PostgreSQL and set DATABASE_URL manually");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function fetchJSON(path, { auth }) {
  const headers = auth ? { Authorization: `Bearer ${cfg.bridgeAuthToken}` } : {};
  const response = await fetch(`${cfg.bridgeHttpUrl.replace(/\/+$/, "")}${path}`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function fetchOptionalJSON(path, { auth }) {
  try {
    return { ok: true, data: await fetchJSON(path, { auth }) };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

async function countTable(client, table) {
  const exists = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  if (!exists.rows[0]?.name) return null;
  const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

function present(value) {
  return String(value || "").trim().length > 0;
}

function safeError(error) {
  return String(error?.message || error).replaceAll(cfg.bridgeAuthToken, "[redacted]");
}

function redactedBridgeURL() {
  return cfg.bridgeHttpUrl.replaceAll(cfg.bridgeAuthToken, "[redacted]");
}
