---
artifact_type: adr
id: ADR-001
status: accepted
owner: shared
date: 2026-08-20
---

# ADR-001: Simple personal browser control

## Context

Owner xác nhận đây là dự án cá nhân: extension khởi động là có thể điều khiển toàn bộ trình duyệt thay người dùng và không cần workflow phức tạp.

## Decision

- Một Go process cung cấp WSS command router và MCP adapter.
- Một Manifest V3 extension JavaScript ES module tự kết nối/reconnect.
- Shared token cấu hình một lần và global `Enable control` On/Off.
- Khi On, extension điều khiển mọi web tab/window được Chrome API cho phép; không per-tab grant/approval.
- Dùng Chrome APIs/CDP với quyền mạnh, gồm trusted JavaScript evaluate.
- State nằm trong memory; không database, account, tenant, pairing, audit system hoặc message broker trong MVP.
- MVP dùng unpacked extension. Không cần local companion process/offscreen document.
- Không dùng third-party runtime/build dependency ở MVP: Go WebSocket transport tối thiểu dùng standard library và extension được Chrome load trực tiếp.

## Alternatives rejected for MVP

- SaaS control plane với workspace/user/role/pairing/audit: trái mục tiêu đơn giản.
- SQLite/PostgreSQL: chưa có state cần persist ngoài extension config.
- Local Node/native bridge: thêm tiến trình cài đặt không cần thiết.
- Per-tab consent/single-writer workflow: không phù hợp personal trusted mode.

## Consequences

- Positive: ít code, ít vận hành, đạt vertical slice nhanh.
- Negative: token có toàn quyền; ai lấy được token có thể điều khiển browser khi On.
- Negative: quyền extension rộng; chỉ nên cài source/build tin cậy và không expose server công khai thiếu TLS/firewall.
- Neutral: Chrome vẫn giới hạn browser UI/protected pages/OS dialogs.

## Revisit triggers

Chỉ thêm account/pairing/database/permissions khi có nhiều người dùng, nhiều trust boundary, nhu cầu history/audit hoặc nhiều backend instance.
