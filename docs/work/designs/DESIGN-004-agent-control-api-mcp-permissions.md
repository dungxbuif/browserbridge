---
artifact_type: detail_design
id: DESIGN-004
status: deferred
owner: shared
approval: pending
updated: 2026-08-24
deferred_by: docs/decisions/ADR-005-single-scope-api-keys-with-redis-cache.md
deferred_reason: replaced for now by DESIGN-006 single-scope API key model
human_fields:
  - approval
  - risk_acceptance
  - allowed_integrations
ai_fields:
  - context_loaded
  - problem_statement
  - proposed_approach
  - impacted_areas
  - verification_plan
  - reconciliation_plan
shared_fields:
  - trace
  - status
trace:
  backlog: docs/work/BACKLOG.md
  roadmap: docs/work/ROADMAP.md
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  ticket: docs/work/tickets/TICKET-011-agent-control-api-mcp.md
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  architecture_api: docs/architecture/API.md
  architecture: docs/architecture/ARCHITECTURE.md
  release_notes: docs/releases/CHANGELOG.md
  related_design: docs/work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md
  adrs:
    - docs/decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md
  annexes:
    - docs/work/designs/DESIGN-004-API.md
    - docs/work/designs/DESIGN-005-DATABASE.md
    - docs/work/designs/DESIGN-005-FLOWS.md
---

# DESIGN-004: Agent control API, MCP, and permission model

> **Deferred on 2026-08-24 by [ADR-005](../../decisions/ADR-005-single-scope-api-keys-with-redis-cache.md).**
> Superseded for the current deployment by
> [DESIGN-006](DESIGN-006-agent-api-key-and-read-api.md), which delivers a single-scope
> API key and read-only agent endpoints. MCP, capability grants, policy rules,
> idempotency records, audit events and correlated operational errors are all unimplemented
> and unscheduled. This document is retained as the reference model for a future
> multi-agent or non-localhost deployment.

## Status

- Status: in_review; browser/social/media/bot control contract is implementation-ready, owner approval pending.
- Approval: required before implementation
- Scope: design proposal for a v2 control surface where agents can operate browser and media jobs through a unified permission model; email and generic external APIs remain later slices.
- Out of scope for this document: implementing the APIs, adding email provider OAuth, or changing current shared-token behavior.

## Context Loaded

- [CONTEXT](../../CONTEXT.md)
- [BACKLOG](../BACKLOG.md)
- [QUALITY_BAR](../../standards/QUALITY_BAR.md)
- [VALIDATION](../../standards/VALIDATION.md)
- [API](../../architecture/API.md)
- [ARCHITECTURE](../../architecture/ARCHITECTURE.md)
- [INTEGRATIONS](../../architecture/INTEGRATIONS.md)
- [SDD](../../architecture/SDD.md)
- [ROADMAP](../ROADMAP.md)
- [TRACEABILITY](../TRACEABILITY.md)
- [USER_STORIES](../../requirements/USER_STORIES.md)

## Problem Statement

The current BrowserBridge model is intentionally simple: one owner, one shared bearer token, one global On/Off, and broad browser control. The owner now wants agents to control more surfaces, including browser media, newly sent or received email metadata, and arbitrary external APIs.

That broader goal needs a policy layer. A single all-powerful token is too coarse once the agent can read mail, call third-party APIs, post messages, download media, or mutate external systems.

## Design Goal

Make the agent able to control "everything the owner allows" through one coherent control plane:

```text
Agent / MCP client
    |
    v
BrowserBridge API Gateway
    |
    +-- Policy engine: who can do what, where, and when
    +-- Audit log: requested action, decision, result summary
    +-- Tool router
          |
          +-- Browser provider: Chrome extension
          +-- Media provider: Drive upload + media catalog
          +-- Email provider: Gmail/IMAP/OAuth connector
          +-- External API provider: configured API connectors
          +-- Bot provider: Mezon post/reaction controls
```

