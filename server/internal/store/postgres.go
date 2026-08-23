package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type MediaAsset struct {
	Platform       string
	SourceUserID   string
	SourceUsername string
	MediaID        string
	PostID         string
	SourceURL      string
	DriveFileID    string
	DriveLink      string
	Filename       string
	MIMEType       string
	SizeBytes      int64
	MediaType      string
	PreviewURL     string
	Metadata       json.RawMessage
	UploadedAt     time.Time
}

type SocialUser struct {
	Platform      string
	SourceUserID  string
	Username      string
	DisplayName   string
	ProfileURL    string
	AvatarURL     string
	Metadata      json.RawMessage
	LastScrapedAt time.Time
}

type MediaStore interface {
	SaveMediaAsset(context.Context, MediaAsset) error
	UpsertSocialUser(context.Context, SocialUser) error
}

type Postgres struct {
	db *sql.DB
}

func OpenPostgres(ctx context.Context, databaseURL string) (*Postgres, error) {
	if databaseURL == "" {
		return nil, errors.New("database URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	pg := &Postgres{db: db}
	if err := pg.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return pg, nil
}

func (p *Postgres) Close() error {
	return p.db.Close()
}

func (p *Postgres) Migrate(ctx context.Context) error {
	_, err := p.db.ExecContext(ctx, `
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

CREATE INDEX IF NOT EXISTS media_assets_source_user_idx ON media_assets(platform, source_user_id);
CREATE INDEX IF NOT EXISTS media_assets_drive_file_idx ON media_assets(drive_file_id);

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

CREATE INDEX IF NOT EXISTS social_users_platform_username_idx ON social_users(platform, username);

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

CREATE INDEX IF NOT EXISTS media_reactions_asset_idx ON media_reactions(media_asset_id, reaction);

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

CREATE INDEX IF NOT EXISTS bot_event_dedup_expires_idx ON bot_event_dedup(expires_at);
`)
	if err != nil {
		return err
	}
	_, err = p.db.ExecContext(ctx, `
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
`)
	return err
}

func (p *Postgres) SaveMediaAsset(ctx context.Context, asset MediaAsset) error {
	if asset.Metadata == nil || !json.Valid(asset.Metadata) {
		asset.Metadata = json.RawMessage(`{}`)
	}
	if asset.UploadedAt.IsZero() {
		asset.UploadedAt = time.Now().UTC()
	}
	_, err := p.db.ExecContext(ctx, `
INSERT INTO media_assets (
  platform, source_user_id, source_username, media_id, post_id, source_url,
  drive_file_id, drive_link, filename, mime_type, size_bytes, media_type, preview_url, metadata, uploaded_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (platform, source_user_id, media_id)
DO UPDATE SET
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
  metadata = EXCLUDED.metadata,
  uploaded_at = EXCLUDED.uploaded_at,
  updated_at = now()
`, asset.Platform, asset.SourceUserID, asset.SourceUsername, asset.MediaID, asset.PostID, asset.SourceURL,
		asset.DriveFileID, asset.DriveLink, asset.Filename, asset.MIMEType, asset.SizeBytes, asset.MediaType, asset.PreviewURL, asset.Metadata, asset.UploadedAt)
	return err
}

func (p *Postgres) UpsertSocialUser(ctx context.Context, user SocialUser) error {
	if user.Metadata == nil || !json.Valid(user.Metadata) {
		user.Metadata = json.RawMessage(`{}`)
	}
	if user.LastScrapedAt.IsZero() {
		user.LastScrapedAt = time.Now().UTC()
	}
	_, err := p.db.ExecContext(ctx, `
INSERT INTO social_users (
  platform, source_user_id, username, display_name, profile_url, avatar_url, metadata, last_scraped_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (platform, source_user_id)
DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  profile_url = EXCLUDED.profile_url,
  avatar_url = EXCLUDED.avatar_url,
  metadata = EXCLUDED.metadata,
  last_scraped_at = EXCLUDED.last_scraped_at,
  updated_at = now()
`, user.Platform, user.SourceUserID, user.Username, user.DisplayName, user.ProfileURL, user.AvatarURL, user.Metadata, user.LastScrapedAt)
	return err
}
