---
artifact_type: ticket
id: TICKET-012
status: draft
owner: shared
priority: high
lane: high-risk
approval: pending
updated: 2026-08-24
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-012
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  requirement: FR-021, NFR-012
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  detail_design: docs/work/designs/DESIGN-006-agent-api-key-and-read-api.md
  test_verification: planned cache, auth, store and endpoint tests
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs:
    - docs/decisions/ADR-005-single-scope-api-keys-with-redis-cache.md
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-012: Agent API key authentication and read API

## Context and scope

The gateway exposes ten browser-control routes and no database reads
(`server/internal/bridge/server.go:90-100`). Authentication is one shared secret with no
issue, list or revoke path (`:580`). The owner wants an agent to query social users, media
assets and bot delivery history over HTTP with a revocable credential instead of running
`psql` or `node tools/media_status.mjs`.

This ticket replaces the scoped-session model in TICKET-011 with the far smaller
single-scope API key model approved in [ADR-005](../../decisions/ADR-005-single-scope-api-keys-with-redis-cache.md).

In scope: `gateway.api_keys`, a stdlib RESP cache client, cache-aside authentication with
a PostgreSQL fallback, startup rehydrate, a `bb-apikey` CLI, seven read endpoints, one
social-user upsert endpoint, and an end-to-end verifier.

Out of scope: scopes, roles, capability grants, policy rules, agent sessions, idempotency
records, audit events, operational-error persistence, MCP, rate limiting, and every job
mutation route that depends on TICKET-009 tables (`collector_jobs`,
`media_download_jobs`, `media_download_attempts`, `worker_heartbeats`).

## Acceptance criteria

- [ ] `bb-apikey issue --label <name>` prints a 64-character key exactly once, stores only
      its SHA-256 and a four-character suffix, and the key immediately authenticates
      without restarting the gateway.
- [ ] `bb-apikey revoke --label <name>` makes the key return 401 immediately without
      restarting the gateway; a failed cache invalidation exits non-zero with
      `REDIS_INVALIDATION_FAILED`.
- [ ] `bb-apikey list` shows label, suffix, created, last used and revoked, and never a
      hash or plaintext.
- [ ] Issuing a label that already exists is rejected; rotation requires an explicit
      revoke first.
- [ ] A valid API key authenticates every `/v1` route except `GET /v1/extension`, which
      accepts only `BROWSER_BRIDGE_AUTH_TOKEN`.
- [ ] No HTTP route can create or revoke an API key.
- [ ] With `REDIS_URL` unset, authentication and all endpoints work through PostgreSQL
      alone.
- [ ] With Redis stopped mid-run, requests still authenticate and
      `GET /v1/status/summary` reports `cache_reachable: false`.
- [ ] After a Redis restart, `bb-apikey sync` restores `cache_reachable: true` and cached
      authentication.
- [ ] `GET /v1/status/summary` returns per-platform social and media counts, archived
      count, bot post count, reaction counts, schema version and runtime flags.
- [ ] `GET /v1/social/users`, `/v1/media/assets` and `/v1/bot/posts` paginate by keyset;
      `limit` is clamped to 500 and a malformed `cursor` returns `INVALID_REQUEST`.
- [ ] `GET /v1/media/assets/by-drive-file/{drive_file_id}` resolves an asset and returns
      no OAuth, Drive resumable URL or social credential.
- [ ] `POST /v1/social/users` upserts by `(platform, source_user_id)`.
- [ ] Serialised `metadata` omits any key matching `cookie`, `token`, `auth`, `secret` or
      `session`.
- [ ] No response body, log line or CLI output contains a bearer value or a key hash.
- [ ] UAT requirement: required. Owner issues a key, queries state through an agent,
      revokes the key and confirms the next call fails.

## Impact and approval

- Small task exemption: no.
- Impact checked: API=yes, DB=yes, Security=yes, Runtime=yes, Standards=no.
- Dependencies: [TICKET-008](TICKET-008-two-schema-migration.md) must reach `verified`
  because this ticket's migration `0007` targets the `gateway` schema.
- Detail design: [DESIGN-006](../designs/DESIGN-006-agent-api-key-and-read-api.md),
  approval pending.
- New runtime dependency: the Redis container owned by the separate `dev-env` Compose
  project. Accepted by the owner and recorded in ADR-005.

## Accepted risks

These were raised, rejected as blockers by the owner, and are recorded so they are not
rediscovered later:

1. A single leaked key grants `POST /v1/runtime/evaluate`, meaning arbitrary JavaScript in
   a Chrome profile logged in to TikTok, Instagram and Facebook. There is no scope and no
   audit trail.
2. BrowserBridge depends on a Redis container it does not declare, own or health-check.
3. That Redis instance is shared with another project, so another process can read cached
   label-by-hash entries or run `FLUSHALL`.
4. A successful PostgreSQL revoke followed by a failed Redis delete leaves the key usable
   until `sync` or a gateway restart.

## Verification plan

- Unit: RESP encode/decode including nil, error, short-read and malformed-length replies;
  hash lookup, revoke, legacy-token coexistence, cache-hit avoids PostgreSQL, cache-miss
  falls back and repopulates, Redis error falls back, `last_used_at` failure is harmless.
- Integration: every new route against seeded PostgreSQL; cursor round-trip; limit clamp;
  401 and 404 shapes; `GET /v1/extension` rejects an API key; metadata allowlist strips a
  planted `cookie` key.
- E2E: `tools/verify_agent_api.mjs` runs issue, call all routes, drive `POST /v1/tabs`,
  revoke, confirm 401, and asserts no plaintext leak. Repeated with `REDIS_URL` unset.
- Manual: probe whether the shared Redis requires `requirepass`; stop and restart the
  container to exercise fallback and `sync`.
- Regression: `go test ./...` in `server`, `npm run check` in `bot`, `./scripts/doctor.sh`.

## Normative contract

- [DESIGN-006](../designs/DESIGN-006-agent-api-key-and-read-api.md)
- [ADR-005](../../decisions/ADR-005-single-scope-api-keys-with-redis-cache.md) must be
  accepted before implementation.
- `bb-apikey` writes PostgreSQL before Redis on every mutation. The reverse order is
  forbidden because the cache-aside fallback would repopulate an uncommitted revoke.
- Migration `0007_api_keys.sql` must not be applied before TICKET-008 versions `0001`
  through `0004`.

## Completion state

- Implementation: not started.
- UAT: required.
- Docs reconciliation required: API, architecture, ERD, SDD, context, validation matrix,
  changelog and README.

## Progress checklist

- [x] ADR, detail design and backlog trace created.
- [ ] TICKET-008 verified; DESIGN-006 approved; ADR-005 accepted; ticket moved to `ready`.
- [ ] Migration `0007`, cache client, auth path, store methods, endpoints and CLI complete.
- [ ] Unit, integration, E2E and fallback verification results and fix-cycle counts recorded.
- [ ] Owner issue/query/revoke UAT signed off.
- [ ] Master docs, validation matrix, context, backlog and changelog reconciled.