Agent power should come from explicit scopes and grants, not from implicit backend access to every secret.

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Agent | A caller identity such as Codex, local MCP host, scheduler, media worker, or bot process |
| Subject | The owner account/profile/resources the agent is acting for |
| Capability | A named action family, for example `browser.read`, `browser.control`, `email.read_metadata`, `api.invoke.github` |
| Grant | A durable permission assignment from subject to agent for specific capabilities |
| Session | A bounded runtime token derived from grants; has expiry and optional task ID |
| Policy | Rules that decide allow/deny/require-confirmation for each command |
| Connector | A provider implementation for browser, email, Drive, Mezon, or external APIs |
| Audit event | Immutable record of decision and result summary, with secrets/page payload redacted |

## Permission Model

Use layered checks:

1. Transport auth verifies the caller identity.
2. Session token maps to an agent and grant set.
3. Command declares requested capability, target, and sensitivity.
4. Policy engine returns `allow`, `deny`, or `needs_approval`.
5. Router executes only if allowed.
6. Audit log records request, decision, target summary, result status, and error class.

### Capability Names

| Capability | Example tools | Risk |
| --- | --- | --- |
| `browser.read` | list tabs, page info, snapshot, screenshot | Reads visible web content |
| `browser.control` | navigate, click, type, scroll, evaluate | Can act as owner in browser |
| `browser.download` | start/download/list downloads | Can persist external data |
| `media.read` | list media catalog/status | Reads stored media metadata |
| `media.enqueue` | enqueue a normalized browser-visible media item | Creates Drive/DB work |
| `media.retry` | retry/cancel an existing media job | Mutates durable job state |
| `ops.read` | list/detail correlated operational errors | Reads redacted runtime failure metadata |
| `email.read_metadata` | list recent sent/received messages, headers, labels | Reads private metadata |
| `email.read_body` | fetch email body/attachments | Reads private content |
| `email.send` | create/send/reply | Mutates external communication |
| `api.invoke.<name>` | call configured API connector | Depends on connector |
| `mezon.post` | post media/message to channel | Public/chat mutation |
| `bot.read` | list sent media and reaction/archive aggregates | Reads Mezon operational metadata |
| `bot.send` | enqueue one bounded mlem media send | Mutates configured Mezon channel |
| `bot.moderate` | archive/unarchive bot delivery state | Does not delete Drive media |
| `admin.policy` | create grants, rotate tokens, edit connectors | Full control-plane mutation |

Default personal setup can grant one trusted local agent broad scopes, but the scopes still exist so scheduled workers and plugins can get narrower tokens.

## API Contract Direction

Keep the current WSS extension contract for Chrome command dispatch, but put a gateway in front of all user-facing HTTP/MCP calls.

### New HTTP API Groups

| Group | Endpoint shape | Purpose |
| --- | --- | --- |
| Agents | `/v1/agents`, `/v1/agents/{id}/sessions` | Register local agent identities and mint bounded sessions |
| Grants | `/v1/grants` | Assign capabilities to agents |
| Policy | `/v1/policy/check` | Dry-run allow/deny/needs-approval decisions |
| Audit | `/v1/audit/events` | Query redacted execution history |
| Errors | `/v1/operations/errors` | Query component/stage/error location by trace or job |
| Status | `/v1/status/summary`, `/v1/status/workers`, `/v1/social/users`, `/v1/media/jobs` | Agent-readable operational state |
| Browser | `/v1/browser/*` | Higher-level browser operations mapped to extension commands |
| Email | `/v1/email/accounts`, `/v1/email/messages` | Provider-backed email metadata/body/actions |
| APIs | `/v1/connectors`, `/v1/connectors/{name}/invoke` | External API connector registry and invocation |
| Jobs | `/v1/jobs`, `/v1/jobs/{id}` | Long-running collector/download/API jobs |

### Command Envelope v2

```json
{
  "v": 2,
  "id": "01J...",
  "agent_id": "codex-local",
  "task_id": "optional-task-id",
  "capability": "email.read_metadata",
  "target": {
    "provider": "gmail",
    "account_id": "owner-primary",
    "resource": "messages"
  },
  "params": {
    "label": "sent",
    "newer_than": "2026-08-23T00:00:00Z",
    "limit": 10
  },
  "deadline_at": "2026-08-23T10:00:00Z",
  "dry_run": false
}
```

The extension WSS commands can remain `v: 1` internally until browser provider migration is worth doing. The gateway translates v2 calls into provider-specific commands.

