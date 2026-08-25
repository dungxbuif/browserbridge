---
artifact_type: traceability_matrix
id: TRACEABILITY
status: active
owner: shared
updated: 2026-08-24
---

# Traceability

| Requirements | Phase | Tickets | Design/ADR | Verification |
| --- | --- | --- | --- | --- |
| FR-001..005, FR-013, FR-016 | PHASE-001 | TICKET-001 | DESIGN-001, ADR-001 | Go unit/transport/server tests pass; Chrome UAT pending; DOCS-REVIEW-001 |
| FR-006..012, FR-014 | PHASE-002 | TICKET-002..003 | DESIGN-001, API master | planned unit + integration + E2E |
| FR-010, FR-017, NFR-009 | PHASE-002 | TICKET-004 | DESIGN-002, ADR-002 | Go upload-session/Drive tests pass; JS syntax pass; Chrome/Drive UAT pending |
| FR-015, NFR-001..008 | PHASE-003 | TICKET-005..006 | SDD-001 | planned MCP E2E + platform smoke |
| FR-018, NFR-010 | PHASE-004 | TICKET-008 | DESIGN-005 + DATABASE annex, ADR-003 | planned migration/backfill/idempotency/DB-flow verification |
| FR-019, NFR-011 | PHASE-004 | TICKET-009 | DESIGN-005 + DATABASE/FLOWS annexes, ADR-002, ADR-003 | planned queue/retry/fixed-folder/Drive tracking verification |
| FR-020, NFR-010 | PHASE-004 | TICKET-010 | DESIGN-005-FLOWS, ADR-002 | planned normalized fixtures + fake bridge + live platform UAT |
| FR-021, NFR-012 | PHASE-004 | TICKET-012 | DESIGN-006 + ADR-005 (accepted) | planned API-key/cache/read-endpoint/redaction tests and owner issue-revoke UAT |
| FR-021, NFR-012 | PHASE-004 | TICKET-011 *(deferred)* | DESIGN-004 + API annex, ADR-004 *(deferred)* | deferred with ADR-005 on 2026-08-24; reactivate for multi-agent, untrusted-caller or non-localhost deployments |

Master requirement source: [SPEC.md](../requirements/SPEC.md).
