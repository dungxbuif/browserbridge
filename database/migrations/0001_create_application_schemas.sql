-- 0001: create gateway and bot application schemas plus TICKET-008 target tables.
-- No foreign keys are added here; they arrive in 0003 after backfill verification.

CREATE SCHEMA IF NOT EXISTS gateway;
CREATE SCHEMA IF NOT EXISTS bot;

-- Owner decision 2026-08-24: the legacy social claim columns
-- (scrape_claim_id, scrape_claimed_at) are intentionally NOT carried into
-- gateway.social_users. Their replacement, gateway.collector_jobs, is created by
-- migration 0005 (TICKET-009). The media worker is therefore non-functional until
-- 0005 exists; this is an accepted, documented outage.

CREATE TABLE gateway.social_users (
  id                       BIGSERIAL PRIMARY KEY,
  platform                 TEXT NOT NULL,
  source_user_id           TEXT NOT NULL,
  username                 TEXT NOT NULL DEFAULT '',
  display_name             TEXT NOT NULL DEFAULT '',
  profile_url              TEXT NOT NULL DEFAULT '',
  avatar_url               TEXT NOT NULL DEFAULT '',
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_collected_at        TIMESTAMPTZ,
  last_scraped_at          TIMESTAMPTZ,
  next_scrape_at           TIMESTAMPTZ,
  consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  last_error_code          TEXT NOT NULL DEFAULT '',
  last_error_summary       TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gateway.media_assets (
  id              BIGSERIAL PRIMARY KEY,
  platform        TEXT NOT NULL,
  source_user_id  TEXT NOT NULL,
  source_username TEXT NOT NULL DEFAULT '',
  media_id        TEXT NOT NULL,
  post_id         TEXT NOT NULL DEFAULT '',
  page_url        TEXT NOT NULL DEFAULT '',
  source_url      TEXT NOT NULL DEFAULT '',
  media_type      TEXT NOT NULL DEFAULT 'unknown',
  post_type       TEXT NOT NULL DEFAULT 'unknown',
  position        INTEGER NOT NULL DEFAULT 0,
  preview_url     TEXT NOT NULL DEFAULT '',
  drive_file_id   TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL,
  drive_link      TEXT NOT NULL DEFAULT '',
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL DEFAULT '',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot.mezon_users (
  mezon_user_id TEXT PRIMARY KEY,
  username      TEXT NOT NULL DEFAULT '',
  display_name  TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bot view of a gateway asset: archive/post/claim state lives here, not on
-- gateway.media_assets. SaveMediaAsset creates exactly one row per asset.
CREATE TABLE bot.media_delivery_state (
  media_asset_id           BIGINT PRIMARY KEY,
  archived_at              TIMESTAMPTZ,
  archive_reason           TEXT NOT NULL DEFAULT '',
  last_posted_at           TIMESTAMPTZ,
  post_count               INTEGER NOT NULL DEFAULT 0,
  posting_claim_token      UUID,
  posting_claimed_by       TEXT NOT NULL DEFAULT '',
  posting_claim_expires_at TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot.media_reactions (
  media_asset_id BIGINT NOT NULL,
  mezon_user_id  TEXT NOT NULL,
  reaction       TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  message_id     TEXT NOT NULL DEFAULT '',
  channel_id     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (media_asset_id, mezon_user_id)
);

CREATE TABLE bot.media_archives (
  id                     BIGSERIAL PRIMARY KEY,
  media_asset_id         BIGINT NOT NULL,
  archived_by_mezon_user_id TEXT NOT NULL,
  reason                 TEXT NOT NULL DEFAULT '',
  message_id             TEXT NOT NULL DEFAULT '',
  channel_id             TEXT NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot.media_posts (
  id            BIGSERIAL PRIMARY KEY,
  media_asset_id BIGINT NOT NULL,
  channel_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  posted_by     TEXT NOT NULL DEFAULT 'scheduler',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot.event_dedup (
  event_id   TEXT PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);