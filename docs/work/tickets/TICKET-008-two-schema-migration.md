---
artifact_type: ticket
id: TICKET-008
status: draft
owner: shared
priority: high
lane: high-risk
approval: pending
updated: 2026-08-24
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-008
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  requirement: FR-018, NFR-010
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  detail_design: docs/work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md
  detail_design_annex: docs/work/designs/DESIGN-005-DATABASE.md
  test_verification: planned migration and DB-flow tests
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs:
    - docs/decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-008: Migrate PostgreSQL to `gateway` and `bot` schemas

## Context and scope

Current server and bot migrations both create unqualified tables in `public`. Introduce versioned, schema-qualified migrations and a single DDL owner without losing existing data.

Owner confirmed this is a development environment with no existing Drive media files.
Migration must assert that condition; unexpected legacy media rows block execution rather
than receiving fabricated folder metadata.

A read-only preflight on 2026-08-24 confirmed all seven legacy tables are empty
(`social_users`, `media_assets`, `mezon_users`, `media_reactions`, `media_archives`,
`bot_media_posts`, `bot_event_dedup` = 0 rows each). Backfill is therefore a no-op in this
environment and the platform check constraint cannot abort on existing data. The backfill
SQL is still required so `migrate-legacy` can seed and prove the invariants.

In scope: create two schemas, migrate existing rows/IDs, schema-qualify runtime queries,
separate migration ownership, keep old tables for rollback, update DB verifiers, write
`drive_folder_id` on every asset insert, and create the paired
`bot.media_delivery_state` row inside `SaveMediaAsset`.

Out of scope: dropping `public` tables, separate databases, schema-specific DB users,
media retry behavior, `gateway.collector_jobs`, platform extractor changes, and agent API
endpoints.

## Owner-accepted collector outage

`DESIGN-005-DATABASE.md` §3.2 removes `scrape_claim_id` and `scrape_claimed_at` from
`gateway.social_users`, but their replacement `gateway.collector_jobs` does not exist until
TICKET-009 migration `0005`. The options were presented to the owner, who chose to accept
the outage rather than retain the columns temporarily or merge TICKET-009 into this ticket.

Consequences, accepted:

- `nextSocialUsersForScrape` (`bot/src/store.js:301-331`) has no claim mechanism, so
  `bot/src/media-worker-core.js:27` cannot claim social users. The media worker is
  non-functional from cutover until TICKET-009 completes.
- `tools/verify_worker_db_flow.mjs` and `tools/verify_social_once_flow.mjs` cannot pass and
  are excluded from this ticket's acceptance criteria and verification plan.
- `scripts/doctor.sh` reports failure at those two steps by design during the window.
- Live social collection must not be attempted between TICKET-008 and TICKET-009.

TICKET-009 is consequently mandatory repair work, not optional follow-up, and must be the
next ticket executed.

## Acceptance criteria

- [ ] Migration creates only the planned `gateway` and `bot` application schemas and is idempotent.
- [ ] Gateway tables include social/media/control-plane state; bot tables include only Mezon state.
- [ ] Existing IDs, row counts, unique business keys, reactions, archives and post history survive backfill.
- [ ] Bot no longer creates or alters gateway-owned tables, and `server/internal/store` no longer runs DDL; only `tools/migrate_db.mjs` applies versioned SQL.
- [ ] Gateway startup verifies the minimum applied schema version and refuses to start on a partial version.
- [ ] Runtime reads/writes use schema-qualified names, proved by a static check that rejects unqualified application table names.
- [ ] `SaveMediaAsset` writes a non-empty `drive_folder_id` and creates the paired `bot.media_delivery_state` row in the same transaction; an unconfigured Drive folder is rejected with `503` instead of persisting an asset.
- [ ] Migration, bot DB flow and social import verifiers pass twice against the migrated database.
- [ ] Original `public` tables remain available read-only for a documented rollback window; no destructive cleanup occurs.
- [ ] Preflight proves legacy `media_assets` is empty; non-empty result returns `LEGACY_MEDIA_RECONCILIATION_REQUIRED` and performs no cutover.
- [ ] UAT requirement: not_required for data preservation because all legacy tables are empty; required only as the migration/rollback rehearsal recorded below.

Explicitly excluded by the owner-accepted collector outage above:

- `tools/verify_worker_db_flow.mjs` passing.
- `tools/verify_social_once_flow.mjs` passing.
- `scripts/doctor.sh` exiting clean end to end.
- Media worker starting or claiming social users.

## Impact and approval

- Small task exemption: no.
- Impact checked: API=no, DB=yes, Security=yes, Runtime=yes, Standards=no.
- Detail design: [DESIGN-005](../designs/DESIGN-005-two-schema-resilient-social-pipeline.md), approval pending.
- Blocks: [TICKET-009](TICKET-009-resilient-media-jobs-drive-folder.md) becomes mandatory repair work, and [TICKET-012](TICKET-012-agent-api-key-and-read-api.md) cannot start until this ticket is `verified`.

## Verification plan

- Integration: migrate a seeded current schema, compare IDs/counts/business keys, run migration twice.
- Regression: run server store tests, `verify_bot_db_flow`, `verify_social_user_import` and the migration verifier. Worker verifiers are excluded per the accepted collector outage.
- Static: schema-qualification check over `server/internal`, `bot/src` and `tools`.
- Pairing: prove one `bot.media_delivery_state` row per `gateway.media_assets` row and that repeated upserts do not duplicate it.
- Manual: inspect `information_schema` ownership and confirm no runtime writes land in `public`.
- Rollback rehearsal: drop compatibility views, rename legacy tables back, confirm previous binaries start.

## Normative contract

- [Database and migration contract](../designs/DESIGN-005-DATABASE.md)
- Required migration order: `0001` schemas/core tables, `0002` legacy backfill, `0003` constraints/indexes, `0004` read-only compatibility views.
- Rollback after new writes requires reverse-sync and bidirectional verification; no automatic destructive rollback.

## Completion state

- Implementation: not started.
- UAT: migration/rollback rehearsal required. Data-preservation UAT is not required because all legacy tables were verified empty on 2026-08-24.
- Docs reconciliation required: ERD, SDD, architecture, deployment, context, validation matrix and changelog.
- Known incomplete-by-design state at hand-off: media worker non-functional until TICKET-009. Record this in `docs/CONTEXT.md` at hand-off so it is not mistaken for a regression.

## Progress checklist

- [x] Feedback, phase, design, ADR and backlog trace created.
- [ ] Detail design approved and ticket moved to `ready`.
- [ ] Migration implementation and rollback proof complete.
- [ ] Tests/verification results and fix-cycle counts recorded.
- [ ] Existing-data UAT signed off.
- [ ] Master docs, validation matrix, context, backlog and changelog reconciled.
