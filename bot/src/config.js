import dotenv from "dotenv";

dotenv.config({ path: new URL("../../server/.env", import.meta.url).pathname });
dotenv.config();

const defaultBotLockFile = new URL("../browserbridge-mezon-bot.lock", import.meta.url).pathname;

export function loadConfig() {
  return loadBotConfig();
}

export function loadBotConfig() {
  const cfg = {
    databaseUrl: process.env.DATABASE_URL || "",
    mezonBotId: process.env.MEZON_BOT_ID || "",
    mezonToken: process.env.MEZON_BOT_TOKEN || "",
    mezonHost: process.env.MEZON_HOST || "gw.mezon.ai",
    mezonPort: parsePort(process.env.MEZON_PORT || "443", "MEZON_PORT"),
    mezonUseSSL: parseBoolean(process.env.MEZON_USE_SSL || "true", "MEZON_USE_SSL"),
    mezonTimeoutMs: parsePositiveInt(process.env.MEZON_TIMEOUT_MS || "10000", "MEZON_TIMEOUT_MS"),
    channelId: process.env.MEZON_CHANNEL_ID || "",
    adminUserId: process.env.MEZON_ADMIN_USER_ID || "",
    postIntervalSeconds: parsePositiveInt(process.env.BOT_POST_INTERVAL_SECONDS || "3600", "BOT_POST_INTERVAL_SECONDS"),
    commandPrefix: process.env.BOT_COMMAND_PREFIX || "*bb",
    dedupTTLSeconds: parsePositiveInt(process.env.BOT_DEDUP_TTL_SECONDS || "86400", "BOT_DEDUP_TTL_SECONDS"),
    mediaClaimTTLSeconds: parsePositiveInt(process.env.BOT_MEDIA_CLAIM_TTL_SECONDS || "300", "BOT_MEDIA_CLAIM_TTL_SECONDS"),
    singleHostLock: parseBoolean(process.env.BOT_SINGLE_HOST_LOCK || "true", "BOT_SINGLE_HOST_LOCK"),
    lockFile: process.env.BOT_LOCK_FILE || defaultBotLockFile,
  };
  const missing = [];
  for (const [key, value] of Object.entries({
    DATABASE_URL: cfg.databaseUrl,
    MEZON_BOT_ID: cfg.mezonBotId,
    MEZON_BOT_TOKEN: cfg.mezonToken,
    MEZON_CHANNEL_ID: cfg.channelId,
    MEZON_ADMIN_USER_ID: cfg.adminUserId,
  })) {
    if (!String(value).trim()) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }
  return cfg;
}

export function loadWorkerConfig() {
  const cfg = {
    databaseUrl: process.env.DATABASE_URL || "",
    bridgeHttpUrl: process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788",
    bridgeAuthToken: process.env.BROWSER_BRIDGE_AUTH_TOKEN || "",
    platform: parseSocialPlatform(process.env.SOCIAL_MEDIA_PLATFORM || "tiktok"),
    scanIntervalSeconds: parsePositiveInt(process.env.SOCIAL_MEDIA_SCAN_INTERVAL_SECONDS || "1800", "SOCIAL_MEDIA_SCAN_INTERVAL_SECONDS"),
    userCooldownSeconds: parsePositiveInt(process.env.SOCIAL_MEDIA_USER_COOLDOWN_SECONDS || "21600", "SOCIAL_MEDIA_USER_COOLDOWN_SECONDS"),
    userClaimTTLSeconds: parsePositiveInt(process.env.SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS || "900", "SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS"),
    maxUsersPerTick: parsePositiveInt(process.env.SOCIAL_MEDIA_MAX_USERS_PER_TICK || "3", "SOCIAL_MEDIA_MAX_USERS_PER_TICK"),
    maxMediaPerUser: parsePositiveInt(process.env.SOCIAL_MEDIA_MAX_MEDIA_PER_USER || "20", "SOCIAL_MEDIA_MAX_MEDIA_PER_USER"),
    pageLoadWaitMs: parsePositiveInt(process.env.SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS || "5000", "SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS"),
    runOnce: parseOptionalBoolean(process.env.SOCIAL_MEDIA_WORKER_RUN_ONCE || "", "SOCIAL_MEDIA_WORKER_RUN_ONCE"),
  };
  const missing = [];
  for (const [key, value] of Object.entries({
    DATABASE_URL: cfg.databaseUrl,
    BROWSER_BRIDGE_AUTH_TOKEN: cfg.bridgeAuthToken,
  })) {
    if (!String(value).trim()) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }
  return cfg;
}

function parsePositiveInt(raw, name) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function parseBoolean(raw, name) {
  const value = String(raw || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be a boolean`);
}

function parseOptionalBoolean(raw, name) {
  if (!String(raw || "").trim()) return false;
  return parseBoolean(raw, name);
}

function parsePort(raw, name) {
  const port = parsePositiveInt(raw, name);
  if (port > 65535) throw new Error(`${name} must be a valid port`);
  return String(port);
}

function parseSocialPlatform(raw) {
  const platform = String(raw || "").trim().toLowerCase();
  if (["all", "tiktok", "instagram"].includes(platform)) return platform;
  throw new Error("SOCIAL_MEDIA_PLATFORM must be all, tiktok, or instagram");
}
