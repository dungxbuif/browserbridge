---
artifact_type: phase
id: PHASE-004
status: draft
owner: shared
updated: 2026-08-24
trace:
  backlog: docs/work/BACKLOG.md
  roadmap: docs/work/ROADMAP.md
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  tickets:
    - TICKET-008
    - TICKET-009
    - TICKET-010
    - TICKET-012
  deferred_tickets:
    - TICKET-011
  designs:
    - DESIGN-005
    - DESIGN-005-DATABASE
    - DESIGN-005-FLOWS
    - DESIGN-006
  deferred_designs:
    - DESIGN-004
    - DESIGN-004-API
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  release_notes: docs/releases/CHANGELOG.md
  adrs:
    - ADR-003
    - ADR-005
  deferred_adrs:
    - ADR-004
---

# PHASE-004: Resilient agent gateway and social media pipeline

## Goal

Cho agent điều khiển, quan sát và phục hồi toàn bộ social-media pipeline qua API/MCP, với dữ liệu PostgreSQL tách thành hai schema `gateway` và `bot`.

## Planned tickets

| Order | Ticket | Slice | Exit condition |
| --- | --- | --- | --- |
| 1 | [TICKET-008](../tickets/TICKET-008-two-schema-migration.md) | Tách schema và migration ownership | Dữ liệu `public` được backfill/verify vào `gateway` và `bot`; runtime không còn tạo bảng chéo ownership |
| 2 | [TICKET-009](../tickets/TICKET-009-resilient-media-jobs-drive-folder.md) | Durable media queue, retry/dead-letter, fixed Drive folder | Mỗi media có job/attempt log; retry có backoff; thành công lưu `drive_file_id` và `drive_folder_id` |
| 3 | [TICKET-012](../tickets/TICKET-012-agent-api-key-and-read-api.md) | Agent API key + read API | Owner issue/revoke key bằng `bb-apikey`; agent đọc social user, media asset, bot post qua HTTP; revoke có hiệu lực ngay không restart |
| 4 | [TICKET-010](../tickets/TICKET-010-three-platform-collectors.md) | TikTok, Instagram, Facebook collectors | Ba adapter trả cùng normalized media contract và có fake-bridge/live UAT evidence |
| — | [TICKET-011](../tickets/TICKET-011-agent-control-api-mcp.md) | Agent control API/MCP, policy, audit | **Deferred** bởi ADR-005; không scheduled trong phase này |

## Dependency order

`TICKET-008 -> TICKET-009 -> TICKET-012 -> TICKET-010`.

TICKET-009 phải chạy ngay sau TICKET-008: TICKET-008 chủ động bỏ collector claim path
(`DESIGN-005-DATABASE.md` §3.2) và owner đã chấp nhận media worker ngừng hoạt động trong
khoảng giữa hai ticket. Không chạy live social collection trong khoảng đó.

TICKET-012 chỉ đọc `gateway`/`bot` nên có thể test bằng seeded store song song, nhưng
migration `0007` không được apply trước khi TICKET-008 `0001`-`0004` hoàn tất.

## Success criteria

- PostgreSQL chỉ có hai application schema: `gateway` và `bot`; `public` không còn là runtime write target sau migration.
- TikTok, Instagram và Facebook dùng browser session hiện tại, không đưa social cookie/token về backend.
- Media failure được retry có giới hạn, có attempt log và dead-letter để agent tra cứu/retry thủ công.
- Mọi media upload của pipeline vào đúng một folder cấu hình bởi `GOOGLE_DRIVE_FOLDER_ID`.
- `gateway.media_assets` lưu cả `drive_file_id` và `drive_folder_id` để tracking.
- Agent có thể hỏi số user, danh sách user, media asset và bot post qua HTTP với một API key thu hồi được.
- Owner revoke được key và request tiếp theo trả 401 mà không cần restart gateway.
- Deferred trong phase này (theo ADR-005): capability check, audit trail, MCP, correlated
  operational errors, trace ID theo stage, và agent-triggered mutation cho crawl/mlem send.

## Approval gate

- Lane: high-risk.
- Approval: pending cho [DESIGN-005](../designs/DESIGN-005-two-schema-resilient-social-pipeline.md) và [DESIGN-006](../designs/DESIGN-006-agent-api-key-and-read-api.md).
- Detailed contracts complete: [database/migration](../designs/DESIGN-005-DATABASE.md), [runtime/platform flows](../designs/DESIGN-005-FLOWS.md), and [agent API key/read API](../designs/DESIGN-006-agent-api-key-and-read-api.md).
- Auth decision pending acceptance: [ADR-005](../../decisions/ADR-005-single-scope-api-keys-with-redis-cache.md).
- Deferred, not scheduled: [DESIGN-004](../designs/DESIGN-004-agent-control-api-mcp-permissions.md), [DESIGN-004-API](../designs/DESIGN-004-API.md), [ADR-004](../../decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md).
- Chưa được implementation cho đến khi owner duyệt detail design.
