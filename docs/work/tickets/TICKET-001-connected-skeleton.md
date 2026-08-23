---
artifact_type: ticket
id: TICKET-001
status: in_review
owner: human
priority: high
lane: high-risk
updated: 2026-08-20
---

# TICKET-001: Connected skeleton

## Context

Tạo vertical slice nhỏ nhất cho personal Browser Bridge. Đây là ticket runtime đầu tiên và ảnh hưởng auth/transport, nên implementation phải bám DESIGN-001/ADR-001.

## Acceptance criteria

- [ ] Go server start với listen address và token từ environment.
- [ ] MV3 extension có options nhập URL/token và popup On/Off/status.
- [ ] Extension enable thì tự WSS handshake, heartbeat và reconnect sau server/Chrome restart.
- [ ] Server gửi `tabs.list`, nhận structured result có tab ID, window ID, URL, title, active.
- [ ] Token sai không kết nối; token không xuất hiện trong URL/log.
- [ ] Off đóng connection, detach debugger và command trả `CONTROL_DISABLED/NOT_CONNECTED`.
- [ ] Unit/integration test protocol/auth/state và manual Chrome verification được ghi lại.
- [ ] README có hướng dẫn build/run/load unpacked/configure.

## Scope

- `server/`, `extension/`, protocol schemas/fixtures và build/test config cần thiết.
- Không triển khai action ngoài `tabs.list` và status/capabilities.

## Trace

- Requirement: FR-001..005, FR-013, FR-016.
- Phase: [PHASE-001](../phases/PHASE-001-connected-skeleton.md).
- Design: [DESIGN-001](../designs/DESIGN-001-browser-bridge-mvp.md).
- ADR: [ADR-001](../../decisions/ADR-001-browser-control-foundation.md).
- Validation: [VALIDATION_MATRIX](../VALIDATION_MATRIX.md).

## Test expectations

- Unit: token compare wrapper, envelope validation, config/state transitions, reconnect delay.
- Integration: real WSS handshake, bad token, command correlation/timeout/disconnect.
- Manual: load unpacked Chrome, restart server/browser, On/Off và `tabs.list`.
- UAT: required; owner xác nhận extension tự online và có thể tắt ngay.

## Implementation progress

- Created: Go standard-library WebSocket server, shared-token handshake, active connection router, `GET /v1/tabs` debug route, protocol/transport/server tests.
- Created: MV3 JavaScript ES module extension, options/popup, local config, On/Off, heartbeat/reconnect and `tabs.list` dispatcher. Load `extension/` directly as unpacked.
- Dependency decision: no third-party runtime/build dependency in Phase 1; this removes blocked network dependency resolution.
- Verification: `gofmt` completed; `GOCACHE=/tmp/browser-bridge-go-cache go test -count=1 ./...` passed. `node --check` passed for all extension JavaScript and `manifest.json` parsed successfully.
- Pending UAT: owner needs to load unpacked extension, configure token, then run the README `curl` check against a real Chrome profile.
- Docs review: [DOCS-REVIEW-001](../reviews/DOCS-REVIEW-001-phase-1.md) verified.
