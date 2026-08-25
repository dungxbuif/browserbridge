---
artifact_type: requirements_index
id: REQUIREMENTS
status: approved
owner: shared
updated: 2026-08-23
---

# Requirements Index

Nguồn chuẩn: [SPEC.md](SPEC.md).

| Nhóm | IDs | Phase |
| --- | --- | --- |
| Config/connect/control | FR-001..005, FR-013, FR-016 | PHASE-001 |
| Full browser control | FR-006..012, FR-014 | PHASE-002 |
| Browser media to Drive | FR-017, NFR-009 | PHASE-002 |
| Agent integration | FR-015 | PHASE-003 |
| Gateway/bot schema ownership | FR-018, NFR-010 | PHASE-004 (planned) |
| Resilient media jobs and fixed Drive destination | FR-019, NFR-011 | PHASE-004 (planned) |
| TikTok/Instagram/Facebook collectors | FR-020, NFR-010 | PHASE-004 (planned) |
| Agent control API/MCP, permissions and correlated error visibility | FR-021, NFR-012 | PHASE-004 (planned) |
| Quality/security/compatibility | NFR-001..012 | xuyên suốt |

Baseline v0.1: personal trusted mode, một server/owner, shared token và global On/Off. PHASE-004 planned bổ sung scoped agent grants, durable jobs và hai PostgreSQL schema, nhưng không chuyển thành multi-tenant SaaS.
