---
artifact_type: detail_design
id: DESIGN-005
status: in_review
owner: shared
approval: pending
updated: 2026-08-24
human_fields:
  - approval
  - platform_priority
  - drive_folder_constraint
  - schema_boundary
ai_fields:
  - problem
  - context_loaded
  - brownfield_scope
  - proposed_approach
  - api_data_model
  - security
  - test_plan
  - reconciliation_plan
shared_fields:
  - status
  - trace
trace:
  backlog_item: docs/work/BACKLOG.md
  requirement: FR-018, FR-019, FR-020, NFR-010, NFR-011
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  tickets:
    - docs/work/tickets/TICKET-008-two-schema-migration.md
    - docs/work/tickets/TICKET-009-resilient-media-jobs-drive-folder.md
    - docs/work/tickets/TICKET-010-three-platform-collectors.md
  test_verification: docs/work/VALIDATION_MATRIX.md
  docs_review: pending implementation
  release_notes: docs/releases/CHANGELOG.md
  adrs:
    - docs/decisions/ADR-002-browser-media-drive-boundary.md
    - docs/decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md
  master_docs_touched:
    - docs/requirements/SPEC.md
    - docs/architecture/ARCHITECTURE.md
    - docs/architecture/API.md
    - docs/architecture/ERD.md
    - docs/architecture/SDD.md
  annexes:
    - docs/work/designs/DESIGN-005-DATABASE.md
    - docs/work/designs/DESIGN-005-FLOWS.md
    - docs/work/designs/DESIGN-004-API.md
---

# DESIGN-005: Two-schema resilient social media pipeline

## Status

- Status: in_review; implementation-ready design complete, owner approval pending.
- Scope decision from owner: exactly two application schemas, `gateway` and `bot`; focus TikTok, Instagram and Facebook; failed media must be retryable and observable; uploads use one configured Drive folder and persist Drive IDs.
- Environment assumption confirmed by owner: this is development and there are no existing Drive media files requiring folder reconciliation. Migration still guards unexpected legacy rows instead of silently inventing folder metadata.
- Platform normalization: the latest prompt's duplicate "titok/tiktok" is interpreted using prior context as TikTok, Instagram and Facebook.
- Small task exemption: no.
- Impact checked: API=yes, DB=yes, Security=yes, Runtime=yes, Standards=no.

## 1. Context and brownfield scope

Current code creates all tables in `public` from both `server/internal/store/postgres.go` and `bot/src/store.js`. TikTok and Instagram worker paths exist; Facebook is not implemented. Upload completion already persists `media_assets.drive_file_id`, but the row does not persist `drive_folder_id`. The server currently accepts a request-level `drive_folder_id`, falling back to `GOOGLE_DRIVE_FOLDER_ID`, so the fixed-folder invariant is not enforced. Media failures are recorded only at profile level in `social_users.metadata`; there is no durable per-media retry queue.

Touched modules planned:

- `server/internal/store/`, `server/internal/bridge/`, `server/internal/drive/`
- `bot/src/store.js`, `bot/src/media-worker-core.js`, platform extractors/config
- new versioned database migrations
- HTTP/MCP status and job-control adapters from DESIGN-004
- verifiers under `tools/` and worker/server tests

Direct dependencies inspected: PostgreSQL DDL in server and bot, Drive session folder resolution, worker DB verifiers, current ERD/API/architecture, and the local `social_media_download` reports/manifest.

Known unknowns: live DOM/page-state variations and rate limits for the three platforms; Facebook session/UI variants; Drive resumable-session behavior after process restart. These require fake fixtures plus owner-session UAT and must not be solved by exporting credentials.

Normative implementation annexes:

- [Database and migration contract](DESIGN-005-DATABASE.md): exact columns, constraints, indexes, migration ownership, backfill, compatibility views, rollback and retention.
- [Runtime and platform flow contract](DESIGN-005-FLOWS.md): sequence/state flows, stable identity, retries, leases, fixed Drive invariant and TikTok/Instagram/Facebook behavior.
- [Agent API/MCP contract](DESIGN-004-API.md): exact HTTP/MCP, permissions, idempotency, redaction and audit behavior.

## 2. Architecture and ownership

```text
Agent / scheduler / MCP
          |
          v
Gateway API + policy + audit
          |
          +--> Chrome extension --> TikTok / Instagram / Facebook
          |
          +--> media job worker --> chunk proxy --> fixed Drive folder
          |
          +--> gateway.* PostgreSQL state
                                   |
                                   v read/reference
                               bot.* state --> Mezon
```

### Schema `gateway`

Owns control-plane and social/media pipeline data:

