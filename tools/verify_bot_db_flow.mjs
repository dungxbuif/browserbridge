import { createRequire } from "node:module";
import { handleButtonClick, sendNextMedia } from "../bot/src/bot-core.js";
import { MediaStore } from "../bot/src/store.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");

const cfg = {
  channelId: process.env.MEZON_CHANNEL_ID || "verify-channel",
  adminUserId: process.env.MEZON_ADMIN_USER_ID || "verify-admin",
};
const unique = `verify-${Date.now()}`;
const store = new MediaStore(databaseUrl);
await store.migrate();

const sentMessages = [];
let mediaAssetId = 0;
let nextMediaAssetId = 0;

try {
  mediaAssetId = await seedMedia(store, unique);
  await store.upsertMezonUser({ id: "verify-user", username: "verify-user", displayName: "Verify User" });
  await store.upsertMezonUser({ id: "verify-dislike-user", username: "verify-dislike-user", displayName: "Verify Dislike User" });
  await store.upsertMezonUser({ id: cfg.adminUserId, username: "verify-admin", displayName: "Verify Admin" });

  const firstAcquire = await store.tryAcquireEvent({ eventId: `${unique}-event`, eventType: "verify", ttlSeconds: 60 });
  const secondAcquire = await store.tryAcquireEvent({ eventId: `${unique}-event`, eventType: "verify", ttlSeconds: 60 });
  assertEqual(firstAcquire, true, "dedup first acquire");
  assertEqual(secondAcquire, false, "dedup duplicate acquire");

  const firstMediaClaim = await store.nextMedia({ claimTTLSeconds: 60 });
  if (!firstMediaClaim || firstMediaClaim.id !== mediaAssetId || !firstMediaClaim.posting_claim_id) {
    throw new Error(`first media claim failed: ${JSON.stringify(firstMediaClaim)}`);
  }
  const duplicateMediaClaim = await store.nextMedia({ claimTTLSeconds: 60 });
  assertEqual(duplicateMediaClaim, null, "duplicate media claim");
  await store.releaseMediaClaim({ mediaAssetId, claimId: firstMediaClaim.posting_claim_id });
  nextMediaAssetId = await seedMedia(store, `${unique}-next`);

  const sendResult = await sendNextMedia({
    cfg,
    store,
    postedBy: "verify",
    async sendMessage(channelId, content) {
      sentMessages.push({ channelId, content });
      return { id: `${unique}-message` };
    },
  });

  if (!sendResult.sent || sendResult.mediaAssetId !== mediaAssetId) {
    throw new Error(`sendNextMedia returned unexpected result: ${JSON.stringify(sendResult)}`);
  }
  const mediaCard = sentMessages[0]?.content;
  assertMediaCard(mediaCard, mediaAssetId);

  await handleButtonClick({
    event: { button_id: `bb:like:${mediaAssetId}`, sender_id: "verify-user", channel_id: cfg.channelId, message_id: `${unique}-message` },
    cfg,
    store,
    async sendText(channelId, text) {
      sentMessages.push({ channelId, content: { t: text } });
    },
  });

  await handleButtonClick({
    event: { button_id: `bb:dislike:${mediaAssetId}`, sender_id: "verify-dislike-user", channel_id: cfg.channelId, message_id: `${unique}-message` },
    cfg,
    store,
    async sendText(channelId, text) {
      sentMessages.push({ channelId, content: { t: text } });
    },
  });

  const denied = await handleButtonClick({
    event: { button_id: `bb:delete:${mediaAssetId}`, sender_id: "verify-user", channel_id: cfg.channelId, message_id: `${unique}-message` },
    cfg,
    store,
    async sendText(channelId, text) {
      sentMessages.push({ channelId, content: { t: text } });
    },
  });
  if (denied.action !== "archive_denied") throw new Error("non-admin archive was not denied");

  const archived = await handleButtonClick({
    event: { button_id: `bb:delete:${mediaAssetId}`, sender_id: cfg.adminUserId, channel_id: cfg.channelId, message_id: `${unique}-message` },
    cfg,
    store,
    async sendText(channelId, text) {
      sentMessages.push({ channelId, content: { t: text } });
    },
  });
  if (archived.action !== "archive") throw new Error("admin archive was not recorded");

  const staleReaction = await handleButtonClick({
    event: { button_id: `bb:like:${mediaAssetId}`, sender_id: "verify-user", channel_id: cfg.channelId, message_id: `${unique}-message` },
    cfg,
    store,
    async sendText(channelId, text) {
      sentMessages.push({ channelId, content: { t: text } });
    },
  });
  if (staleReaction.action !== "media_unavailable") throw new Error("stale post-archive reaction was not handled cleanly");

  const nextSendResult = await sendNextMedia({
    cfg,
    store,
    postedBy: "verify-next",
    async sendMessage(channelId, content) {
      sentMessages.push({ channelId, content });
      return { id: `${unique}-next-message` };
    },
  });
  if (!nextSendResult.sent || nextSendResult.mediaAssetId !== nextMediaAssetId) {
    throw new Error(`sendNextMedia did not skip archived media and send the next asset: ${JSON.stringify(nextSendResult)}`);
  }
  const nextMediaCard = sentMessages.at(-1)?.content;
  assertMediaCard(nextMediaCard, nextMediaAssetId);

  const checks = await readChecks(store, mediaAssetId, cfg);
  const nextChecks = await readChecks(store, nextMediaAssetId, cfg);
  assertEqual(checks.postCount, 1, "post count");
  assertEqual(nextChecks.postCount, 1, "next media post count");
  assertEqual(nextChecks.archivedAt, null, "next media remains unarchived");
  assertEqual(checks.reaction, "like", "reaction");
  assertEqual(checks.likeCount, 1, "like count");
  assertEqual(checks.dislikeCount, 1, "dislike count");
  assertEqual(checks.archiveCount, 1, "archive count");
  assertEqual(Boolean(checks.archivedAt), true, "archived_at");
  assertEqual(checks.postingClaimId, "", "posting claim cleared");
  assertEqual(checks.socialRowsForMezonUsers, 0, "Mezon users must not be mirrored into social_users");

  console.log(JSON.stringify({
    ok: true,
    mediaAssetId,
    sentMessages: sentMessages.length,
    mediaCard: {
      buttonIds: mediaCard.components.map((item) => item.id),
      buttonLabels: mediaCard.components.map((item) => item.component?.label || ""),
    },
    checks,
    nextMedia: {
      mediaAssetId: nextMediaAssetId,
      messageId: nextSendResult.messageId,
      buttonIds: nextMediaCard.components.map((item) => item.id),
      postCount: nextChecks.postCount,
      archivedAt: nextChecks.archivedAt,
    },
    staleReaction: staleReaction.action,
    dedup: {
      firstAcquire,
      secondAcquire,
    },
    mediaClaim: {
      firstClaimId: firstMediaClaim.posting_claim_id,
      duplicateClaim: duplicateMediaClaim,
      clearedAfterPost: checks.postingClaimId === "",
    },
    identitySeparation: {
      socialRowsForMezonUsers: checks.socialRowsForMezonUsers,
      mezonUsersTable: "mezon_users",
      socialUsersTable: "social_users",
    },
  }, null, 2));
} finally {
  await cleanup(store, [mediaAssetId, nextMediaAssetId].filter(Boolean));
  await store.close();
}

