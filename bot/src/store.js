import { randomUUID } from "node:crypto";
import pg from "pg";

export class MediaStore {
  constructor(databaseUrl) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async close() {
    await this.pool.end();
  }

  async migrate() {
    await this.pool.query(`
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
  posting_claim_id TEXT NOT NULL DEFAULT '',
  posting_claimed_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_user_id, media_id)
);

CREATE TABLE IF NOT EXISTS social_users (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_scraped_at TIMESTAMPTZ,
  scrape_claim_id TEXT NOT NULL DEFAULT '',
  scrape_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, source_user_id)
);

CREATE TABLE IF NOT EXISTS mezon_users (
  mezon_user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_reactions (
  media_asset_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  mezon_user_id TEXT NOT NULL REFERENCES mezon_users(mezon_user_id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  message_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (media_asset_id, mezon_user_id)
);

CREATE TABLE IF NOT EXISTS media_archives (
  id BIGSERIAL PRIMARY KEY,
  media_asset_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  archived_by_mezon_user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_media_posts (
  id BIGSERIAL PRIMARY KEY,
  media_asset_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  posted_by TEXT NOT NULL DEFAULT 'scheduler',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_event_dedup (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS preview_url TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS archive_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS last_posted_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS post_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS posting_claim_id TEXT NOT NULL DEFAULT '';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS posting_claimed_at TIMESTAMPTZ;
DROP INDEX IF EXISTS media_assets_post_queue_idx;
CREATE INDEX media_assets_post_queue_idx ON media_assets(archived_at, posting_claimed_at, last_posted_at, uploaded_at);
ALTER TABLE social_users ADD COLUMN IF NOT EXISTS scrape_claim_id TEXT NOT NULL DEFAULT '';
ALTER TABLE social_users ADD COLUMN IF NOT EXISTS scrape_claimed_at TIMESTAMPTZ;
DROP INDEX IF EXISTS social_users_scrape_queue_idx;
CREATE INDEX social_users_scrape_queue_idx ON social_users(platform, scrape_claimed_at, last_scraped_at, updated_at);
CREATE INDEX IF NOT EXISTS bot_event_dedup_expires_idx ON bot_event_dedup(expires_at);
`);
  }

  async upsertMezonUser({ id, username = "", displayName = "" }) {
    if (!id) return;
    await this.pool.query(
      `INSERT INTO mezon_users (mezon_user_id, username, display_name, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now(), now(), now())
       ON CONFLICT (mezon_user_id) DO UPDATE SET
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name,
         last_seen_at = now(),
         updated_at = now()`,
      [id, username, displayName],
    );
  }

