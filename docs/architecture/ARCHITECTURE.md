---
artifact_type: architecture_doc
id: ARCH-MASTER
status: approved
owner: shared
updated: 2026-08-23
---

# Kiến trúc Personal Browser Bridge

## Nguyên tắc

Ưu tiên ít thành phần và chạy được nhanh cho một người dùng. Không xây control plane SaaS.

```text
MCP client / media worker / scripts
    |
    v
+---------------- Go process -------------------------+
| HTTP API | Command router | WSS | Drive proxy | DB |
+-----------------------------------------------------+
                         ^
                         | WSS + shared token
                         v
+--------------- Chrome extension -----------+
| MV3 worker | global On/Off | CDP/API/media  |
+--------------------------------------------+
                         |
                         v
               all supported web tabs
```

## Thành phần

| Component | Trách nhiệm |
| --- | --- |
| Go WSS endpoint | Auth shared token, handshake, heartbeat, route request/result/event |
| In-memory registry | Giữ connection hiện tại và pending request; mất khi server restart là chấp nhận được |
| In-memory media upload sessions | Giữ Google resumable upload URL, offset, status; không lưu media bytes |
| Google Drive proxy | Tạo resumable upload và forward raw chunks lên Drive |
| PostgreSQL catalog | Optional `media_assets`, `social_users`, bot reaction/archive/post tables |
| Media worker | Process Node độc lập đọc `social_users`, mở profile TikTok/Instagram qua BrowserBridge và dispatch media upload |
| Mezon bot | Process Node độc lập đọc `media_assets`, gửi media định kỳ, ghi reaction/archive |
| MCP adapter | Expose browser tools cho agent và map sang command |
| MV3 service worker | JavaScript ES module; auto-connect/reconnect, heartbeat, dispatch command, report capabilities |
| Options/popup | URL, token, global `Enable control`, connection status |
| Chrome adapter | `tabs`, `windows`, `debugger/CDP`, `scripting`, `downloads` |

## Runtime flow

1. Service worker đọc URL/token/enable từ `chrome.storage.local`.
2. Nếu enable, extension mở WSS và gửi `hello` với protocol version, Chrome/extension version và capabilities.
3. Server so sánh token constant-time và giữ một active connection; connection mới thay connection cũ theo cấu hình đơn giản.
4. MCP call tạo command có ID/deadline; router gửi qua WSS.
5. Extension thực thi trên tab/window đích rồi trả result/error; events gửi bất đồng bộ.
6. Với media upload, server dispatch `media.uploadToDrive`; extension tải media bằng browser session, tạo upload session trên backend và gửi raw chunks tuần tự.
7. Backend proxy từng chunk sang Google Drive resumable upload và chỉ giữ offset/status trong RAM.
8. Khi upload hoàn tất và `DATABASE_URL` được set, backend lưu metadata vào `media_assets`.
9. Media worker định kỳ lấy `social_users`, mở profile social bằng tab Chrome, extract URL media TikTok/Instagram nhìn thấy được trong session hiện tại, rồi gọi `/v1/media/transfers`.
10. Mezon bot định kỳ lấy media chưa archive từ `media_assets`, gửi vào channel và ghi `media_reactions`, `media_archives`, `bot_media_posts`.
11. Khi user Off, extension detach debugger, hủy command có thể hủy, đóng WSS; server fail pending requests.

## Full-control capability

- Tab/window: list/open/close/focus/move/resize.
- Navigation: goto/back/forward/reload/wait.
- Observe: DOM/accessibility snapshot, screenshot, URL/title, console/network events.
- Input: click/double-click/hover/drag/type/key/select/scroll.
- Runtime: JavaScript evaluate trong trusted personal mode.
- Browser features: dialogs, downloads và upload khi Chrome API/page cho phép.
- Media bridge: tải media URL mà browser profile hiện tại truy cập được và upload lên Google Drive qua backend.

