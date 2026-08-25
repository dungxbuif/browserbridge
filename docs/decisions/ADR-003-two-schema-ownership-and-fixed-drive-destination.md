---
artifact_type: adr
id: ADR-003
status: accepted
owner: human
date: 2026-08-23
trace:
  requirement: FR-018, FR-019, NFR-010, NFR-011
  phase: PHASE-004
  tickets_or_bugs:
    - TICKET-008
    - TICKET-009
  detail_design: DESIGN-005
  master_docs:
    - docs/architecture/ARCHITECTURE.md
    - docs/architecture/ERD.md
    - docs/architecture/SDD.md
---

# ADR-003: Separate gateway and bot schemas and enforce one Drive destination

## Context

The current server and bot both create unqualified PostgreSQL tables in `public`. This duplicates migration ownership and makes it difficult for an agent to distinguish gateway/collector state from Mezon bot state. Social media uploads also accept an optional request-level Drive folder even though the owner wants one stable destination and durable Drive tracking.

## Decision

- Use exactly two application schemas in one PostgreSQL database: `gateway` for browser control, social users, collection/media jobs, media assets, policy and audit; `bot` for Mezon users, reactions, archives, posts, event dedup and send jobs.
- `bot` may read/reference `gateway.media_assets`, but it does not own gateway migrations.
- Social media uploads always target the backend-configured `GOOGLE_DRIVE_FOLDER_ID`. A conflicting request folder is rejected.
- Persist both Google Drive `file_id` and `folder_id` with every successful media asset and media job.
- Migrate existing `public` rows without deleting them in the same change; later cleanup requires a separate approved destructive migration.

## Alternatives considered

- Continue using `public`: rejected because ownership and migration boundaries remain implicit.
- Separate databases: rejected because one PostgreSQL database with schema boundaries is sufficient for the personal deployment.
- Let each upload choose its Drive folder: rejected because it makes tracking and bot retrieval inconsistent.
- Let the bot duplicate media metadata: rejected because it creates divergent source-of-truth records.

## Consequences

- Positive: clear ownership, schema-qualified APIs, safer migrations, simpler agent status queries, and stable Drive tracking.
- Negative: cross-schema migration and query updates are required; bot tests need schema-aware fixtures.
- Neutral: initial deployment can retain one DB role; schema-specific roles can be added later without changing table ownership.

## Linked work

- [PHASE-004](../work/phases/PHASE-004-resilient-agent-gateway.md)
- [DESIGN-005](../work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md)
- [Database contract](../work/designs/DESIGN-005-DATABASE.md)
- [Runtime flow contract](../work/designs/DESIGN-005-FLOWS.md)
- [TICKET-008](../work/tickets/TICKET-008-two-schema-migration.md)
- [TICKET-009](../work/tickets/TICKET-009-resilient-media-jobs-drive-folder.md)
