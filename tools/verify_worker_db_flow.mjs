import { createRequire } from "node:module";
import { runTick } from "../bot/src/media-worker-core.js";
import { MediaStore } from "../bot/src/store.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const unique = `verify-worker-${Date.now()}`;
const store = new MediaStore(databaseUrl);
const uploads = [];

try {
  await store.migrate();
  const userId = await seedSocialUser(store, unique);
  await seedExistingMedia(store, unique);
  const firstClaim = await store.nextSocialUsersForScrape({
    platform: "tiktok",
    cooldownSeconds: 1,
    claimTTLSeconds: 60,
    limit: 1,
  });
  if (firstClaim.length !== 1 || firstClaim[0].id !== userId || !firstClaim[0].scrape_claim_id) {
    throw new Error(`first social user claim failed: ${JSON.stringify(firstClaim)}`);
  }
  const duplicateClaim = await store.nextSocialUsersForScrape({
    platform: "tiktok",
    cooldownSeconds: 1,
    claimTTLSeconds: 60,
    limit: 1,
  });
  if (duplicateClaim.length !== 0) throw new Error(`duplicate social user claim should be empty: ${JSON.stringify(duplicateClaim)}`);
  await store.releaseSocialUserScrapeClaim({ id: userId, claimId: firstClaim[0].scrape_claim_id });

  const bridge = {
    async openTab(url, options) {
      if (url !== `https://www.tiktok.com/@${unique}`) throw new Error(`unexpected profile URL ${url}`);
      if (options?.active !== false) throw new Error("worker should open tab inactive");
      return { id: 987 };
    },
    async evaluate(payload) {
      if (payload.tabId !== 987) throw new Error(`unexpected tab id ${payload.tabId}`);
      if (payload.world !== "MAIN") throw new Error(`unexpected world ${payload.world}`);
      return {
        url: `https://www.tiktok.com/@${unique}`,
        title: unique,
        media: [
          {
            media_id: `${unique}-existing`,
            post_id: `${unique}-existing-post`,
            media_url: "https://cdn.example/existing-worker.jpg",
            media_type: "image",
            mime_type: "image/jpeg",
            preview_url: "https://cdn.example/existing-worker-preview.jpg",
            source: "verify",
            metadata: { rank: 0 },
          },
          {
            media_id: `${unique}-media`,
            post_id: `${unique}-post`,
            media_url: "https://cdn.example/verify-worker.jpg",
            media_type: "image",
            mime_type: "image/jpeg",
            preview_url: "https://cdn.example/verify-worker-preview.jpg",
            source: "verify",
            metadata: { rank: 1 },
          },
        ],
      };
    },
    async uploadMedia(payload) {
      uploads.push(payload);
      return { status: "complete" };
    },
  };

  const summary = await runTick({
    cfg: {
      platform: "tiktok",
      userCooldownSeconds: 1,
      userClaimTTLSeconds: 60,
      maxUsersPerTick: 1,
      maxMediaPerUser: 5,
      pageLoadWaitMs: 1,
    },
    store,
    bridge,
    log: silentLog(),
  });

  if (summary.users !== 1 || summary.uploaded !== 1 || summary.failed !== 0 || summary.skippedExisting !== 1) {
    throw new Error(`unexpected worker summary ${JSON.stringify(summary)}`);
  }
  if (uploads.length !== 1) throw new Error(`expected 1 upload, got ${uploads.length}`);
  const upload = uploads[0];
  if (upload.platform !== "tiktok" || upload.source_user_id !== unique || upload.media_id !== `${unique}-media`) {
    throw new Error(`unexpected upload payload ${JSON.stringify(upload)}`);
  }
  assertUploadContract(upload, unique);

  const { rows } = await store.pool.query("SELECT last_scraped_at, metadata, scrape_claim_id FROM social_users WHERE id = $1", [userId]);
  const row = rows[0];
  if (!row?.last_scraped_at) throw new Error("last_scraped_at was not updated");
  if (row.scrape_claim_id !== "") throw new Error(`scrape claim was not cleared: ${row.scrape_claim_id}`);
  if (
    row.metadata.last_media_scrape_count !== 2 ||
    row.metadata.last_media_upload_count !== 1 ||
    row.metadata.last_media_upload_failed_count !== 0 ||
    row.metadata.last_media_upload_skipped_existing_count !== 1
  ) {
    throw new Error(`unexpected scrape metadata ${JSON.stringify(row.metadata)}`);
  }
  const mezonMirror = await store.pool.query("SELECT count(*)::int AS count FROM mezon_users WHERE mezon_user_id = $1", [unique]);
  if ((mezonMirror.rows[0]?.count || 0) !== 0) {
    throw new Error("social user was unexpectedly mirrored into mezon_users");
  }

  console.log(JSON.stringify({
    ok: true,
    userId,
    summary,
    upload: {
      tabId: upload.tab_id,
      filename: upload.filename,
      mimeType: upload.mime_type,
      mediaId: upload.media_id,
      sourceUserId: upload.source_user_id,
      sourceUsername: upload.source_username,
      postId: upload.post_id,
      mediaType: upload.media_type,
      previewUrl: upload.preview_url,
      metadata: upload.metadata,
    },
    skipExisting: {
      mediaId: `${unique}-existing`,
      skippedCount: summary.skippedExisting,
      metadataSkippedCount: row.metadata.last_media_upload_skipped_existing_count,
    },
    socialClaim: {
      firstClaimId: firstClaim[0].scrape_claim_id,
      duplicateClaimCount: duplicateClaim.length,
      clearedAfterScrape: row.scrape_claim_id === "",
    },
    identitySeparation: {
      socialUserId: unique,
      mezonRowsForSocialUser: mezonMirror.rows[0]?.count || 0,
      mezonUsersTable: "mezon_users",
      socialUsersTable: "social_users",
    },
  }, null, 2));
} finally {
  await store.pool.query("DELETE FROM media_assets WHERE platform = $1 AND source_user_id = $2", ["tiktok", unique]).catch(() => undefined);
  await store.pool.query("DELETE FROM social_users WHERE platform = $1 AND source_user_id = $2", ["tiktok", unique]).catch(() => undefined);
  await store.close();
}

