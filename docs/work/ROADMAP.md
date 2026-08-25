---
artifact_type: roadmap
id: ROADMAP
status: active
owner: human
updated: 2026-08-23
---

# Roadmap

Thứ tự được chốt theo nguyên tắc: kết nối được trước, điều khiển đủ sau, tích hợp agent và đóng gói cuối.

| Milestone | Kết quả | Trạng thái | Phase |
| --- | --- | --- | --- |
| M1 | Extension tự online và server gọi được `tabs.list` | ready | [PHASE-001](phases/PHASE-001-connected-skeleton.md) |
| M2 | Agent API điều khiển đầy đủ web tabs/windows | planned | [PHASE-002](phases/PHASE-002-full-browser-control.md) |
| M3 | MCP E2E, reliability, docs và package dùng cá nhân | planned | [PHASE-003](phases/PHASE-003-agent-integration.md) |
| M4 | Agent gateway có hai schema, media retry queue, ba platform collector và API/MCP quan sát/điều khiển | draft | [PHASE-004](phases/PHASE-004-resilient-agent-gateway.md) |

## Plan chốt

1. Phase 1 — 1 vertical slice: Go WSS server + MV3 extension + config/token + auto reconnect + On/Off + `tabs.list`.
2. Phase 2 — thêm capability theo nhóm: observe/navigation, input/runtime, windows/dialog/files/downloads/events.
3. Phase 3 — MCP tools, E2E Chrome thật, reconnect/suspend tests, Linux package; Windows/macOS smoke test.
4. Phase 4 — migrate `gateway`/`bot`, thêm durable media jobs, đạt parity TikTok/Instagram/Facebook, rồi expose agent API/MCP có permission/audit.

Phase 1-3 giữ trusted personal mode. Phase 4 bổ sung database namespace và scoped agent permissions vì owner đã mở rộng yêu cầu sang durable jobs và agent control; vẫn không thêm multi-tenant SaaS hay microservice không cần thiết.
