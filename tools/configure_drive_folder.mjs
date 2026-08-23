import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const envPath = new URL("../server/.env", import.meta.url);
const env = await readEnv(envPath);

const existingFolderID = env.GOOGLE_DRIVE_FOLDER_ID || "";
if (existingFolderID && !process.env.FORCE_CREATE_DRIVE_FOLDER) {
  console.log(JSON.stringify({ ok: true, changed: false, folderId: existingFolderID }, null, 2));
  process.exit(0);
}

const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN || "";
if (!refreshToken) throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN is required");

const client = await loadOAuthClient(env);
const accessToken = await refreshAccessToken({ ...client, refreshToken });
const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || env.GOOGLE_DRIVE_FOLDER_NAME || "BrowserBridge Media";
const parentFolderID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "";

const folder = await createDriveFolder({ accessToken, name: folderName, parentFolderID });
await upsertEnv(envPath, {
  GOOGLE_DRIVE_FOLDER_ID: folder.id,
  GOOGLE_DRIVE_FOLDER_NAME: folderName,
});

console.log(JSON.stringify({
  ok: true,
  changed: true,
  folderId: folder.id,
  folderName,
  webViewLink: folder.webViewLink || "",
}, null, 2));

async function loadOAuthClient(values) {
  const directID = values.GOOGLE_DRIVE_CLIENT_ID || "";
  const directSecret = values.GOOGLE_DRIVE_CLIENT_SECRET || "";
  if (directID && directSecret) return { clientId: directID, clientSecret: directSecret };

  const secretFile = values.GOOGLE_DRIVE_CLIENT_SECRET_FILE || "";
  if (!secretFile) throw new Error("GOOGLE_DRIVE_CLIENT_SECRET_FILE or GOOGLE_DRIVE_CLIENT_ID/SECRET is required");
  const raw = JSON.parse(await readFile(secretFile, "utf8"));
  const config = raw.installed || raw.web;
  if (!config?.client_id || !config?.client_secret) {
    throw new Error("client secret file does not contain installed/web client_id and client_secret");
  }
  return { clientId: config.client_id, clientSecret: config.client_secret };
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`refresh token failed: HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  if (!body.access_token) throw new Error("refresh token response missing access_token");
  return body.access_token;
}

async function createDriveFolder({ accessToken, name, parentFolderID }) {
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentFolderID ? { parents: [parentFolderID] } : {}),
  };
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(`create drive folder failed: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function readEnv(pathURL) {
  if (!existsSync(pathURL)) return {};
  const text = await readFile(pathURL, "utf8");
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
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
  await writeFile(pathURL, next);
}

function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:@?=&-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
