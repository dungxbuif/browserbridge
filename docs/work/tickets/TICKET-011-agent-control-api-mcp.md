---
artifact_type: ticket
id: TICKET-011
status: deferred
owner: shared
priority: low
lane: blocked
approval: pending
updated: 2026-08-24
deferred_by: docs/decisions/ADR-005-single-scope-api-keys-with-redis-cache.md
superseded_for_now_by: docs/work/tickets/TICKET-012-agent-api-key-and-read-api.md
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-011
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  requirement: FR-021, NFR-012
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  detail_design: docs/work/designs/DESIGN-004-agent-control-api-mcp-permissions.md
  detail_design_annex: docs/work/designs/DESIGN-004-API.md
  test_verification: planned policy, HTTP and MCP contract tests
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs:
    - docs/decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-011: Agent control API, MCP, permissions, and observability

> **Deferred on 2026-08-24 by [ADR-005](../../decisions/ADR-005-single-scope-api-keys-with-redis-cache.md).**
> The owner chose the much smaller single-scope API key model in
> [TICKET-012](TICKET-012-agent-api-key-and-read-api.md). This ticket is not scheduled and
> its migration `0006` is not planned. Reactivate only if the deployment gains multiple
> agents, untrusted callers, a non-localhost bind, or a requirement for an audit trail.

## Context and scope

The owner wants the agent to query collected users, crawl/media errors and worker state, then trigger/retry/cancel jobs without manual SQL or shell commands. Add the gateway control surface after durable schema/job contracts exist.

In scope: scoped agent sessions/grants, policy checks, redacted audit events, correlated operational error events, status/users/jobs/workers/errors HTTP endpoints, matching MCP tools, enqueue/retry/cancel operations, structured errors and compatibility with current browser tools.

Out of scope: email connectors and arbitrary external API connectors in this ticket; they remain later slices in DESIGN-004. Also out of scope: raw secret access and direct DB credentials for agents.

## Acceptance criteria

- [ ] Agent can query aggregate social/media status, paginated users, media jobs/attempts and worker heartbeat.
- [ ] Agent can enqueue a bounded collector job, retry a dead media job and cancel a pending job using idempotency keys.
- [ ] Read and mutation capabilities are separate; denied mutations never reach worker/Drive/extension.
- [ ] Every mutation writes a redacted audit event with agent, capability, target, decision and result.
- [ ] Every actionable runtime failure identifies component/stage with a stable code and trace ID, links to applicable job/attempt/audit records, and is queryable under `ops.read` without exposing raw provider data.
- [ ] MCP exposes `bb_social_status`, `bb_social_users_list`, `bb_media_jobs_list`, `bb_worker_status`, `bb_media_enqueue_download`, `bb_media_retry_job` and `bb_media_cancel_job`.
- [ ] MCP exposes `bb_errors_list` and `bb_error_get`; the same error query services back HTTP and MCP.
- [ ] MCP is the primary agent control surface; an optional skill contains workflows only, and no API/session/provider key is stored in skill files or tool parameters.
- [ ] API supports lookup by `drive_file_id` without returning OAuth/social credentials.
- [ ] Agent can enqueue one mlem send, list sent media/interactions, and archive bot delivery state under separate `bot.read`, `bot.send`, and `bot.moderate` capabilities.
- [ ] Existing personal shared-token browser flow remains available during migration under a documented compatibility mode.

## Impact and approval

- Small task exemption: no.
- Impact checked: API=yes, DB=yes, Security=yes, Runtime=yes, Standards=no.
- Dependencies: TICKET-008, TICKET-009; platform-specific views depend on TICKET-010.
- Detail design: [DESIGN-004](../designs/DESIGN-004-agent-control-api-mcp-permissions.md), approval pending.

## Verification plan

- Unit: policy matrix, capability parsing, cursor/filter validation, redaction, trace propagation and idempotency.
- Integration: fake worker/store proves allowed calls run, denied calls do not, audit is written, and failures create linked operational error events with the correct component/stage.
- MCP contract: structured status/errors and exact capability declaration per tool.
- UAT: owner asks the agent for user counts/list, failed media, worker health, then retries one controlled dead job.

## Normative contract

- [Agent HTTP/MCP contract](../designs/DESIGN-004-API.md)
- [ADR-004](../../decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md) must be accepted before implementation.
- HTTP and MCP use the same policy/idempotency/audit services; legacy browser token cannot call new agent mutation routes.

## Completion state

- Implementation: not started.
- UAT: required.
- Docs reconciliation required: API, architecture, ERD, SDD, permission ADR, context, validation matrix and changelog.

## Progress checklist

- [x] Feedback, phase, design and backlog trace created.
- [ ] TICKET-008/009 verified; DESIGN-004 approved; permission ADR accepted; ticket moved to `ready`.
- [ ] HTTP/MCP/policy/audit implementation complete.
- [ ] Unit/integration/MCP verification and fix-cycle counts recorded.
- [ ] Owner-agent query/retry UAT signed off.
- [ ] Master docs, validation matrix, context, backlog and changelog reconciled.
