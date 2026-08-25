-- 0002: backfill legacy public tables into gateway/bot.
-- Runs inside one transaction. All legacy tables are empty in the confirmed
-- development environment, so this is a no-op there, but the exact mapping is
-- written and executed so migrate-legacy seeding can prove the invariants.
--
-- Hard precondition (owner decision): public.media_assets must be empty. A
-- non-empty result aborts with LEGACY_MEDIA_RECONCILIATION_REQUIRED before any
-- cutover, because there is no verified drive_folder_id to assign.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_assets'
  ) THEN
    IF (SELECT count(*) FROM public.media_assets) > 0 THEN
      RAISE EXCEPTION 'LEGACY_MEDIA_RECONCILIATION_REQUIRED: public.media_assets is not empty';
    END IF;
  END IF;
END $$;

INSERT INTO gateway.social_users (
  id, platform, source_user_id, username, display_name, profile_url, avatar_url, metadata,
  last_collected_at, last_scraped_at, next_scrape_at,
  consecutive_failure_count, last_error_code, last_error_summary, created_at, updated_at
)
SELECT
  id, platform, source_user_id, username, display_name, profile_url, avatar_url, metadata,
  NULL, last_scraped_at, NULL,
  0, '', '', created_at, updated_at
FROM public.social_users
ON CONFLICT (id) DO NOTHING;

INSERT INTO gateway.media_assets (
  id, platform, source_user_id, source_username, media_id, post_id, page_url, source_url,
  media_type, post_type, position, preview_url, drive_file_id, drive_folder_id, drive_link,
  filename, mime_type, size_bytes, checksum_sha256, metadata, uploaded_at, created_at, updated_at
)
SELECT
  id, platform, source_user_id, source_username, media_id, post_id, '', source_url,
  CASE WHEN media_type IN ('image','video','unknown') THEN media_type ELSE 'unknown' END,
  'unknown', 0, preview_url, drive_file_id, '', drive_link,
  filename, mime_type, size_bytes, '', metadata, uploaded_at, created_at, updated_at
FROM public.media_assets
ON CONFLICT (id) DO NOTHING;

INSERT INTO bot.mezon_users (
  mezon_user_id, username, display_name, first_seen_at, last_seen_at, created_at, updated_at
)
SELECT mezon_user_id, username, display_name, first_seen_at, last_seen_at, created_at, updated_at
FROM public.mezon_users
ON CONFLICT (mezon_user_id) DO NOTHING;

INSERT INTO bot.media_delivery_state (
  media_asset_id, archived_at, archive_reason, last_posted_at, post_count,
  posting_claim_token, posting_claimed_by, posting_claim_expires_at
)
SELECT
  id, archived_at, archive_reason, last_posted_at, post_count,
  NULL, '', posting_claimed_at
FROM public.media_assets;

INSERT INTO bot.media_reactions (
  media_asset_id, mezon_user_id, reaction, message_id, channel_id, created_at, updated_at
)
SELECT media_asset_id, mezon_user_id, reaction, message_id, channel_id, created_at, updated_at
FROM public.media_reactions;

INSERT INTO bot.media_archives (
  id, media_asset_id, archived_by_mezon_user_id, reason, message_id, channel_id, created_at
)
SELECT id, media_asset_id, archived_by_mezon_user_id, reason, message_id, channel_id, created_at
FROM public.media_archives;

INSERT INTO bot.media_posts (
  id, media_asset_id, channel_id, message_id, posted_by, created_at
)
SELECT id, media_asset_id, channel_id, message_id, posted_by, created_at
FROM public.bot_media_posts;

INSERT INTO bot.event_dedup (
  event_id, event_type, expires_at, created_at
)
SELECT event_id, event_type, expires_at, created_at
FROM public.bot_event_dedup;