---
artifact_type: phase
id: PHASE-003
status: planned
owner: human
updated: 2026-08-23
---

# PHASE-003: Agent integration and packaging

## Goal

Cho AI agent dùng browser tools ổn định và người dùng cá nhân cài/chạy lại được.

## Planned tickets

| ID | Slice | Acceptance focus |
| --- | --- | --- |
| TICKET-005 | MCP adapter + E2E | MCP golden flow trên Chrome thật |
| TICKET-006 | Reliability/package | restart/suspend/reconnect, build, setup docs, platform smoke |
| TICKET-007 | Social media worker + mlem Mezon bot live UAT | browser-backed social scrape, Drive/DB upload, `mlem` command, Mezon media card buttons |

## Success criteria

- MCP client chạy golden flow end-to-end.
- Server/Chrome restart tự phục hồi connection.
- Một lệnh build server và extension; README đủ để cài lại trên máy mới.
- Social/Mezon flow chạy live với Chrome extension connected, Drive folder configured, Mezon channel/admin configured, `mlem` bot command configured, và identity Mezon/social tách riêng.
