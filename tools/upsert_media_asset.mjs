import { createRequire } from "node:module";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");
const { Client } = requireFromBot("pg");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const required = ["platform", "sourceUserId", "mediaId", "driveLink", "filename", "mimeType"];
const missing = required.filter((key) => !String(args[key] || "").trim());
if (missing.length > 0) {
  console.log(JSON.stringify({
    ok: false,
    missing,
    usage: "node tools/upsert_media_asset.mjs --platform tiktok --source-user-id user1 --media-id media1 --drive-link https://... --filename image.jpg --mime-type image/jpeg",
  }, null, 2));
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await ensureMediaAssets(client);
  const { rows } = await client.query(
    `INSERT INTO media_assets (
       platform, source_user_id, source_username, media_id, post_id, source_url,
       drive_file_id, drive_link, filename, mime_type, size_bytes, media_type, preview_url, metadata, uploaded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (platform, source_user_id, media_id) DO UPDATE SET
       source_username = EXCLUDED.source_username,
       post_id = EXCLUDED.post_id,
       source_url = EXCLUDED.source_url,
       drive_file_id = EXCLUDED.drive_file_id,
       drive_link = EXCLUDED.drive_link,
       filename = EXCLUDED.filename,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       media_type = EXCLUDED.media_type,
       preview_url = EXCLUDED.preview_url,
       metadata = media_assets.metadata || EXCLUDED.metadata,
       archived_at = NULL,
       archive_reason = '',
       updated_at = now()
     RETURNING id, platform, source_user_id, source_username, media_id, drive_link, filename, mime_type`,
    [
      args.platform,
      args.sourceUserId,
      args.sourceUsername || "",
      args.mediaId,
      args.postId || "",
      args.sourceUrl || "",
      args.driveFileId || `manual-${args.platform}-${args.sourceUserId}-${args.mediaId}`,
      args.driveLink,
      args.filename,
      args.mimeType,
      Number.parseInt(args.sizeBytes || "0", 10) || 0,
      args.mediaType || inferMediaType(args.mimeType),
      args.previewUrl || args.driveLink,
      JSON.stringify({ seeded_by: "tools/upsert_media_asset.mjs", seeded_at: new Date().toISOString() }),
    ],
  );
  console.log(JSON.stringify({ ok: true, media: rows[0] }, null, 2));
} finally {
  await client.end();
}

async function ensureMediaAssets(client) {
  await client.query(`
CREATE TABLE IF NOT EXISTS media_assets (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  source_username TEXT NOT NULL DEFAULT '',
  media_id TEXT NOT NULL,
  post_id TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL,
  drive_link TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  media_type TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  archive_reason TEXT NOT NULL DEFAULT '',
  last_posted_at TIMESTAMPTZ,
  post_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_user_id, media_id)
)`);
}

function parseArgs(argv) {
  const result = {};
  const mapping = {
    "--platform": "platform",
    "--source-user-id": "sourceUserId",
    "--source-username": "sourceUsername",
    "--media-id": "mediaId",
    "--post-id": "postId",
    "--source-url": "sourceUrl",
    "--drive-file-id": "driveFileId",
    "--drive-link": "driveLink",
    "--filename": "filename",
    "--mime-type": "mimeType",
    "--size-bytes": "sizeBytes",
    "--media-type": "mediaType",
    "--preview-url": "previewUrl",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]];
    if (!key) continue;
    result[key] = argv[index + 1] || "";
    index += 1;
  }
  return result;
}

function inferMediaType(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "";
}
