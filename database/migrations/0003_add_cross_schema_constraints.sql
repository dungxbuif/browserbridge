-- 0003: cross-schema constraints, checks, indexes and sequence alignment.
-- Idempotent: every constraint/index uses IF NOT EXISTS guards so this file can
-- be safely re-run by later verify passes.

-- Platform value checks.
ALTER TABLE gateway.social_users DROP CONSTRAINT IF EXISTS social_users_platform_check;
ALTER TABLE gateway.social_users
  ADD CONSTRAINT social_users_platform_check
  CHECK (platform IN ('tiktok', 'instagram', 'facebook'));

ALTER TABLE gateway.media_assets DROP CONSTRAINT IF EXISTS media_assets_platform_check;
ALTER TABLE gateway.media_assets
  ADD CONSTRAINT media_assets_platform_check
  CHECK (platform IN ('tiktok', 'instagram', 'facebook'));

ALTER TABLE gateway.media_assets DROP CONSTRAINT IF EXISTS media_assets_media_type_check;
ALTER TABLE gateway.media_assets
  ADD CONSTRAINT media_assets_media_type_check
  CHECK (media_type IN ('image', 'video', 'unknown'));

ALTER TABLE gateway.media_assets DROP CONSTRAINT IF EXISTS media_assets_post_type_check;
ALTER TABLE gateway.media_assets
  ADD CONSTRAINT media_assets_post_type_check
  CHECK (post_type IN ('single', 'carousel', 'unknown'));

-- Unique business keys (legacy constraints must already hold for backfill to pass;
-- guarded so re-running verify does not fail on duplicates introduced later).
CREATE UNIQUE INDEX IF NOT EXISTS social_users_business_key_idx
  ON gateway.social_users (platform, source_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_business_key_idx
  ON gateway.media_assets (platform, source_user_id, media_id);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_drive_file_idx
  ON gateway.media_assets (drive_file_id);

-- Delivery state must have exactly one row per asset, owned by the gateway asset.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_delivery_state_asset_fk'
  ) THEN
    ALTER TABLE bot.media_delivery_state
      ADD CONSTRAINT media_delivery_state_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES gateway.media_assets (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_reactions_asset_fk'
  ) THEN
    ALTER TABLE bot.media_reactions
      ADD CONSTRAINT media_reactions_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES gateway.media_assets (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_reactions_mezon_fk'
  ) THEN
    ALTER TABLE bot.media_reactions
      ADD CONSTRAINT media_reactions_mezon_fk
      FOREIGN KEY (mezon_user_id) REFERENCES bot.mezon_users (mezon_user_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_archives_asset_fk'
  ) THEN
    ALTER TABLE bot.media_archives
      ADD CONSTRAINT media_archives_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES gateway.media_assets (id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_archives_admin_fk'
  ) THEN
    ALTER TABLE bot.media_archives
      ADD CONSTRAINT media_archives_admin_fk
      FOREIGN KEY (archived_by_mezon_user_id) REFERENCES bot.mezon_users (mezon_user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_posts_asset_fk'
  ) THEN
    ALTER TABLE bot.media_posts
      ADD CONSTRAINT media_posts_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES gateway.media_assets (id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS media_posts_unique_idx
  ON bot.media_posts (channel_id, message_id);

-- Query indexes.
CREATE INDEX IF NOT EXISTS social_users_due_idx
  ON gateway.social_users (platform, next_scrape_at, last_scraped_at, updated_at);
CREATE INDEX IF NOT EXISTS social_users_username_lower_idx
  ON gateway.social_users (platform, lower(username));
CREATE INDEX IF NOT EXISTS media_assets_source_idx
  ON gateway.media_assets (platform, source_user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_post_position_idx
  ON gateway.media_assets (post_id, position) WHERE post_id <> '';
CREATE INDEX IF NOT EXISTS delivery_queue_idx
  ON bot.media_delivery_state (archived_at, posting_claim_expires_at, last_posted_at, media_asset_id);
CREATE INDEX IF NOT EXISTS event_dedup_expires_idx
  ON bot.event_dedup (expires_at);

-- Align sequences so future inserts preserve the natural max(id)+1 ordering.
SELECT setval(pg_get_serial_sequence('gateway.social_users', 'id'),
              COALESCE((SELECT max(id) FROM gateway.social_users), 1), true);
SELECT setval(pg_get_serial_sequence('gateway.media_assets', 'id'),
              COALESCE((SELECT max(id) FROM gateway.media_assets), 1), true);
SELECT setval(pg_get_serial_sequence('bot.media_archives', 'id'),
              COALESCE((SELECT max(id) FROM bot.media_archives), 1), true);
SELECT setval(pg_get_serial_sequence('bot.media_posts', 'id'),
              COALESCE((SELECT max(id) FROM bot.media_posts), 1), true);