---
artifact_type: detail_design
id: DESIGN-003
status: approved
owner: shared
updated: 2026-08-23
human_fields:
  - approval
  - product_name
  - command_prefix
  - product_tone
ai_fields:
  - context_loaded
  - proposed_approach
  - impacted_areas
  - verification_plan
  - reconciliation_plan
shared_fields:
  - trace
  - status
trace:
  ticket: docs/work/tickets/TICKET-007-social-media-worker-mezon-bot.md
  phase: docs/work/phases/PHASE-003-agent-integration.md
  backlog: docs/work/BACKLOG.md
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  release_notes: docs/releases/CHANGELOG.md
---

# DESIGN-003: Mlem social media worker + Mezon bot behavior

## Status

- Status: approved
- Approval source: owner direction in active thread
- Product name: `mlem`
- Command prefix: `*mlem`
- Scope: behavioral/design documentation for TICKET-007; no schema or code change in this docs-only update.

## Context Loaded

- [CONTEXT](../../CONTEXT.md)
- [BACKLOG](../BACKLOG.md)
- [QUALITY_BAR](../../standards/QUALITY_BAR.md)
- [VALIDATION](../../standards/VALIDATION.md)
- [PHASE-003](../phases/PHASE-003-agent-integration.md)
- [TICKET-007](../tickets/TICKET-007-social-media-worker-mezon-bot.md)
- `social_media_download/reports/REPORT.md`
- `social_media_download/reports/NOTES.md`
- `social_media_download/manifest.json`
- Symbol-level inspection of `social_media_download/Tiktok.e79cfa76.js`, `Instagram.f1e86f7f.js`, `Facebook.385b96ea.js`, `background/index.js`, and `main-world-tiktok-douyin.9c891ac2.js`
- Current code behavior in `bot/src/config.js`, `bot/src/bot-core.js`, `bot/src/media-worker-core.js`, `bot/src/store.js`, and `README.md`

## Problem Statement

The bot is intended as a personal, lighthearted Mezon media bot. It should collect social media from owner-selected browser-visible sources, upload media to Drive/DB, and post enjoyable images into a Mezon channel without turning the browser, social accounts, or Mezon channel into a high-volume crawler/spam system.

The owner chose the product name `mlem` and wants the command naming to match.

## Design 1: Crawl And Collection Behavior

The crawler should behave as a bounded collector, not an expanding social graph crawler.

- Source scope: collect only from explicit/imported `social_users`; do not auto-follow related users or expand recommendations.
- Browser boundary: extraction runs through the connected Chrome/BrowserBridge session; backend still must not receive social cookies/tokens.
- Per-user pacing: each social user has a cooldown before another profile scrape.
- Per-tick pacing: each worker tick processes a bounded number of users and media items.
- Duplicate control: skip media already known by `(platform, source_user_id, media_id)`.
- Large-data posture: discovered media should be treated as queueable work; for the current MVP, uploaded media is persisted in `media_assets`, while profile-level failures are logged in social-user metadata.
- Robust next step: add a dedicated `media_download_jobs` table before scaling to large accounts so each media item has `attempt_count`, `next_retry_at`, `last_error`, and terminal/dead-letter state.
- Audit metadata: preserve platform, source user, source profile URL, post/media ID, media URL, preview URL, caption/page metadata, Drive file metadata, and timestamps sufficient to debug failed or duplicated downloads.

### Reference Input From `social_media_download`

The local `social_media_download` extension is useful as a platform-reference corpus, not as a credential model to copy.

Reusable design signals:

- TikTok: prefer profile/post extraction that understands `aweme`/item detail shapes, `imagePost` vs `VIDEO`, `PlayAddr.UrlList`, `playAddr`, `cover`, and `originCover`.
- Instagram: prefer GraphQL/page-data media shapes such as profile lookup by username, post/reel URLs, carousel edges, image candidates, video URLs, and pagination cursors when visible to the browser session.
- Facebook: add as a future platform using page-visible post/photo/reel/group media shapes; useful symbols include `getPhotoDownloadUrl`, `getPostMediaDetails`, `CometVideoRootMediaViewerQuery`, `GroupsCometMediaPhotosTabGridQuery`, `GroupsCometMediaVideosTabGridQuery`, `progressive_urls`, and `currMedia.image.uri`.
- Main-world bridge pattern: page-context fetch can be useful for TikTok-style APIs when Chrome page context is required.

Rejected reference patterns:

- Do not copy `cookies` permission, `chrome.webRequest` credential interception, or credential cache keys such as Facebook/Instagram/TikTok request credentials into BrowserBridge.
- Do not send `fb_dtsg`, `x-csrftoken`, `device_id`, `odinId`, account cookies, or equivalent social credentials to the backend.
- Do not copy declarativeNetRequest header rewrite rules intended to bypass CORS/referer restrictions.
- Do not use background `chrome.downloads.download` as the primary persistence path; BrowserBridge already uses chunk upload to backend and Google Drive.

### Platform Priority

| Platform | Priority | Current repository support | Design target |
| --- | --- | --- | --- |
| TikTok | P0 | Worker/exporter implemented | Improve extractor quality using aweme/media shape references while staying inside browser session |
| Instagram | P0 | Worker/exporter implemented | Improve carousel/reel/profile pagination extraction using page-visible data shapes |
| Facebook | P1 | Not implemented in worker | Add after per-media retry jobs or as a separate approved slice; support profiles/pages/groups/reels only where visible to the logged-in browser |

## Design 2: Mezon Posting Behavior

The Mezon bot should behave like a small curated feed.

- Bot identity/name: `mlem`.
- Command prefix: set `BOT_COMMAND_PREFIX='*mlem'` for the deployed bot.
- Supported send-more commands under the chosen prefix: `*mlem`, `*mlem more`, `*mlem next`, and `*mlem thêm`.
- Scheduled posting: send at a conservative interval; default should remain operator-configurable through `BOT_POST_INTERVAL_SECONDS`.
- Empty queue behavior: scheduled runs stay quiet when no media is available; manual commands can return a short empty-state message.
- Channel controls: each media card keeps `Like`, `Che`, and `Delete (admin)`.
- Delete semantics: admin delete remains soft archive through `media_archives`/`media_assets.archived_at`; Drive files are not deleted immediately.
- Identity separation: Mezon users remain in `mezon_users`; social identities remain in `social_users`.
- Anti-spam posture: do not immediately post every crawled item; posting should pull from persisted eligible media at the configured cadence or by explicit command.

## Brownfield Touched Scope

- Documentation touched by this design: TICKET-007, README, validation matrix, changelog, project context.
- Direct code contracts inspected: `BOT_COMMAND_PREFIX` configuration, command alias parser, media worker scrape/claim flow, bot reaction/archive behavior.
- Contracts affected: deployment configuration guidance for Mezon command prefix.
- Known unknowns: real Mezon display-name setup depends on Mezon bot registration outside this repository.

## Alternatives Considered

| Alternative | Benefit | Rejection reason |
| --- | --- | --- |
| Keep `*bb` as the public command | No deployment change | Does not match owner-selected `mlem` bot concept |
| Rename code defaults from `*bb` to `*mlem` immediately | New installs match the chosen name automatically | Code change is not required for this docs/design step because `BOT_COMMAND_PREFIX` already supports the chosen command |
| Crawl and post everything immediately | Simple mental model | Too noisy for Mezon and risky for large social accounts |
| Add per-media job table now | Strong retry/dead-letter semantics | Requires DB/schema/runtime changes and a separate approved implementation step |

## Impact

- Code: no code changes in this design update.
- Behavior: desired deployment behavior is `mlem` branding and `*mlem` commands; extraction optimization should prioritize TikTok, Instagram, then Facebook.
- API: no BrowserBridge HTTP/WebSocket API change.
- Data: no schema change in this design update.
- Security: no change to the browser-cookie boundary; backend still receives chunks/metadata, not social credentials. `social_media_download` credential-capture and header-rewrite patterns are explicitly out of scope.
- Runtime: deployers should set `BOT_COMMAND_PREFIX='*mlem'`.
- Docs: README, TICKET-007, validation matrix, changelog, and context should reference the chosen bot name/command.

## Verification Plan

- Docs review: verify docs consistently mention `mlem` and `*mlem`.
- Existing command parser proof remains valid because command support is prefix-configured; when `BOT_COMMAND_PREFIX='*mlem'`, the same alias parser accepts `*mlem`, `*mlem more`, `*mlem next`, and `*mlem thêm`.
- Future extractor improvements should add platform-specific unit tests for normalized media items and fake-bridge integration checks before live Chrome UAT.
- No code tests are required for this docs-only change; future code default changes should run `rtk npm run check` in `bot`.

## Reconciliation Plan

- Requirements: README documents selected deployment name/command.
- Architecture/API/ERD: no update required because no boundary, endpoint, or schema changes are made.
- ADR: not required for naming/config guidance; required later if job-table retry semantics are implemented.
- Context/backlog/ticket/validation/changelog: update to reflect the approved `mlem` design and remaining live UAT blocker.
