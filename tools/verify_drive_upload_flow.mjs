import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const cfg = {
  bridgeHttpUrl: process.env.BROWSER_BRIDGE_HTTP_URL || "http://127.0.0.1:8788",
  bridgeAuthToken: process.env.BROWSER_BRIDGE_AUTH_TOKEN || "",
  databaseUrl: process.env.DATABASE_URL || "",
  driveClientSecretFile: process.env.GOOGLE_DRIVE_CLIENT_SECRET_FILE || "",
  driveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "",
};

for (const [key, value] of Object.entries({
  BROWSER_BRIDGE_AUTH_TOKEN: cfg.bridgeAuthToken,
  DATABASE_URL: cfg.databaseUrl,
})) {
  if (!String(value || "").trim()) throw new Error(`${key} is required`);
}

const unique = `verify-drive-${Date.now()}`;
const bytes = Buffer.from(`BrowserBridge verify upload ${new Date().toISOString()}\n`, "utf8");
const db = new Client({ connectionString: cfg.databaseUrl });
let driveFileId = "";

try {
  await db.connect();
  const created = await requestJSON("/v1/media/upload-sessions", {
    method: "POST",
    body: {
      filename: `${unique}.txt`,
      mime_type: "text/plain",
      total_size: bytes.byteLength,
      media_url: "https://example.test/verify.txt",
      platform: "verify",
      source_user_id: "verify-source-user",
      source_username: "verify-source",
      media_id: unique,
      post_id: `${unique}-post`,
      media_type: "text",
      preview_url: "",
      metadata: { verifier: "tools/verify_drive_upload_flow.mjs" },
    },
  });
  if (!created.id) throw new Error("upload session create response missing id");

  const uploaded = await requestJSON(`/v1/media/upload-sessions/${encodeURIComponent(created.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
    },
    body: bytes,
    rawBody: true,
  });
  if (uploaded.status !== "complete") throw new Error(`upload did not complete: ${JSON.stringify(uploaded)}`);
  driveFileId = uploaded.file?.id || "";
  if (!driveFileId) throw new Error("complete upload response missing file.id");

  const row = await db.query(
    `SELECT platform, source_user_id, media_id, drive_file_id, filename, mime_type, size_bytes, metadata
     FROM media_assets
     WHERE platform = $1 AND source_user_id = $2 AND media_id = $3`,
    ["verify", "verify-source-user", unique],
  );
  if (row.rowCount !== 1) throw new Error("media_assets row was not saved");
  const asset = row.rows[0];
  if (asset.drive_file_id !== driveFileId) throw new Error("drive_file_id does not match uploaded file");
  if (Number(asset.size_bytes) !== bytes.byteLength) throw new Error(`size_bytes mismatch: ${asset.size_bytes}`);

  console.log(JSON.stringify({
    ok: true,
    sessionId: created.id,
    driveFileId,
    db: {
      platform: asset.platform,
      sourceUserId: asset.source_user_id,
      mediaId: asset.media_id,
      filename: asset.filename,
      mimeType: asset.mime_type,
      sizeBytes: Number(asset.size_bytes),
    },
  }, null, 2));
} finally {
  await db.query("DELETE FROM media_assets WHERE platform = $1 AND source_user_id = $2 AND media_id = $3", ["verify", "verify-source-user", unique]).catch(() => undefined);
  await db.end().catch(() => undefined);
  if (driveFileId) await deleteDriveFile(driveFileId).catch((error) => {
    console.error(`warning: failed to delete Drive verify file ${driveFileId}: ${error.message || error}`);
  });
}

async function requestJSON(path, { method = "GET", headers = {}, body, rawBody = false } = {}) {
  const response = await fetch(`${cfg.bridgeHttpUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.bridgeAuthToken}`,
      ...(rawBody ? headers : { "Content-Type": "application/json", ...headers }),
    },
    body: rawBody ? body : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function deleteDriveFile(fileId) {
  const accessToken = await getDriveAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Drive delete failed: HTTP ${response.status} ${await response.text()}`);
  }
}

async function getDriveAccessToken() {
  if (!cfg.driveRefreshToken || !cfg.driveClientSecretFile) {
    throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN and GOOGLE_DRIVE_CLIENT_SECRET_FILE are required for cleanup");
  }
  const raw = JSON.parse(await readFile(cfg.driveClientSecretFile, "utf8"));
  const client = raw.installed || raw.web;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: cfg.driveRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`refresh token failed: HTTP ${response.status} ${await response.text()}`);
  const token = await response.json();
  if (!token.access_token) throw new Error("refresh response missing access token");
  return token.access_token;
}
