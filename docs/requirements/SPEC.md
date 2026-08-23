---
artifact_type: requirement_spec
id: REQ-MASTER
status: approved
owner: human
updated: 2026-08-20
trace:
  roadmap: docs/work/ROADMAP.md
  phases:
    - docs/work/phases/PHASE-001-connected-skeleton.md
    - docs/work/phases/PHASE-002-full-browser-control.md
    - docs/work/phases/PHASE-003-agent-integration.md
  detail_designs:
    - docs/work/designs/DESIGN-001-browser-bridge-mvp.md
    - docs/work/designs/DESIGN-002-media-drive-chunk-upload.md
  adrs:
    - docs/decisions/ADR-001-browser-control-foundation.md
    - docs/decisions/ADR-002-browser-media-drive-boundary.md
---

# SRS: Personal Browser Bridge v0.1

## 1. Mục tiêu

Sau khi Chrome/extension khởi động, extension tự nối tới server. Khi `Enable control` bật, agent có thể quan sát và thao tác toàn bộ web tabs trong Chrome profile của người dùng gần như người dùng trực tiếp thao tác, không cần xác nhận theo tab hay theo từng lệnh.

## 2. Phạm vi MVP

### Có

- Cấu hình một lần: `Server URL`, shared `Token`, `Enable control`.
- Tự kết nối/reconnect WSS khi extension service worker khởi động hoặc mạng trở lại.
- Liệt kê/tạo/đóng/focus tab và window; navigate/back/forward/reload.
- Đọc URL/title, DOM hoặc accessibility snapshot; chụp screenshot.
- Click, double-click, hover, drag/drop, type, keypress, select, scroll và wait.
- Xử lý JavaScript dialog; hỗ trợ upload/download trong giới hạn Chrome API.
- Evaluate JavaScript, đọc console và network events trong trusted personal mode.
- Trả kết quả/lỗi có request ID và deadline.
- MCP tools ở Go server để AI agent gọi các chức năng trên.
- Nút On/Off toàn cục; Off phải ngừng nhận lệnh ngay và detach debugger.

### Không có trong MVP

- Account, workspace, multi-tenant, role/permission hoặc nhiều người dùng.
- Pairing code, tab grant, approval từng action, audit database, billing.
- SQLite/PostgreSQL, message broker, microservices, HA/multi-region.
- Chrome Web Store release; MVP dùng unpacked extension.
- Firefox/Safari/mobile hoặc browser farm.
- Điều khiển UI Chrome/OS mà extension API không truy cập được.

## 3. Actor

| Actor | Vai trò |
| --- | --- |
| Owner | Cài extension, giữ token, bật/tắt quyền điều khiển |
| AI Agent / MCP Client | Gửi lệnh và nhận observation/result |
| Go Server | Xác thực token, giữ WSS, route command và expose MCP |
| Extension | Thực thi lệnh trên Chrome profile hiện tại |

## 4. Functional requirements

| ID | Yêu cầu | Acceptance summary |
| --- | --- | --- |
| FR-001 | Extension lưu URL/token/enable trong `chrome.storage.local` | Cấu hình còn sau restart |
| FR-002 | Extension tự mở WSS khi enable | Không cần bấm Connect mỗi lần |
| FR-003 | Shared token xác thực handshake | Token sai bị từ chối, không log plaintext |
| FR-004 | Reconnect backoff+jitter và heartbeat | Phục hồi sau restart/mất mạng |
| FR-005 | Global On/Off | Off từ chối lệnh mới và detach debugger |
| FR-006 | Tab/window lifecycle | list/open/close/focus/create window |
| FR-007 | Navigation | goto/back/forward/reload/wait |
| FR-008 | Observation | snapshot/screenshot/URL/title |
| FR-009 | Pointer/input | click/hover/drag/type/key/select/scroll |
| FR-010 | Dialog/file/download | Thực thi khi Chrome API hỗ trợ, lỗi rõ khi không |
| FR-011 | Trusted evaluate | Evaluate JS có structured result/error |
| FR-012 | Events | tab/navigation/console/network events theo subscription |
| FR-013 | Command contract | ID, method, params, timeout và structured error |
| FR-014 | Cancellation | Best-effort cancel và deadline enforcement |
| FR-015 | MCP adapter | Tool call map 1:1 vào browser commands chính |
| FR-016 | Capability report | Extension báo API/method nào đang hỗ trợ |
| FR-017 | Browser media upload to Google Drive | Server gọi `media.uploadToDrive`; extension fetch media bằng browser session và upload raw chunks qua backend lên Google Drive resumable upload |

## 5. Non-functional requirements

| ID | Yêu cầu |
| --- | --- |
| NFR-001 | TLS/WSS ngoài localhost; token không nằm trong URL hoặc log |
| NFR-002 | Lệnh/tab riêng lỗi không làm sập connection hay server |
| NFR-003 | Sau mất mạng, reconnect mục tiêu trong 30 giây khi mạng ổn định |
| NFR-004 | Giới hạn message mặc định 1 MiB; screenshot có giới hạn riêng |
| NFR-005 | Hỗ trợ Chrome stable 116+ trên Linux trước; Windows/macOS ở phase 3 |
| NFR-006 | Manifest V3 không tải remote executable code |
| NFR-007 | Logs có request ID nhưng redact token và page payload mặc định |
| NFR-008 | Protocol versioned và unknown optional field không làm hỏng client |
| NFR-009 | Backend không nhận social cookies/token và không ghi media xuống disk; chunk upload phải tuần tự, bounded size và xác thực bearer |

## 6. Luồng chính

1. Owner cài extension unpacked, nhập WSS URL/token và bật control.
2. Extension handshake với server và gửi capabilities.
3. Agent gọi MCP `browser_tabs_list`, chọn tab hoặc tạo tab.
4. Agent snapshot/screenshot, gửi navigation/input/evaluate commands và nhận result/events.
5. Agent có thể gửi media URL đang truy cập được trong browser; extension tải bytes bằng session trình duyệt và đẩy chunk lên backend để proxy tới Google Drive.
6. Owner tắt control bất kỳ lúc nào; extension detach và server trả `CONTROL_DISABLED`.

## 7. Definition of Done v0.1

- Chrome restart xong extension tự online mà không cần thao tác thêm.
- Một E2E thật chạy được: list tab -> open tab -> navigate -> snapshot -> click/type -> screenshot -> close tab.
- On/Off, token sai, reconnect, timeout và stale target có test/evidence.
- MCP client thực hiện được E2E trên.
- README có hướng dẫn build, chạy server, load unpacked extension và cấu hình.

## 8. Giới hạn nền tảng

“Toàn quyền trình duyệt” nghĩa là toàn quyền trên web content và tab/window trong phạm vi API Chrome cấp cho extension. Chrome có thể chặn `chrome://`, Chrome Web Store, browser UI, OS dialogs, một số file/incognito page và security prompt. CAPTCHA/MFA/anti-bot không được coi là chức năng cần bypass.
