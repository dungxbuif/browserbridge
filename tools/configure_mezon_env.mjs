import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
const envPath = args.targetEnvFile ? pathToFileURL(resolve(args.targetEnvFile)) : new URL("../server/.env", import.meta.url);
const dryRun = Boolean(args.dryRun);
const existingEnv = await readExistingEnv(envPath);

const updates = {
  MEZON_BOT_ID: firstPresent(args.botId, process.env.MEZON_BOT_ID, existingEnv.MEZON_BOT_ID),
  MEZON_BOT_TOKEN: firstPresent(args.token, process.env.MEZON_BOT_TOKEN, existingEnv.MEZON_BOT_TOKEN),
  MEZON_CHANNEL_ID: firstPresent(args.channel, process.env.MEZON_CHANNEL_ID, existingEnv.MEZON_CHANNEL_ID),
  MEZON_ADMIN_USER_ID: firstPresent(args.admin, process.env.MEZON_ADMIN_USER_ID, existingEnv.MEZON_ADMIN_USER_ID),
};
const optionalUpdates = omitEmpty({
  MEZON_HOST: firstPresent(args.host, process.env.MEZON_HOST, existingEnv.MEZON_HOST),
  MEZON_PORT: firstPresent(args.port, process.env.MEZON_PORT, existingEnv.MEZON_PORT),
  MEZON_USE_SSL: firstPresent(args.useSSL, process.env.MEZON_USE_SSL, existingEnv.MEZON_USE_SSL),
  MEZON_TIMEOUT_MS: firstPresent(args.timeoutMs, process.env.MEZON_TIMEOUT_MS, existingEnv.MEZON_TIMEOUT_MS),
  BOT_SINGLE_HOST_LOCK: firstPresent(args.singleHostLock, process.env.BOT_SINGLE_HOST_LOCK, existingEnv.BOT_SINGLE_HOST_LOCK),
  BOT_LOCK_FILE: firstPresent(args.lockFile, process.env.BOT_LOCK_FILE, existingEnv.BOT_LOCK_FILE),
});

const missing = Object.entries(updates)
  .filter(([, value]) => !String(value || "").trim())
  .map(([key]) => key);

if (missing.length > 0) {
  console.log(JSON.stringify({
    ok: false,
    changed: false,
    missing,
    usage: "node tools/configure_mezon_env.mjs --bot-id <bot-id> --token <bot-token> --channel <channel-id> --admin <admin-user-id> [--host gw.mezon.ai] [--port 443]",
  }, null, 2));
  process.exit(1);
}

const validationErrors = validateUpdates({ ...updates, ...optionalUpdates });
if (validationErrors.length > 0) {
  console.log(JSON.stringify({
    ok: false,
    changed: false,
    errors: validationErrors,
  }, null, 2));
  process.exit(1);
}

if (!dryRun) {
  await upsertEnv(envPath, { ...updates, ...optionalUpdates });
}

console.log(JSON.stringify({
  ok: true,
  changed: !dryRun,
  dryRun,
  env: Object.fromEntries([...Object.keys(updates), ...Object.keys(optionalUpdates)].map((key) => [key, true])),
}, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || "";
    if (arg === "--token") {
      result.token = next;
      index += 1;
    } else if (arg === "--bot-id") {
      result.botId = next;
      index += 1;
    } else if (arg === "--channel") {
      result.channel = next;
      index += 1;
    } else if (arg === "--admin") {
      result.admin = next;
      index += 1;
    } else if (arg === "--host") {
      result.host = next;
      index += 1;
    } else if (arg === "--port") {
      result.port = next;
      index += 1;
    } else if (arg === "--use-ssl") {
      result.useSSL = next;
      index += 1;
    } else if (arg === "--timeout-ms") {
      result.timeoutMs = next;
      index += 1;
    } else if (arg === "--single-host-lock") {
      result.singleHostLock = next;
      index += 1;
    } else if (arg === "--lock-file") {
      result.lockFile = next;
      index += 1;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--env-file" || arg === "--target-env-file") {
      result.targetEnvFile = next;
      index += 1;
    }
  }
  return result;
}

function omitEmpty(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => String(value || "").trim()));
}

async function readExistingEnv(pathURL) {
  if (!existsSync(pathURL)) return {};
  const text = await readFile(pathURL, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    out[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return out;
}

function unquoteEnvValue(value) {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

function firstPresent(...values) {
  for (const value of values) {
    if (String(value || "").trim()) return value;
  }
  return "";
}

async function upsertEnv(pathURL, updates) {
  const text = existsSync(pathURL) ? await readFile(pathURL, "utf8") : "";
  let next = text;
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${shellQuote(value)}`;
    if (new RegExp(`^${key}=`, "m").test(next)) {
      next = next.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
      if (next && !next.endsWith("\n")) next += "\n";
      next += `${line}\n`;
    }
  }
  await writeFile(pathURL, next, { mode: 0o600 });
}

function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:@?=&-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function validateUpdates(values) {
  const errors = [];
  for (const key of ["MEZON_BOT_ID", "MEZON_BOT_TOKEN", "MEZON_CHANNEL_ID", "MEZON_ADMIN_USER_ID"]) {
    if (!String(values[key] || "").trim()) errors.push(`${key} is required`);
  }
  if (values.MEZON_HOST && !/^[A-Za-z0-9.-]+$/.test(values.MEZON_HOST)) {
    errors.push("MEZON_HOST must be a hostname");
  }
  if (values.MEZON_PORT && !validPort(values.MEZON_PORT)) {
    errors.push("MEZON_PORT must be a valid port");
  }
  if (values.MEZON_TIMEOUT_MS && !positiveInt(values.MEZON_TIMEOUT_MS)) {
    errors.push("MEZON_TIMEOUT_MS must be a positive integer");
  }
  for (const key of ["MEZON_USE_SSL", "BOT_SINGLE_HOST_LOCK"]) {
    if (values[key] && !validBoolean(values[key])) errors.push(`${key} must be a boolean`);
  }
  return errors;
}

function validPort(raw) {
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && String(port) === String(raw).trim() && port > 0 && port <= 65535;
}

function positiveInt(raw) {
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && String(value) === String(raw).trim() && value > 0;
}

function validBoolean(raw) {
  return ["1", "0", "true", "false", "yes", "no", "on", "off"].includes(String(raw || "").trim().toLowerCase());
}
