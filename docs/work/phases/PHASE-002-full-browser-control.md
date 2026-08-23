---
artifact_type: phase
id: PHASE-002
status: planned
owner: human
updated: 2026-08-20
---

# PHASE-002: Full browser control

## Goal

Hoàn thiện command surface để agent thao tác web tabs/windows thay người dùng trong giới hạn Chrome API.

## Planned tickets

| ID | Slice | Acceptance focus |
| --- | --- | --- |
| TICKET-002 | Observe/navigation | snapshot, screenshot, URL/title, navigate/history/wait |
| TICKET-003 | Input/runtime | click/hover/drag/type/key/select/scroll/evaluate |
| TICKET-004 | Browser extras | windows, dialogs, files, downloads, console/network events |

## Success criteria

- E2E không qua MCP: open -> navigate -> snapshot -> click/type -> evaluate -> screenshot -> close.
- Unsupported protected target trả lỗi rõ.
- On/Off detach debugger và ngừng lệnh ngay.

