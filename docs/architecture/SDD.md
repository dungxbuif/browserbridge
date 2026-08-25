---
artifact_type: software_design_document
id: SDD-001
status: approved
owner: shared
approval: approved
updated: 2026-08-23
---

# SDD-001: Personal Browser Bridge MVP

## Outcome

Một Go process và một MV3 extension tạo đường điều khiển trực tiếp, tự phục hồi kết nối và không có persistence/control-plane phức tạp.

## Components

```text
MCP/HTTP caller -> Go router/WSS/Drive proxy <-WSS/shared token-> MV3 worker -> Chrome APIs/CDP/media fetch
```

- Server: config, WSS auth/heartbeat, one active connection, pending request map, media upload session map, MCP/HTTP tools.
- Drive proxy: Google OAuth token source, resumable session creation and ordered chunk forwarding.
- Extension JavaScript ES module: local config, On/Off, reconnect/heartbeat, capability report, command dispatcher.
- Chrome adapter: tabs/windows/navigation/observe/input/runtime/dialog/file/download/events/media fetch.

## Security model

Shared token là bearer secret toàn quyền. Token không vào URL/log, so sánh constant-time, WSS/TLS bắt buộc ngoài localhost. Off đóng transport/detach debugger. Không persist page payload. Media upload không đưa social cookies/token về backend; backend chỉ nhận raw bytes và Google OAuth secret. Đây là trusted personal mode, không phải multi-user authorization model.

## Resilience

Hai đầu enforce deadline; bounded message/queue; reconnect exponential backoff+jitter; không replay command có kết quả không xác định; protected target/DevTools conflict trả error có cấu trúc. Media upload session chỉ nhận chunk tuần tự và mất khi server restart.

## Delivery

1. Connected skeleton.
2. Full browser control.
3. MCP E2E/reliability/package.

Chi tiết contract nằm tại [API.md](API.md), plan tại [ROADMAP.md](../work/ROADMAP.md), decision tại [ADR-001](../decisions/ADR-001-browser-control-foundation.md) và [ADR-002](../decisions/ADR-002-browser-media-drive-boundary.md).

## Planned SDD-002 boundary

PHASE-004 is not part of the implemented MVP above. Its approved direction is documented in [DESIGN-004](../work/designs/DESIGN-004-agent-control-api-mcp-permissions.md), [DESIGN-005](../work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md), and [ADR-003](../decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md): two PostgreSQL schemas, durable per-media jobs, one fixed Drive folder, TikTok/Instagram/Facebook adapters, scoped/audited agent API/MCP, and trace-correlated operational errors. MCP is the executable agent surface; optional skills are secret-free workflow guidance. This section must be consolidated into a new implemented SDD only after the corresponding tickets pass verification.

Implementation detail is complete in [DESIGN-005-DATABASE](../work/designs/DESIGN-005-DATABASE.md), [DESIGN-005-FLOWS](../work/designs/DESIGN-005-FLOWS.md), and [DESIGN-004-API](../work/designs/DESIGN-004-API.md). These remain planned contracts, not evidence of implemented behavior.