async function seedSocialUser(store, unique) {
  const { rows } = await store.pool.query(
    `INSERT INTO social_users (platform, source_user_id, username, display_name, profile_url, metadata, last_scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     RETURNING id`,
    [
      "tiktok",
      unique,
      unique,
      "Verify Worker",
      `https://www.tiktok.com/@${unique}`,
      JSON.stringify({ verifier: "tools/verify_worker_db_flow.mjs" }),
    ],
  );
  return rows[0].id;
}

async function seedExistingMedia(store, unique) {
  await store.pool.query(
    `INSERT INTO media_assets (
       platform, source_user_id, source_username, media_id, post_id, source_url,
       drive_file_id, drive_link, filename, mime_type, size_bytes, media_type, preview_url, metadata, uploaded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (platform, source_user_id, media_id) DO UPDATE SET updated_at = now()`,
    [
      "tiktok",
      unique,
      unique,
      `${unique}-existing`,
      `${unique}-existing-post`,
      `https://www.tiktok.com/@${unique}/video/existing`,
      `drive-existing-${unique}`,
      "https://drive.example/existing",
      `${unique}-existing.jpg`,
      "image/jpeg",
      123,
      "image",
      "https://cdn.example/existing-worker-preview.jpg",
      JSON.stringify({ verifier: "tools/verify_worker_db_flow.mjs", existing: true }),
    ],
  );
}

function silentLog() {
  return {
    log() {},
    error() {},
  };
}

function assertUploadContract(upload, unique) {
  const expected = {
    tab_id: 987,
    media_url: "https://cdn.example/verify-worker.jpg",
    mime_type: "image/jpeg",
    platform: "tiktok",
    source_user_id: unique,
    source_username: unique,
    media_id: `${unique}-media`,
    post_id: `${unique}-post`,
    media_type: "image",
    preview_url: "https://cdn.example/verify-worker-preview.jpg",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (upload[key] !== value) {
      throw new Error(`upload ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(upload[key])}`);
    }
  }
  if (!upload.filename || !upload.filename.endsWith(`${unique}-media.jpg`)) {
    throw new Error(`upload filename did not preserve media id and extension: ${upload.filename}`);
  }
  const metadata = upload.metadata || {};
  const metadataExpected = {
    extractor: "bot/src/tiktok-extractor.js",
    extractor_name: "tiktok",
    page_url: `https://www.tiktok.com/@${unique}`,
    source: "verify",
    title: unique,
    rank: 1,
  };
  for (const [key, value] of Object.entries(metadataExpected)) {
    if (metadata[key] !== value) {
      throw new Error(`upload metadata ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(metadata[key])}`);
    }
  }
}
