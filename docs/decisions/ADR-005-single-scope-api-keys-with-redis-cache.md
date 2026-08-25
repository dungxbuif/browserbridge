---
artifact_type: adr
id: ADR-005
status: proposed
owner: human
date: 2026-08-24
trace:
  requirement: FR-021, NFR-012
  phase: PHASE-004
  tickets_or_bugs:
    - TICKET-012
  detail_design: DESIGN-006
  master_docs:
    - docs/architecture/API.md
    - docs/architecture/ARCHITECTURE.md
    - docs/architecture/ERD.md
    - docs/architecture/SDD.md
  supersedes_scope_of: ADR-004
---

# ADR-005: Authenticate agents with single-scope API keys cached in Redis

## Context

The owner wants an agent to read collected social users, media assets and bot delivery
history over HTTP instead of running `psql` or Node tools, and wants to control Chrome
through the same credential. Today the gateway has one shared secret
(`BROWSER_BRIDGE_AUTH_TOKEN`, compared in `server/internal/bridge/server.go:580`) and no
database-backed credential of any kind. There is no issue, list, rotate or revoke path.

[ADR-004](ADR-004-scoped-agent-sessions-policy-and-audit.md) proposed scoped agent
sessions with `gateway.agents`, `agent_sessions`, `capability_grants`, `policy_rules`,
`idempotency_keys`, `audit_events` and `operational_errors`, one-hour session TTL and
allow/deny/needs_approval precedence. The owner reviewed that model and rejected it as
disproportionate for a single-user deployment bound to `127.0.0.1`.

The owner also required that key verification must not read PostgreSQL on every request,
that the cache must never expire, and that key management must stay in a CLI rather than
an HTTP admin surface. A Redis instance already runs locally as part of the separate
`dev-env` Docker Compose project.

## Decision

- Authenticate agents with **single-scope API keys**. A valid key grants every gateway
  capability, including `POST /v1/runtime/evaluate`. There are no scopes, roles or
  capability grants in this decision.
- Persist keys in `gateway.api_keys` storing only `SHA-256(token)`, a four-character
  display suffix, and lifecycle timestamps. Plaintext is printed once and never stored.
- Treat PostgreSQL as the single source of truth and **Redis as a derived cache with no
  expiry**. Cache entries are `bb:apikey:<sha256-hex>` mapping to the key label.
- Use the existing `dev-env` Redis container at `redis://127.0.0.1:6379`. BrowserBridge
  does not add a Redis service to its own `docker-compose.yml`.
- Manage keys with a CLI (`bb-apikey issue|list|revoke|sync`). The CLI writes PostgreSQL
  **first**, then mutates Redis, so a partial failure can never leave a revoked key
  cached as valid. A failed Redis mutation exits non-zero and demands a retry.
- Resolve a Redis miss or Redis error with a **cache-aside fallback** to PostgreSQL, then
  repopulate Redis. Redis being unavailable degrades latency, never availability.
- Rehydrate the whole active key set into Redis at gateway startup, because the shared
  Redis container runs without persistence and loses data on restart.
- Keep `BROWSER_BRIDGE_AUTH_TOKEN` as the **only** credential for the extension WSS route
  `GET /v1/extension` and for key administration. An API key can never mint or revoke
  another API key.
- Implement the Redis client with the Go standard library over a minimal RESP subset
  (`GET`, `SET`, `DEL`, `MSET`) instead of adding a third-party Redis dependency, to
  preserve the stated standard-library baseline in `docs/CONTEXT.md`.
- Defer ADR-004 rather than reject it. Sessions, capability grants, policy rules,
  idempotency records and audit events remain designed but unimplemented.

## Alternatives considered

- **Scoped agent sessions per ADR-004**: rejected by the owner as disproportionate for a
  single-user localhost deployment. Retained as a deferred design.
- **Query PostgreSQL on every request with no cache**: recommended by the AI because the
  table holds fewer than twenty rows behind a partial index, and the per-request cost is
  negligible next to opening a Chrome tab or streaming an 8 MiB Drive chunk. Rejected by
  the owner, who required that the hot path not touch PostgreSQL.
- **In-process map cache with a TTL**: rejected because the owner required the cache never
  to expire.
- **In-process map cache with no expiry and a standalone CLI**: rejected because the CLI
  is a separate OS process and cannot invalidate the gateway's memory. Revocation would
  have had no effect until a gateway restart, and a restart discards in-flight resumable
  upload sessions held in RAM (`server/internal/bridge/server.go:42`, with a two-hour
  command timeout at `:29`).
- **In-process map cache plus HTTP admin endpoints**: recommended by the AI because the
  gateway would own both the cache and the mutation, giving instant revocation with zero
  hot-path lookups and no new dependency. Rejected by the owner, who required CLI-based
  management.
- **Adding a Redis service to BrowserBridge `docker-compose.yml`**: rejected by the owner
  in favour of reusing the running `dev-env` container.
- **Adding `github.com/redis/go-redis/v9`**: rejected because only three commands are
  needed and the project baseline is the Go standard library.

## Consequences

- Positive: revocation and issuance take effect immediately without restarting the
  gateway. The hot path performs no PostgreSQL query. Key management stays in a CLI. No
  new service is added to this project's Compose file. Implementation is far smaller than
  ADR-004.
- Negative, accepted by the owner: a single leaked key grants arbitrary JavaScript
  execution in a Chrome profile that is logged in to TikTok, Instagram and Facebook.
  There is no scope to limit blast radius and no audit trail of what a key did.
- Negative, accepted by the owner: BrowserBridge depends on a Redis container it does not
  declare, own or health-check. `scripts/doctor.sh` can assert reachability but cannot
  manage that container's lifecycle. If the `dev-env` project is stopped or rebuilt,
  BrowserBridge silently falls back to PostgreSQL until `bb-apikey sync` or a gateway
  restart repopulates the cache.
- Negative, accepted by the owner: the Redis instance is shared with another project. The
  `bb:apikey:` namespace reduces but does not eliminate collision risk, and any process
  with access can read every cached key hash or issue `FLUSHALL`. Cached values are label
  strings keyed by hash, so a reader learns key labels and hashes but not plaintext.
- Negative: a successful PostgreSQL revoke followed by a failed Redis delete leaves the
  key usable until the next `sync` or restart. The CLI must exit non-zero and the operator
  must retry. This is the one ordering hazard the design cannot remove.
- Neutral: adding a `scope` column later is a single additive migration, so the
  single-scope decision is reversible without redesign.
- Neutral: ADR-004 stays available. Promoting it later is additive because
  `gateway.api_keys` does not conflict with `gateway.agents`.

## Linked work

- [PHASE-004](../work/phases/PHASE-004-resilient-agent-gateway.md)
- [DESIGN-006](../work/designs/DESIGN-006-agent-api-key-and-read-api.md)
- [TICKET-012](../work/tickets/TICKET-012-agent-api-key-and-read-api.md)
- [ADR-004](ADR-004-scoped-agent-sessions-policy-and-audit.md) (deferred by this decision)
- [TICKET-011](../work/tickets/TICKET-011-agent-control-api-mcp.md) (deferred by this decision)
