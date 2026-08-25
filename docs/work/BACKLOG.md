---
artifact_type: backlog
id: BACKLOG
status: active
owner: shared
updated: 2026-08-24
---

# Backlog

| Rank | ID | Lane | Title | Status | Phase | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TICKET-001 | high-risk | Connected skeleton | in_review | PHASE-001 | Unit tests passed; awaiting real-Chrome UAT |
| 2 | TICKET-002 | normal | Observe and navigation | planned | PHASE-002 | snapshot/screenshot/nav/wait |
| 3 | TICKET-003 | high-risk | Full input and trusted evaluate | planned | PHASE-002 | CDP input + JS evaluate |
| 4 | TICKET-004 | normal | Windows, dialogs, files, downloads, events | planned | PHASE-002 | capability-dependent |
| 5 | TICKET-005 | normal | MCP adapter and E2E | planned | PHASE-003 | real Chrome golden flow |
| 6 | TICKET-006 | normal | Reliability and personal packaging | planned | PHASE-003 | suspend/reconnect/docs/build |
| 7 | [TICKET-007](tickets/TICKET-007-social-media-worker-mezon-bot.md) | high-risk | Social media worker + mlem Mezon bot live UAT | in_review | PHASE-003 | Design chốt bot `mlem` với command `*mlem`; code and DB/Drive verifiers pass; live UAT still needs Mezon env and Chrome extension connection |
| 8 | [TICKET-008](tickets/TICKET-008-two-schema-migration.md) | high-risk | Migrate PostgreSQL to `gateway` and `bot` schemas | draft | PHASE-004 | First dependency; all 7 legacy tables verified empty 2026-08-24 so backfill is a no-op; scope now includes `drive_folder_id` and paired `bot.media_delivery_state`; approval pending |
| 9 | [TICKET-009](tickets/TICKET-009-resilient-media-jobs-drive-folder.md) | high-risk | Durable media retry queue + fixed Drive folder | draft | PHASE-004 | **Mandatory repair**, not optional: TICKET-008 intentionally removes the collector claim path, so the media worker is dead until this lands |
| 10 | [TICKET-012](tickets/TICKET-012-agent-api-key-and-read-api.md) | high-risk | Agent API key + read API | draft | PHASE-004 | Replaces TICKET-011 scope; single-scope key in `gateway.api_keys`, Redis cache from `dev-env`, `bb-apikey` CLI, 7 read endpoints; needs TICKET-008 `verified` |
| 11 | [TICKET-010](tickets/TICKET-010-three-platform-collectors.md) | high-risk | TikTok/Instagram/Facebook collector parity | draft | PHASE-004 | Depends on TICKET-008/009; reference media shapes only, never credential capture |
| 12 | [TICKET-011](tickets/TICKET-011-agent-control-api-mcp.md) | blocked | Agent control API/MCP, permissions, observability | deferred | PHASE-004 | Deferred by ADR-005; superseded for now by TICKET-012; migration `0006` unscheduled |

Priority trên giữ các UAT hiện tại trước, sau đó triển khai PHASE-004 theo dependency
`TICKET-008 -> TICKET-009 -> TICKET-012 -> TICKET-010`. Các item PHASE-004 đang ở `draft`
và chưa được execution trước khi owner duyệt detail design.

TICKET-009 được xếp ngay sau TICKET-008 vì TICKET-008 chủ động bỏ claim path của collector
(`DESIGN-005-DATABASE.md` §3.2) — owner đã chấp nhận media worker ngừng hoạt động trong
khoảng giữa hai ticket. Không chạy live social collection trong khoảng đó.

TICKET-011 và ADR-004/DESIGN-004 ở trạng thái `deferred`, không bị loại bỏ. Reactivate khi
có nhiều agent, caller không tin cậy, bind ra ngoài localhost, hoặc cần audit trail.