  async tryAcquireEvent({ eventId, eventType = "", ttlSeconds = 86400 }) {
    if (!eventId) return true;
    const ttl = Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 86400;
    await this.pool.query("DELETE FROM bot_event_dedup WHERE expires_at < now()");
    const { rowCount } = await this.pool.query(
      `INSERT INTO bot_event_dedup (event_id, event_type, expires_at)
       VALUES ($1, $2, now() + ($3::text || ' seconds')::interval)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, eventType, ttl],
    );
    return rowCount === 1;
  }

  async nextMedia({ claimTTLSeconds = 300 } = {}) {
    const ttl = Number.isInteger(claimTTLSeconds) && claimTTLSeconds > 0 ? claimTTLSeconds : 300;
    const claimId = randomUUID();
    const { rows } = await this.pool.query(
      `WITH candidate AS (
         SELECT id
         FROM media_assets
         WHERE archived_at IS NULL
           AND (
             posting_claim_id = ''
             OR posting_claimed_at IS NULL
             OR posting_claimed_at < now() - ($1::text || ' seconds')::interval
           )
         ORDER BY COALESCE(last_posted_at, TIMESTAMPTZ 'epoch') ASC, uploaded_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE media_assets AS m
       SET posting_claim_id = $2,
           posting_claimed_at = now(),
           updated_at = now()
       FROM candidate
       WHERE m.id = candidate.id
       RETURNING m.id, platform, source_user_id, source_username, media_id, post_id, drive_file_id,
              drive_link, filename, mime_type, size_bytes, metadata, media_type, preview_url,
              uploaded_at, last_posted_at, post_count, posting_claim_id`,
      [ttl, claimId],
    );
    return rows[0] || null;
  }

  async recordPost({ mediaAssetId, channelId, messageId, postedBy, claimId = "" }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const update = await client.query(
        `UPDATE media_assets
         SET last_posted_at = now(),
             post_count = post_count + 1,
             posting_claim_id = '',
             posting_claimed_at = NULL,
             updated_at = now()
         WHERE id = $1
           AND ($2 = '' OR posting_claim_id = $2)`,
        [mediaAssetId, claimId || ""],
      );
      if (update.rowCount !== 1) {
        throw new Error("media claim is no longer active");
      }
      await client.query(
        `INSERT INTO bot_media_posts (media_asset_id, channel_id, message_id, posted_by)
         VALUES ($1, $2, $3, $4)`,
        [mediaAssetId, channelId, messageId, postedBy],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseMediaClaim({ mediaAssetId, claimId }) {
    if (!mediaAssetId || !claimId) return;
    await this.pool.query(
      `UPDATE media_assets
       SET posting_claim_id = '',
           posting_claimed_at = NULL,
           updated_at = now()
       WHERE id = $1 AND posting_claim_id = $2`,
      [mediaAssetId, claimId],
    );
  }

  async mediaAssetExists({ platform, sourceUserId, mediaId }) {
    if (!platform || !sourceUserId || !mediaId) return false;
    const { rowCount } = await this.pool.query(
      `SELECT 1
       FROM media_assets
       WHERE platform = $1 AND source_user_id = $2 AND media_id = $3
       LIMIT 1`,
      [platform, sourceUserId, mediaId],
    );
    return rowCount > 0;
  }

  async setReaction({ mediaAssetId, mezonUserId, reaction, messageId, channelId }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const media = await client.query("SELECT id FROM media_assets WHERE id = $1 AND archived_at IS NULL", [mediaAssetId]);
      if (media.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO media_reactions (media_asset_id, mezon_user_id, reaction, message_id, channel_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (media_asset_id, mezon_user_id) DO UPDATE SET
           reaction = EXCLUDED.reaction,
           message_id = EXCLUDED.message_id,
           channel_id = EXCLUDED.channel_id,
           updated_at = now()`,
        [mediaAssetId, mezonUserId, reaction, messageId || "", channelId || ""],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async archive({ mediaAssetId, adminUserId, reason, messageId, channelId }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const archived = await client.query(
        `UPDATE media_assets
         SET archived_at = now(),
             archive_reason = $2,
             posting_claim_id = '',
             posting_claimed_at = NULL,
             updated_at = now()
         WHERE id = $1 AND archived_at IS NULL`,
        [mediaAssetId, reason || "admin_archive"],
      );
      if (archived.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO media_archives (media_asset_id, archived_by_mezon_user_id, reason, message_id, channel_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [mediaAssetId, adminUserId, reason || "admin_archive", messageId || "", channelId || ""],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async nextSocialUsersForScrape({ platform, cooldownSeconds, claimTTLSeconds = 900, limit }) {
    const ttl = Number.isInteger(claimTTLSeconds) && claimTTLSeconds > 0 ? claimTTLSeconds : 900;
    const claimId = randomUUID();
    const { rows } = await this.pool.query(
      `WITH candidates AS (
         SELECT id
         FROM social_users
         WHERE platform = $1
           AND (COALESCE(profile_url, '') <> '' OR COALESCE(username, '') <> '')
           AND (last_scraped_at IS NULL OR last_scraped_at < now() - ($2::text || ' seconds')::interval)
           AND (
             scrape_claim_id = ''
             OR scrape_claimed_at IS NULL
             OR scrape_claimed_at < now() - ($3::text || ' seconds')::interval
           )
         ORDER BY COALESCE(last_scraped_at, TIMESTAMPTZ 'epoch') ASC, updated_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
       )
       UPDATE social_users AS s
       SET scrape_claim_id = $5,
           scrape_claimed_at = now(),
           updated_at = now()
       FROM candidates
       WHERE s.id = candidates.id
       RETURNING s.id, platform, source_user_id, username, display_name, profile_url, avatar_url,
                 metadata, last_scraped_at, scrape_claim_id`,
      [platform, cooldownSeconds, ttl, limit, claimId],
    );
    return rows;
  }

  async markSocialUserScraped({ id, claimId = "", metadataPatch = {} }) {
    const { rows } = await this.pool.query(
      `SELECT metadata FROM social_users WHERE id = $1`,
      [id],
    );
    const current = rows[0]?.metadata && typeof rows[0].metadata === "object" ? rows[0].metadata : {};
    await this.pool.query(
      `UPDATE social_users
       SET metadata = $2::jsonb,
           last_scraped_at = now(),
           scrape_claim_id = '',
           scrape_claimed_at = NULL,
           updated_at = now()
       WHERE id = $1
         AND ($3 = '' OR scrape_claim_id = $3)`,
      [id, JSON.stringify({ ...current, ...metadataPatch }), claimId || ""],
    );
  }

  async releaseSocialUserScrapeClaim({ id, claimId }) {
    if (!id || !claimId) return;
    await this.pool.query(
      `UPDATE social_users
       SET scrape_claim_id = '',
           scrape_claimed_at = NULL,
           updated_at = now()
       WHERE id = $1 AND scrape_claim_id = $2`,
      [id, claimId],
    );
  }
}
