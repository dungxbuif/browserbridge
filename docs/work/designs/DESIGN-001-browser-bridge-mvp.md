---
artifact_type: detail_design
id: DESIGN-001
status: approved
owner: shared
approval: approved
updated: 2026-08-20
---

# DESIGN-001: Personal Browser Bridge MVP

## Scope decision

Personal trusted mode, one server/owner, shared token, global On/Off, full supported browser control. Không account/pairing/grant/audit/database.

## Implementation order

1. Tạo Go module/server config, WSS endpoint và protocol envelopes.
2. Tạo MV3 JavaScript ES module extension với service worker/options/popup, không cần build tool.
3. Handshake/auth/capabilities, heartbeat/reconnect và On/Off.
4. Vertical slice `tabs.list` với unit/integration/manual evidence.
5. Mở rộng observe/navigation rồi input/evaluate rồi browser extras.
6. Thêm MCP adapter, golden E2E và packaging.

## Boundaries

- Server modules: `config`, `protocol`, `transport`, `router`, `mcp`.
- Extension modules: `config`, `transport`, `dispatcher`, `chrome-adapter`, `ui`.
- WSS protocol là boundary; không share runtime code Go/TS, chỉ share JSON fixtures/schema.
- Chrome adapter trả normalized result/error, không để raw CDP error xuyên thẳng vào public contract.

## Test plan

- Unit: schema/auth/state/deadline/ref/error normalization.
- Integration: WSS handshake/reconnect/correlation/cancel.
- E2E: Chrome thật golden flow.
- Manual: restart, service-worker suspend, On/Off, protected pages và DevTools conflict.
- Security: bad token, token/log redaction, oversized payload.

## Gate

Design đã được đơn giản hóa và chấp thuận theo chỉ đạo owner ngày 2026-08-20. [TICKET-001](../tickets/TICKET-001-connected-skeleton.md) sẵn sàng execution.