## MCP Design

Expose MCP tools by domain and capability. Tool names should make risk obvious.

| MCP tool | Required capability | Notes |
| --- | --- | --- |
| `bb_policy_check` | any authenticated session | Shows whether an action would run |
| `bb_browser_tabs_list` | `browser.read` | Current `browser_tabs_list` equivalent |
| `bb_browser_snapshot` | `browser.read` | Snapshot with redaction controls |
| `bb_browser_act` | `browser.control` | Unified click/type/navigate/evaluate wrapper or existing fine-grained tools |
| `bb_media_enqueue_download` | `media.enqueue` | Enqueue normalized media jobs instead of direct ad hoc upload for scale |
| `bb_social_status` | `media.read` | Counts by platform, collected users, scraped users, pending users, recent errors |
| `bb_social_users_list` | `media.read` | Page through collected users and metadata summaries |
| `bb_media_jobs_list` | `media.read` | Show pending/in-progress/retry-wait/dead/succeeded media jobs |
| `bb_worker_status` | `media.read` | Show worker heartbeat, current tick, last tick, queue lag, and last error |
| `bb_errors_list` | `ops.read` | Locate failures by component, stage, code, job or trace |
| `bb_error_get` | `ops.read` | Inspect one redacted failure and related resource links |
| `bb_bot_posts_list` | `bot.read` | List sent media and aggregate interaction state |
| `bb_bot_interactions` | `bot.read` | Show Like/Che/archive records for one bot post |
| `bb_bot_send` | `bot.send` | Enqueue explicit or next eligible media to an allowed channel |
| `bb_bot_archive` | `bot.moderate` | Archive bot delivery eligibility without deleting Drive data |
| `bb_email_recent` | `email.read_metadata` | List recent sent/received message metadata |
| `bb_email_get` | `email.read_body` | Fetch selected body/attachments |
| `bb_email_send` | `email.send` | Should default to `needs_approval` unless explicitly trusted |
| `bb_api_invoke` | `api.invoke.<name>` | Connector-scoped invocation |
| `bb_audit_search` | `admin.policy` or read-only admin | Inspect what agents did |

MCP server should return policy denial as structured errors, not as provider failures.

Exact request/response shapes, pagination, status/error mapping, idempotency, policy table fields, bot control routes and MCP inputs are normative in [DESIGN-004-API](DESIGN-004-API.md).

## Agent Query And Observability Flow

The owner should be able to ask the agent operational questions without reading SQL or logs directly.

Example questions and expected API/MCP backing:

| Owner question | MCP/API path | Data source |
| --- | --- | --- |
| "Đã lấy được bao nhiêu user?" | `bb_social_status` / `GET /v1/status/summary` | `social_users` counts grouped by platform |
| "Có những user nào?" | `bb_social_users_list` / `GET /v1/social/users?platform=tiktok&limit=50` | paginated `social_users` |
| "User nào chưa crawl?" | `bb_social_users_list` with `scrape_state=due` | `last_scraped_at`, claim state, cooldown |
| "Crawl lỗi ảnh nào?" | `bb_media_jobs_list` with `status=retry_wait,dead` | future `media_download_jobs`; current MVP can report profile-level errors from `social_users.metadata` |
| "Worker chạy thế nào?" | `bb_worker_status` / `GET /v1/status/workers` | worker heartbeat table or process status file |
| "Đang tải dở bao nhiêu media?" | `bb_media_jobs_list` with `status=in_progress` | `media_download_jobs` |
| "Lần cuối upload Drive lỗi gì?" | `bb_media_jobs_list` or `bb_audit_search` | job `last_error` and redacted audit events |
| "Lỗi nằm ở đâu?" | `bb_errors_list` / `GET /v1/operations/errors` | correlated operational errors grouped by component/stage/trace |

## Skill, MCP, and API credential decision

Use MCP as the agent's executable control surface. It exposes typed BrowserBridge tools and routes every call through gateway authentication, capability policy, idempotency and audit. Add an optional BrowserBridge skill only as a workflow guide for tool selection, bounded crawl/send sequences and interpreting stable error codes.

