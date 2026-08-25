---
artifact_type: ticket
id: TICKET-009
status: draft
owner: shared
priority: high
lane: high-risk
approval: pending
updated: 2026-08-23
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-009
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  requirement: FR-019, NFR-011
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  detail_design: docs/work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md
  detail_design_annexes:
    - docs/work/designs/DESIGN-005-DATABASE.md
    - docs/work/designs/DESIGN-005-FLOWS.md
  test_verification: planned queue, retry and Drive integration tests
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs:
    - docs/decisions/ADR-002-browser-media-drive-boundary.md
    - docs/decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-009: Durable media jobs, failure recovery, and fixed Drive folder

## Context and scope

Current worker retries at profile level and records errors in user metadata. Add durable per-media jobs/attempts so an agent can see exactly which image/video failed and safely retry it. Enforce one configured Drive destination and persist the provider IDs needed for tracking.

In scope: `gateway.media_download_jobs`, `gateway.media_download_attempts`, claim leases, retry/backoff/dead state, worker heartbeat, fixed folder validation, `drive_file_id` and `drive_folder_id` persistence, status lookup and tests.

Out of scope: extractor implementation, Drive file deletion, moving existing Drive files, multi-folder routing, copying social credentials to backend, and public agent API/MCP endpoints.

## Acceptance criteria

- [ ] Unique enqueue by `(platform, source_user_id, media_id)` prevents duplicate active/successful jobs.
- [ ] Retryable failures enter `retry_wait` with bounded exponential backoff and immutable attempt logs.
- [ ] Stale claims recover; max attempts move jobs to `dead`; manual retry is idempotent and audited.
- [ ] Non-retryable policy/validation/private/deleted-media failures do not loop automatically.
- [ ] Worker heartbeat exposes last tick, counts, queue lag and redacted last error.
- [ ] Social pipeline refuses to start without `GOOGLE_DRIVE_FOLDER_ID`.
- [ ] A request with a conflicting folder returns `DRIVE_FOLDER_MISMATCH`.
- [ ] Successful upload stores `drive_file_id`, `drive_folder_id`, link, source metadata and job/asset relationship.

## Impact and approval

- Small task exemption: no.
- Impact checked: API=yes, DB=yes, Security=yes, Runtime=yes, Standards=no.
- Dependency: TICKET-008.
- Detail design: [DESIGN-005](../designs/DESIGN-005-two-schema-resilient-social-pipeline.md), approval pending.

## Verification plan

- Unit: state transitions, retry classification, backoff/jitter bounds, claim expiry and idempotency.
- Integration: PostgreSQL concurrent claims; fake extension disconnect/429/5xx/Drive transient; success stores both Drive IDs.
- E2E: fake bridge completes one job and dead-letters one controlled non-retryable job.
- Live UAT: one temporary network failure resumes to the configured Drive folder without duplicate files.

## Normative contract

- [Database contract](../designs/DESIGN-005-DATABASE.md)
- [Runtime and failure flow](../designs/DESIGN-005-FLOWS.md)
- Retry defaults: five attempts, 30-second exponential base, six-hour cap, jitter, `Retry-After` support, 30-minute renewable lease.
- Job completion atomically links one normalized identity, Drive file/folder IDs and one gateway media asset.

## Completion state

- Implementation: not started.
- UAT: required.
- Docs reconciliation required: API, ERD, SDD, architecture, deployment, context, validation matrix and changelog.

## Progress checklist

- [x] Feedback, phase, design, ADR and backlog trace created.
- [ ] TICKET-008 verified; detail design approved; ticket moved to `ready`.
- [ ] Queue/retry/folder/Drive tracking implementation complete.
- [ ] Tests/verification results and fix-cycle counts recorded.
- [ ] Controlled-failure and real Drive UAT signed off.
- [ ] Master docs, validation matrix, context, backlog and changelog reconciled.
