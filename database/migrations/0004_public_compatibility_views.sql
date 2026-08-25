-- 0004: rename legacy tables to _legacy_20260823 and create read-only
-- compatibility views at the old public names. No runtime PHASE-004 write targets
-- public. Legacy tables stay for the documented rollback window (>= 7 days and
-- one successful live UAT) and are removed by a separate destructive ticket.

-- Rename legacy tables (cascade not used; plain rename so old data is preserved).
ALTER TABLE IF EXISTS public.social_users       RENAME TO social_users_legacy_20260823;
ALTER TABLE IF EXISTS public.media_assets       RENAME TO media_assets_legacy_20260823;
ALTER TABLE IF EXISTS public.mezon_users        RENAME TO mezon_users_legacy_20260823;
ALTER TABLE IF EXISTS public.media_reactions    RENAME TO media_reactions_legacy_20260823;
ALTER TABLE IF EXISTS public.media_archives     RENAME TO media_archives_legacy_20260823;
ALTER TABLE IF EXISTS public.bot_media_posts    RENAME TO bot_media_posts_legacy_20260823;
ALTER TABLE IF EXISTS public.bot_event_dedup    RENAME TO bot_event_dedup_legacy_20260823;

-- Drop any previously created views with these names to allow re-run.
DROP VIEW IF EXISTS public.social_users;
DROP VIEW IF EXISTS public.media_assets;
DROP VIEW IF EXISTS public.mezon_users;
DROP VIEW IF EXISTS public.media_reactions;
DROP VIEW IF EXISTS public.media_archives;
DROP VIEW IF EXISTS public.bot_media_posts;
DROP VIEW IF EXISTS public.bot_event_dedup;

CREATE VIEW public.social_users AS
  SELECT id, platform, source_user_id, username, display_name, profile_url, avatar_url,
         metadata, last_scraped_at, created_at, updated_at
  FROM gateway.social_users;

-- Old media_assets merged shape: gateway asset columns joined with the bot
-- delivery/archive/claim columns so legacy read-only clients keep their shape.
CREATE VIEW public.media_assets AS
  SELECT m.id, m.platform, m.source_user_id, m.source_username, m.media_id, m.post_id,
         m.source_url, m.drive_file_id, m.drive_link, m.filename, m.mime_type, m.size_bytes,
         m.metadata, m.media_type, m.preview_url, m.uploaded_at, m.created_at, m.updated_at,
         d.archived_at, d.archive_reason, d.last_posted_at, d.post_count
  FROM gateway.media_assets m
  LEFT JOIN bot.media_delivery_state d ON d.media_asset_id = m.id;

CREATE VIEW public.mezon_users AS
  SELECT mezon_user_id, username, display_name, first_seen_at, last_seen_at,
         created_at, updated_at
  FROM bot.mezon_users;

CREATE VIEW public.media_reactions AS
  SELECT media_asset_id, mezon_user_id, reaction, message_id, channel_id, created_at, updated_at
  FROM bot.media_reactions;

CREATE VIEW public.media_archives AS
  SELECT id, media_asset_id, archived_by_mezon_user_id, reason, message_id, channel_id, created_at
  FROM bot.media_archives;

CREATE VIEW public.bot_media_posts AS
  SELECT id, media_asset_id, channel_id, message_id, posted_by, created_at
  FROM bot.media_posts;

CREATE VIEW public.bot_event_dedup AS
  SELECT event_id, event_type, expires_at, created_at
  FROM bot.event_dedup;