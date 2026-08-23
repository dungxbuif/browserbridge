---
artifact_type: roadmap
id: ROADMAP
status: active
owner: human
updated: 2026-08-20
---

# Roadmap

Thứ tự được chốt theo nguyên tắc: kết nối được trước, điều khiển đủ sau, tích hợp agent và đóng gói cuối.

| Milestone | Kết quả | Trạng thái | Phase |
| --- | --- | --- | --- |
| M1 | Extension tự online và server gọi được `tabs.list` | ready | [PHASE-001](phases/PHASE-001-connected-skeleton.md) |
| M2 | Agent API điều khiển đầy đủ web tabs/windows | planned | [PHASE-002](phases/PHASE-002-full-browser-control.md) |
| M3 | MCP E2E, reliability, docs và package dùng cá nhân | planned | [PHASE-003](phases/PHASE-003-agent-integration.md) |

## Plan chốt

1. Phase 1 — 1 vertical slice: Go WSS server + MV3 extension + config/token + auto reconnect + On/Off + `tabs.list`.
2. Phase 2 — thêm capability theo nhóm: observe/navigation, input/runtime, windows/dialog/files/downloads/events.
3. Phase 3 — MCP tools, E2E Chrome thật, reconnect/suspend tests, Linux package; Windows/macOS smoke test.

Không thêm database, account, pairing, per-tab permission hoặc microservice trừ khi nhu cầu cá nhân thực tế chứng minh cần.