| Table | Purpose |
| --- | --- |
| `gateway.social_users` | Platform identities and profile scrape schedule/claim state |
| `gateway.collector_jobs` | Bounded profile/following collection lifecycle and cursors |
| `gateway.media_download_jobs` | One durable job per normalized media identity |
| `gateway.media_download_attempts` | Immutable attempt/error log for download/upload stages |
| `gateway.media_assets` | Successful Drive objects and normalized source metadata |
| `gateway.worker_heartbeats` | Worker liveness and last-tick counters/errors |
| `gateway.agents`, `gateway.agent_sessions`, `gateway.capability_grants` | Caller identity and scoped sessions |
| `gateway.policy_rules`, `gateway.audit_events` | Authorization decisions and redacted action history |
| `gateway.operational_errors` | Correlated component/stage failures linked to request, job, attempt and audit IDs |

### Schema `bot`

Owns only Mezon behavior/state:

| Table | Purpose |
| --- | --- |
| `bot.mezon_users` | Mezon identities; never merged with social identities |
| `bot.media_reactions` | Like/Che per Mezon user and gateway media asset |
| `bot.media_delivery_state` | Archive/post/claim state moved out of gateway media catalog |
| `bot.media_archives` | Bot-side moderation/archive audit |
| `bot.media_posts` | Sent media/channel/message history |
| `bot.event_dedup` | Reconnect/event idempotency |
| `bot.send_jobs` | Optional durable scheduled/manual send queue |

`bot` may read and reference `gateway.media_assets`, but bot migrations must not create or alter `gateway` tables. Schema-specific database roles are a follow-up hardening option; initial personal deployment may use one DB role while preserving ownership in code and migrations.

## 3. Migration strategy

1. Add versioned migrations that create both schemas and schema-qualified tables.
2. Stop running duplicated inline DDL from both processes; one migration command owns all DDL.
3. Backfill `public.social_users` and `public.media_assets` into `gateway`; backfill Mezon tables into `bot`.
4. Preserve IDs so cross-schema references and existing post/reaction history remain valid.
5. Compare row counts, unique business keys and sampled checksums before switching runtime queries.
6. Deploy schema-qualified reads/writes, then run DB flow verifiers.
7. Keep old `public` tables read-only for one rollback window. Dropping them is a separate destructive ticket and is out of scope.

No migration may delete existing Drive files or social/bot records.

## 4. Media job and failure model

`gateway.media_download_jobs` uses these states:

```text
pending -> in_progress -> succeeded
                    |
                    +-> retry_wait -> pending
                    |
                    +-> dead
```

Required fields include `id`, `platform`, `source_user_id`, `media_id`, `source_url`, `media_type`, `status`, `stage`, `attempt_count`, `max_attempts`, `next_attempt_at`, `claimed_by`, `claimed_at`, `last_error_code`, `last_error_summary`, `drive_file_id`, `drive_folder_id`, timestamps and JSON metadata.

Uniqueness is `(platform, source_user_id, media_id)`. A succeeded job links one `gateway.media_assets` row. `gateway.media_download_attempts` records each stage, start/end time, retryability, HTTP/provider error class, bytes transferred and a redacted summary.

Retry policy:

- Retry network timeout, extension disconnect, temporary HTTP 429/5xx, expired media URL after re-extraction, and Drive transient errors.
- Do not automatically retry unsupported media, invalid normalized identity, policy denial, confirmed deleted/private media, or repeated auth/session-required state without owner action.
- Exponential backoff with jitter, configurable maximum attempts, and bounded claim leases.
- A stale `in_progress` lease returns to `pending`; exceeding attempts moves to `dead`.
- Agent can inspect attempts and explicitly retry a `dead` job; manual retry is audited and idempotent.

## 5. Fixed Google Drive destination

- `GOOGLE_DRIVE_FOLDER_ID` is required when the social media worker is enabled.
- Social media upload requests do not choose a folder. The gateway injects the configured folder.
- If a request sends another `drive_folder_id`, the gateway returns `DRIVE_FOLDER_MISMATCH`; it never silently uploads elsewhere.
- Upload completion persists `drive_file_id`, `drive_folder_id`, `drive_link`, size, MIME, checksum when available, and source identity in `gateway.media_assets`.
- `drive_file_id` is the durable external tracking key and receives a unique index. The job also stores it for direct status lookup.

## 6. Platform adapter contract

Priority is TikTok, Instagram, Facebook. Each adapter returns the same normalized record:

```json
{
  "platform": "tiktok",
  "source_user_id": "provider-user-id",
  "source_username": "creator",
  "media_id": "provider-media-id",
  "post_id": "provider-post-id",
  "media_type": "image|video",
  "post_type": "single|carousel",
  "position": 0,
  "media_url": "browser-visible-url",
  "preview_url": "optional-preview-url",
  "page_url": "canonical-post-url",
  "mime_type": "image/jpeg",
  "filename": "stable-name.jpg",
  "metadata": {}
}
```

A carousel returns one normalized item per child. `media_id` uses the provider child ID or `{post_id}:item:{position}` and never falls back to a temporary CDN URL.