async function seedMedia(store, unique) {
  const { rows } = await store.pool.query(
    `INSERT INTO media_assets (
       platform, source_user_id, source_username, media_id, post_id, source_url,
       drive_file_id, drive_link, filename, mime_type, size_bytes, media_type, preview_url, metadata, uploaded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     RETURNING id`,
    [
      "verify",
      "verify-source-user",
      "verify-source",
      unique,
      `${unique}-post`,
      "https://example.test/source",
      `${unique}-drive-file`,
      "https://drive.google.com/file/d/verify",
      `${unique}.jpg`,
      "image/jpeg",
      123,
      "image",
      "https://example.test/preview.jpg",
      JSON.stringify({ verifier: "tools/verify_bot_db_flow.mjs" }),
    ],
  );
  return rows[0].id;
}

async function readChecks(store, mediaAssetId, cfg) {
  const post = await store.pool.query("SELECT post_count, archived_at, posting_claim_id FROM media_assets WHERE id = $1", [mediaAssetId]);
  const reaction = await store.pool.query("SELECT reaction FROM media_reactions WHERE media_asset_id = $1 AND mezon_user_id = $2", [mediaAssetId, "verify-user"]);
  const reactionCounts = await store.pool.query(
    `SELECT
       count(*) FILTER (WHERE reaction = 'like')::int AS likes,
       count(*) FILTER (WHERE reaction = 'dislike')::int AS dislikes
     FROM media_reactions
     WHERE media_asset_id = $1`,
    [mediaAssetId],
  );
  const archive = await store.pool.query("SELECT count(*)::int AS count FROM media_archives WHERE media_asset_id = $1 AND archived_by_mezon_user_id = $2", [mediaAssetId, cfg.adminUserId]);
  const socialRowsForMezonUsers = await store.pool.query(
    `SELECT count(*)::int AS count
     FROM social_users
     WHERE source_user_id = ANY($1::text[])`,
    [["verify-user", "verify-dislike-user", cfg.adminUserId]],
  );
  return {
    postCount: post.rows[0]?.post_count,
    archivedAt: post.rows[0]?.archived_at || null,
    reaction: reaction.rows[0]?.reaction || "",
    likeCount: reactionCounts.rows[0]?.likes || 0,
    dislikeCount: reactionCounts.rows[0]?.dislikes || 0,
    archiveCount: archive.rows[0]?.count || 0,
    postingClaimId: post.rows[0]?.posting_claim_id || "",
    socialRowsForMezonUsers: socialRowsForMezonUsers.rows[0]?.count || 0,
  };
}

async function cleanup(store, mediaAssetIds) {
  if (mediaAssetIds.length > 0) {
    await store.pool.query("DELETE FROM media_assets WHERE id = ANY($1::bigint[])", [mediaAssetIds]);
  }
  await store.pool.query("DELETE FROM mezon_users WHERE mezon_user_id IN ($1, $2, $3)", ["verify-user", "verify-dislike-user", process.env.MEZON_ADMIN_USER_ID || "verify-admin"]);
  await store.pool.query("DELETE FROM bot_event_dedup WHERE event_type = $1", ["verify"]);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertMediaCard(card, mediaAssetId) {
  if (!card || !Array.isArray(card.components)) {
    throw new Error(`media card missing components: ${JSON.stringify(card)}`);
  }
  const ids = card.components.map((item) => item.id);
  const labels = card.components.map((item) => item.component?.label || "");
  assertEqual(ids.length, 3, "media card button count");
  assertEqual(ids[0], `bb:like:${mediaAssetId}`, "like button id");
  assertEqual(ids[1], `bb:dislike:${mediaAssetId}`, "dislike button id");
  assertEqual(ids[2], `bb:delete:${mediaAssetId}`, "delete button id");
  assertEqual(labels[0], "Like", "like button label");
  assertEqual(labels[1], "Che", "dislike button label");
  assertEqual(labels[2], "Delete (admin)", "delete button label");
}
