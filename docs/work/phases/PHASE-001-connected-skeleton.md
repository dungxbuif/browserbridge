---
artifact_type: phase
id: PHASE-001
status: in_review
owner: human
updated: 2026-08-20
---

# PHASE-001: Connected skeleton

## Goal

Chứng minh đường chạy thật nhỏ nhất: khởi động Chrome -> extension tự nối server -> server yêu cầu -> extension trả danh sách tabs.

## Scope

- Monorepo layout `server/`, `extension/`, shared protocol fixtures.
- Go WSS endpoint, shared token handshake, heartbeat và pending command map.
- MV3 manifest/service worker/options/popup.
- Lưu URL/token/enable, auto-connect/reconnect, connection status và global On/Off.
- Protocol `hello/welcome/ping/pong/command/result/error/status`.
- `browser.capabilities`, `browser.status`, `tabs.list`.

## Out of scope

Browser actions khác, MCP, database, account/pairing và production deployment.

## Work item

- [TICKET-001](../tickets/TICKET-001-connected-skeleton.md)

## Success criteria

- Load unpacked extension, cấu hình một lần rồi Chrome restart vẫn tự online.
- CLI/test client gọi `tabs.list` và nhận tab metadata.
- Token sai, Off, timeout và reconnect có evidence.

## Current evidence

- Go protocol, WebSocket frame transport and server authorization tests pass.
- Extension JavaScript syntax and manifest JSON parse pass.
- Real Chrome UAT remains required before the phase can be verified.