The local `social_media_download/` extension is reference material only for DOM/page-data/media URL shapes, carousel ordering, best-quality candidate selection and URL canonicalization. BrowserBridge must not copy its cookie permission usage, `webRequest` credential interception, CSRF/device-token cache, declarative header rewrites, signed private API calls, or direct downloads as persistence.

## 7. API/MCP handoff

DESIGN-004 owns permissions and public control contracts. This design requires it to expose:

- status counts by platform/job state;
- paginated social users and media jobs;
- worker heartbeat and last error;
- enqueue collector/crawl jobs;
- retry dead media jobs and cancel pending jobs;
- lookup media by `drive_file_id`;
- audit entries for every mutation.

## 8. Alternatives considered

| Alternative | Decision |
| --- | --- |
| Keep all tables in `public` | Rejected; migration ownership and bot/gateway boundaries remain ambiguous |
| Use separate databases | Rejected for now; unnecessary operational cost for a personal deployment |
| Retry an entire user profile after one media fails | Rejected; duplicates work and hides per-media failure state |
| Allow caller-selected Drive folders | Rejected; violates the single-folder tracking invariant |
| Copy cookies/provider headers from the reference extension | Rejected; violates ADR-002 and expands credential exposure |

## Implementation file map

| Ticket | Planned files/modules |
| --- | --- |
| TICKET-008 | `database/migrations/0001..0004`, `tools/migrate_db.mjs`, a new schema migration verifier, and schema-qualified queries in `server/internal/store/postgres.go`, `bot/src/store.js`, `tools/social_db.mjs` and DB tools |
| TICKET-009 | `database/migrations/0005_media_job_tables.sql`, gateway media-job store/service, `server/internal/bridge` transfer correlation/fixed-folder enforcement, worker queue/heartbeat/config modules and retry tests |
| TICKET-010 | `bot/src/facebook-extractor.js`, refactored TikTok/Instagram adapter modules, Facebook following exporter, shared normalization/canonicalization utilities, three-platform fixtures and fake-bridge verifier |
| TICKET-011 | `database/migrations/0006_agent_policy_tables.sql`, gateway auth/policy/idempotency/audit services, HTTP handlers, MCP adapter/tool registry, bot send/status adapters and contract tests |

No new message broker or microservice is introduced. Existing Go server, Node worker/bot, MV3 extension and PostgreSQL remain the deployment units.

## 9. Verification plan

- Migration: seed current `public` schema, migrate, compare IDs/counts/business keys, run migration twice, and prove rollback window leaves original tables intact.
- Store unit/integration: claim lease, stale claim recovery, unique enqueue, retry/backoff, dead-letter, manual retry, Drive ID lookup and cross-schema bot references.
- Server: reject missing/mismatched fixed folder; persist returned Drive file/folder IDs; preserve chunk ordering and auth checks.
- Worker: normalized fixtures for TikTok, Instagram and Facebook; retryable/non-retryable classification; duplicate media skip; profile tab cleanup.
- Fake bridge E2E: collect -> enqueue -> download -> chunk upload -> Drive result -> asset/job success -> agent status.
- Live UAT: one owner-visible profile per platform, one successful image upload and one controlled failure/retry per platform.
- Security: verify logs/docs contain no OAuth token, cookie, CSRF token, provider request headers or raw secret.

Planned command-level evidence:

- `rtk node tools/migrate_db.mjs --verify --from-legacy-fixture`
- `rtk node tools/verify_schema_migration.mjs`
- `rtk node tools/verify_worker_db_flow.mjs`
- `rtk node tools/verify_social_once_flow.mjs --platform all`
- `rtk node tools/verify_agent_gateway_flow.mjs`
- `rtk node tools/verify_bot_db_flow.mjs`
- `rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...` in `server`
- `rtk npm run check` in `bot`
- `rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh`

## 10. Reconciliation plan

- Requirements: add planned FR-018..020 and NFR-010..011.
- Architecture/API/ERD/SDD: record planned direction now; switch claims to implemented only after tickets pass.
- ADR: ADR-003 records schema ownership and fixed Drive destination.
- Validation matrix: add one planned row per ticket slice.
- Context/backlog/roadmap/changelog: update now for tracking; update again after each ticket changes status.

## Approval gate

- [x] Problem, brownfield scope, architecture, data model, security boundary and test plan drafted.
- [x] Owner constraints recorded without changing runtime behavior.
- [x] Exact DDL, indexes, migration/backfill/rollback and retention documented.
- [x] Collector/media/bot success, retry, crash recovery and interaction flows documented.
- [x] TikTok, Instagram and Facebook identity/extraction/fallback limits documented.
- [x] HTTP/MCP, permissions, pagination, idempotency, correlated operational-error and audit contracts documented, including MCP-primary/secret-free-skill boundary.
- [ ] Owner approves DESIGN-005 for execution.
- [ ] TICKET-008 may move from `draft` to `ready` only after approval.