Extension xin quyền mạnh (`debugger`, `tabs`, `scripting`, `downloads`, `<all_urls>`). Đây là lựa chọn chủ ý cho dự án cá nhân; UI phải luôn cho thấy trạng thái On/Connected.

## Không có trong MVP

- Account/workspace, OAuth/OIDC cho BrowserBridge user, pairing, grant theo tab, approval/audit workflow.
- Message broker, microservice, HA hoặc scale nhiều backend.
- Offscreen document trừ khi implementation chứng minh service worker không đủ.

## Failure handling

- Mạng/server restart: exponential backoff có jitter, không tự replay lệnh chưa biết kết quả.
- MV3 suspend: khôi phục WSS từ config; capability/connection state handshake lại.
- Tab đóng/đổi process: trả `TARGET_NOT_FOUND` hoặc `STALE_REF`.
- Debugger bị DevTools/extension khác chiếm: trả `DEBUGGER_CONFLICT`.
- Command treo: extension và server cùng enforce deadline.
- Payload quá lớn: trả `PAYLOAD_TOO_LARGE`, cho phép screenshot quality/size thấp hơn.
- Media upload lệch offset: trả HTTP `409` và `next_offset` từ session status là nguồn phục hồi.

## Media security boundary

Social cookies, CSRF token và signed URL chỉ nằm trong Chrome/profile hoặc request media của extension. Backend không nhận social cookie/token, không gọi API nội bộ của Instagram/TikTok và không ghi media xuống disk. Backend chỉ nhận raw bytes từ extension qua shared bearer token rồi forward tới Google Drive bằng OAuth của chính backend.

Media worker không tự giữ cookie social. Nó chỉ yêu cầu Chrome extension mở/evaluate tab và dispatch upload; nếu nền tảng không expose URL media cho browser session hiện tại thì worker phải bỏ qua hoặc lưu lỗi scrape vào metadata user.

## Platform limits

Chrome không cho extension điều khiển đầy đủ browser chrome/UI, `chrome://`, Chrome Web Store, OS file picker/security prompt và một số incognito/file page. API phải báo `UNSUPPORTED_TARGET`, không giả vờ thành công.

## Decision

- [ADR-001](../decisions/ADR-001-browser-control-foundation.md)
- [ADR-002](../decisions/ADR-002-browser-media-drive-boundary.md)
- [ADR-003](../decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md)
- [ADR-004](../decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md) (proposed)
- [SRS](../requirements/SPEC.md)

## Planned PHASE-004 evolution

This section is design direction, not implemented behavior.

- Split PostgreSQL ownership into `gateway` for control/social/media jobs/assets/policy/audit/operational errors and `bot` for Mezon state.
- Replace profile-level-only media errors with durable per-media jobs, attempt history, lease recovery, retry/backoff and dead-letter state.
- Enforce one social-pipeline Drive destination from `GOOGLE_DRIVE_FOLDER_ID`; persist both Drive file and folder IDs.
- Normalize TikTok, Instagram and Facebook collectors behind one adapter contract using only browser-visible state.
- Put agent-readable status, correlated component/stage errors and job mutations behind HTTP/MCP capability checks, redacted audit events and structured operational error events.
- Use MCP as the executable agent control surface, with optional skills limited to workflows; keep gateway/provider credentials out of skills and tool arguments.

Execution plan: [PHASE-004](../work/phases/PHASE-004-resilient-agent-gateway.md), [DESIGN-004](../work/designs/DESIGN-004-agent-control-api-mcp-permissions.md), and [DESIGN-005](../work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md).

Implementation-ready annexes: [agent API/MCP](../work/designs/DESIGN-004-API.md), [database/migration](../work/designs/DESIGN-005-DATABASE.md), and [runtime/platform flows](../work/designs/DESIGN-005-FLOWS.md). Permission model decision is [ADR-004](../decisions/ADR-004-scoped-agent-sessions-policy-and-audit.md) and remains proposed until owner approval.