The skill must never contain API keys or session tokens. A local MCP adapter receives a short-lived gateway session from process environment or an OS secret store; third-party provider keys stay in backend connector configuration. Therefore the implementation order is gateway HTTP/domain services, MCP adapter, then optional skill.

### Status Response Shape

`GET /v1/status/summary` should return redacted aggregate state:

```json
{
  "social_users": {
    "total": 1240,
    "by_platform": {"tiktok": 900, "instagram": 340, "facebook": 0},
    "due_for_scrape": 81,
    "claimed": 2,
    "last_collected_at": "2026-08-23T10:00:00Z"
  },
  "media": {
    "assets_total": 5220,
    "jobs_pending": 120,
    "jobs_retry_wait": 8,
    "jobs_dead": 1
  },
  "workers": [
    {
      "name": "media-worker",
      "status": "running",
      "last_heartbeat_at": "2026-08-23T10:01:00Z",
      "last_tick_at": "2026-08-23T10:00:30Z",
      "last_error": ""
    }
  ]
}
```

`GET /v1/social/users` should support filters:

- `platform`
- `username`
- `scrape_state`: `due`, `claimed`, `scraped`, `error`
- `limit`, `cursor`
- `sort`: `last_scraped_at`, `created_at`, `updated_at`

`GET /v1/media/jobs` should support filters:

- `platform`
- `source_user_id`
- `status`: `pending`, `in_progress`, `retry_wait`, `dead`, `succeeded`
- `retryable`
- `limit`, `cursor`

### Worker Heartbeat

Scheduled processes should write machine-readable heartbeat state so agents can answer runtime questions:

- `worker_name`
- `worker_id`
- `pid`
- `status`
- `started_at`
- `last_heartbeat_at`
- `last_tick_started_at`
- `last_tick_finished_at`
- `last_error`
- counters from the last tick: users claimed, media found, uploaded, skipped, failed

This can start as a PostgreSQL `worker_heartbeats` table. A file-based fallback is acceptable for local-only mode, but DB is better because MCP/API/status tooling can query it directly.

## Email Control

Email should be a connector, not a browser scrape by default.

Recommended provider order:

1. Gmail API OAuth connector for Gmail accounts.
2. IMAP/SMTP connector only if OAuth provider is not available.
3. Browser fallback only for UI-only mail providers and only under `browser.read`/`browser.control`.

Email data classes:

- Metadata: message ID, thread ID, from/to/cc/bcc, subject, labels, timestamps, attachment filenames.
- Body: plain/html content and attachment bytes.
- Mutation: send, reply, mark read/unread, label/archive/delete.

Default policy:

- `email.read_metadata`: can be granted to trusted local agent.
- `email.read_body`: narrower grant or per-task approval.
- `email.send` and delete/archive: require approval unless explicit automation grant exists.

## External API Control

External APIs should be registered connectors with:

- Name, base URL, auth type, secret reference.
- Allowed methods/path allowlist.
- Request and response redaction rules.
- Rate limit and retry policy.
- Idempotency requirements for mutating calls.
- Required capability, for example `api.invoke.github` or `api.invoke.google-drive`.

The agent should not receive raw connector secrets. The gateway signs/calls the API and returns a redacted result.

## Browser And Media Control

Browser control remains Chrome-extension backed:

- Extension owns browser session/cookies.
- Backend owns policy, audit, and routing.
- Backend still must not receive social cookies.
- Media upload still uses chunk proxy to Drive.

For large social crawl, pair this design with a media job queue:

- `media_download_jobs` table for per-media retry/backoff/dead-letter.
- `collector_jobs` table for user/profile discovery and platform pagination.
- Policy requires `media.enqueue` or `social.collect` plus target restrictions for TikTok, Instagram and Facebook; browser execution remains separately scoped.

## Data Model Additions

All control-plane tables live in schema `gateway`. Mezon runtime state lives in schema `bot` as defined by DESIGN-005 and ADR-003; this design does not add a third application schema.

Future implementation should add these durable `gateway` tables:

| Table | Purpose |
| --- | --- |
| `gateway.agents` | Registered caller identities |
| `gateway.agent_sessions` | Short-lived runtime sessions and revocation |
| `gateway.capability_grants` | Durable grants from owner to agent |
| `gateway.policy_rules` | Optional allow/deny/approval rules |
| `gateway.connector_accounts` | Later email/API provider account records without raw secrets |
| `gateway.connector_secrets` | Secret references or encrypted local secrets |
| `gateway.audit_events` | Redacted immutable action log |
| `gateway.collector_jobs` | Bounded profile/following collection lifecycle |
| `gateway.media_download_jobs` | Per-media download/upload retry queue |
| `gateway.media_download_attempts` | Immutable per-attempt stage/error history |
| `gateway.worker_heartbeats` | Latest runtime status per worker/process |

The first implementation slice in TICKET-011 consumes the social/media tables created by TICKET-008/009. Email and arbitrary connector tables are not required to complete TICKET-011.

## Security Rules

- Deny by default for new agents, connectors, and capabilities.
- Never expose raw OAuth refresh tokens, cookies, API keys, CSRF tokens, or email bodies in logs.
- Require scoped session tokens instead of reusing `BROWSER_BRIDGE_AUTH_TOKEN` for every caller.
- Redact page snapshots/email bodies unless caller has content-level scope.
- Mutating email/API/bot actions should support dry-run and idempotency keys.
- Admin policy changes require `admin.policy`.
- Keep global emergency Off switch for all browser control.

## Migration Plan

1. Complete TICKET-008/009 so `gateway` schema, durable media jobs and worker heartbeat exist.
2. Keep v0.1 shared-token mode as `personal_legacy`.
3. Add policy tables and a local bootstrap admin agent in `gateway`.
4. Wrap social/media status and mutation routes with policy checks and audit writes.
5. Expose `bb_*` social/media MCP tools while keeping current browser compatibility aliases.
6. Add approval flow for high-risk mutations.
7. Implement email metadata and generic external API connectors only as later separately approved tickets.

## Alternatives Considered

| Alternative | Benefit | Rejection reason |
| --- | --- | --- |
| Keep one shared token forever | Simple | Too coarse once email/API mutations are in scope |
| Let agent use raw provider tokens directly | Flexible | Secrets leak into prompts/logs/tools and cannot be centrally audited |
| Browser-only control for email/APIs | Uniform runtime path | Less reliable than provider APIs and harder to permission by data class |
| Full multi-tenant SaaS auth | Scalable | Overbuilt for owner-local project right now |

## Impact

- API: major new v2 gateway contract and compatibility strategy.
- MCP: new namespaced tools with explicit capability requirements.
- DB: new policy/audit/connector/job tables.
- Security: durable shift from all-powerful shared token to scoped grants.
- Runtime: additional gateway checks before provider calls.
- Docs: API, architecture, ERD, SDD, requirements, roadmap, validation matrix, and ADR must be reconciled if implemented.

## Verification Plan

- Unit: policy decision matrix, scope matching, redaction helpers, capability parsing.
- Integration: grant/session lifecycle, audit writes, denied command cannot reach provider, allowed command reaches fake provider.
- MCP contract: each tool declares required capability and returns structured denial.
- Email: fake Gmail/IMAP connector proves metadata/body/send scopes are separated.
- Browser: existing browser/media tests pass through policy wrapper.
- Security: logs do not contain tokens, cookies, email body, or raw page payload unless explicitly allowed and redacted in audit.
- UAT: owner grants local agent `browser.read`, `browser.control`, `email.read_metadata`; agent lists tabs, reads recent sent-email metadata, and invokes one configured safe API.

## Reconciliation Plan

- Implement through PHASE-004/TICKET-011 after approval and after TICKET-008/009 dependencies pass.
- Update architecture/API/ERD/SDD only when implementation begins.
- Accept [ADR-004](../../decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md) for the shift from shared-token-only to capability grants before implementation.
- Update validation matrix now as a planned design item.

## Approval Gate

- [x] Control-plane boundary and capability model complete.
- [x] Exact policy/session/grant/idempotency/audit schema complete.
- [x] HTTP and MCP contracts for social/media/worker/mlem bot complete.
- [x] Error, pagination, redaction, rate limit and compatibility behavior complete.
- [ ] Owner approves DESIGN-004 and the permission-model ADR before TICKET-011 execution.
