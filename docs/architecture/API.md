---
artifact_type: api_contract_index
id: API-MASTER
status: approved
owner: shared
updated: 2026-08-23
---

# WSS và MCP contract v0.1

## Transport

- Extension endpoint: `wss://<host>/v1/extension`.
- `hello` là frame đầu tiên và chứa token trong payload, không nằm trong URL.
- JSON UTF-8, envelope version `v: 1`, default max message 1 MiB.
- Chỉ một extension connection active trong cấu hình personal mặc định.

```json
{
  "v": 1,
  "type": "command",
  "id": "01J...",
  "method": "page.navigate",
  "deadline_at": "2026-08-20T08:00:00Z",
  "params": {"tab_id": 123, "url": "https://example.com"}
}
```

## Messages

| Type | Hướng | Nội dung |
| --- | --- | --- |
| `hello` | extension -> server | token, versions, enabled, capabilities |
| `welcome` | server -> extension | connection ID, heartbeat interval |
| `ping`/`pong` | hai chiều | liveness |
| `command` | server -> extension | ID, method, deadline, params |
| `result` | extension -> server | ID, result |
| `error` | extension -> server | ID, code, message, retryable, details |
| `cancel` | server -> extension | command ID |
| `event` | extension -> server | subscription/event payload |
| `status` | extension -> server | enabled/disabled, attach/connection state |

## Methods

| Nhóm | Methods |
| --- | --- |
| Browser | `browser.capabilities`, `browser.status` |
| Tabs | `tabs.list`, `tabs.open`, `tabs.close`, `tabs.focus`, `tabs.move` |
| Windows | `windows.list`, `windows.open`, `windows.close`, `windows.update` |
| Page | `page.navigate`, `page.back`, `page.forward`, `page.reload`, `page.wait` |
| Observe | `page.snapshot`, `page.screenshot`, `page.get_info` |
| Input | `input.click`, `input.hover`, `input.drag`, `input.type`, `input.key`, `input.select`, `input.scroll` |
| Runtime | `runtime.evaluate` |
| Dialog/File | `dialog.handle`, `file.set_input`, `download.start`, `downloads.list` |
| Media | `media.uploadToDrive` |
| Events | `events.subscribe`, `events.unsubscribe` |

Element interactions ưu tiên snapshot reference; có thể dùng coordinate hoặc selector khi method cho phép. Ref hết hạn sau navigation/document change và trả `STALE_REF`.

## Error codes

`INVALID_ARGUMENT`, `UNAUTHENTICATED`, `CONTROL_DISABLED`, `NOT_CONNECTED`, `TARGET_NOT_FOUND`, `UNSUPPORTED_TARGET`, `UNSUPPORTED_METHOD`, `DEBUGGER_CONFLICT`, `STALE_REF`, `DEADLINE_EXCEEDED`, `CANCELLED`, `PAYLOAD_TOO_LARGE`, `CHROME_ERROR`, `INTERNAL`.

Không gửi stack trace, token hoặc page payload nhạy cảm trong error mặc định.

## Media upload HTTP API

Tất cả endpoint dưới đây dùng `Authorization: Bearer <BROWSER_BRIDGE_AUTH_TOKEN>`.

`POST /v1/media/transfers` yêu cầu extension tải media và upload lên Drive:

```json
{
  "media_url": "https://cdn.example/video.mp4",
  "filename": "video.mp4",
  "mime_type": "video/mp4",
  "drive_folder_id": "optional-folder-id",
  "tab_id": 123,
  "platform": "tiktok",
  "source_user_id": "7123...",
  "source_username": "creator",
  "media_id": "7345...",
  "post_id": "7345...",
  "media_type": "video",
  "preview_url": "https://cdn.example/cover.jpg",
  "metadata": {"page_url": "https://www.tiktok.com/@creator/video/7345"}
}
```

Server gửi WSS command `media.uploadToDrive` với payload tương tự. Extension fetch bằng `credentials: "include"` trong service worker; nếu không được, nó inject MAIN-world script vào tab đích để fetch bằng session trang đang mở, rồi background upload chunk về backend. Token Browser Bridge chỉ nằm trong service worker, không đưa vào page context.

Khi `DATABASE_URL` được set và `platform`, `source_user_id`, `media_id` có đủ, upload hoàn tất sẽ upsert `media_assets`.

`POST /v1/media/upload-sessions` do extension gọi để tạo Google Drive resumable session:

```json
{
  "filename": "video.mp4",
  "mime_type": "video/mp4",
  "drive_folder_id": "optional-folder-id",
  "total_size": 10485760,
  "media_url": "https://cdn.example/video.mp4",
  "platform": "tiktok",
  "source_user_id": "7123...",
  "source_username": "creator",
  "media_id": "7345...",
  "post_id": "7345...",
  "media_type": "video",
  "preview_url": "https://cdn.example/cover.jpg",
  "metadata": {"source": "universal_state"}
}
```

Response `201`:

```json
{
  "id": "opaque-session-id",
  "filename": "video.mp4",
  "mime_type": "video/mp4",
  "total_size": 10485760,
  "next_offset": 0,
  "status": "uploading"
}
```

`PUT /v1/media/upload-sessions/{id}` nhận raw bytes với `Content-Range: bytes start-end/total`. MVP chỉ nhận chunk tuần tự, tối đa 8 MiB mỗi request, tổng media tối đa 10 GiB. Backend chuyển chunk ngay sang Google Drive, không ghi file tạm.

`GET /v1/media/upload-sessions/{id}` trả trạng thái, `next_offset`, và metadata Drive khi `status = "complete"`.

## MCP

MCP tool names dùng prefix `browser_`, ví dụ `browser_tabs_list`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_evaluate`, `browser_screenshot`. Tool chỉ là adapter; WSS contract ở trên là nguồn chuẩn.

## Compatibility

Thêm optional field/method là compatible. Xóa/đổi nghĩa field hoặc method cần protocol major mới. Handshake luôn trả capability list để server không gửi method extension chưa hỗ trợ.

## Planned PHASE-004 agent gateway API

These contracts are planned by DESIGN-004/TICKET-011 and are not implemented yet:

| Endpoint | Capability | Purpose |
| --- | --- | --- |
| `GET /v1/status/summary` | `social.read` + `media.read` | Counts by platform/job state and queue health; unauthorized sections omitted |
| `GET /v1/social/users` | `social.read` | Cursor-paginated users with platform/scrape-state filters |
| `GET /v1/media/jobs` | `media.read` | Jobs and redacted attempt/error summaries |
| `GET /v1/media/assets/by-drive-file/{id}` | `media.read` | Track a stored asset by Google Drive file ID |
| `GET /v1/status/workers` | `media.read` | Worker heartbeat, last tick, lag and counters |
| `GET /v1/operations/errors` | `ops.read` | Locate redacted runtime failures by component, stage, code, job or trace |
| `GET /v1/operations/errors/{id}` | `ops.read` | Inspect one correlated failure and readable related resources |
| `POST /v1/collector/jobs` | `social.collect` | Enqueue a bounded profile/following collection |
| `POST /v1/media/jobs` | `media.enqueue` | Enqueue one normalized browser-visible media item |
| `POST /v1/media/jobs/{id}/retry` | `media.retry` | Idempotently retry a dead media job |
| `POST /v1/media/jobs/{id}/cancel` | `media.retry` | Cancel a pending/retry-wait job |
| `GET /v1/bot/posts` | `bot.read` | Sent media and aggregate interaction state |
| `GET /v1/bot/posts/{id}/interactions` | `bot.read` | Like/Che/archive detail for one sent item |
| `POST /v1/bot/send-jobs` | `bot.send` | Enqueue explicit or next eligible mlem media |
| `POST /v1/bot/media/{asset_id}/archive` | `bot.moderate` | Archive bot eligibility without deleting Drive data |

Planned MCP tools include `bb_social_status`, `bb_social_users_list`, `bb_media_jobs_list`, `bb_worker_status`, `bb_errors_list`, `bb_error_get`, `bb_media_enqueue_download`, `bb_media_retry_job`, `bb_media_cancel_job`, `bb_bot_posts_list`, `bb_bot_interactions`, `bb_bot_send`, and `bb_bot_archive`.

All mutations require a scoped agent session, capability check, idempotency key and redacted audit event. Existing browser shared-token calls remain in compatibility mode during migration.

MCP is the primary executable agent surface; HTTP remains the transport/domain contract. An optional skill may document safe workflows but must never contain API/session/provider keys. Short-lived gateway sessions belong in MCP process configuration or an OS secret store. Runtime failures use a gateway-generated `trace_id` across gateway, extension, workers, Drive and bot, and are persisted in `gateway.operational_errors`; PostgreSQL-outage events fall back to redacted JSON stderr logs.

For social-pipeline upload sessions, `GOOGLE_DRIVE_FOLDER_ID` becomes mandatory and authoritative. A conflicting request-level `drive_folder_id` returns structured error `DRIVE_FOLDER_MISMATCH`; successful status persists and returns `drive_file_id` plus `drive_folder_id` through the media catalog/job APIs.

Exact planned request/response fields, status/error mapping, cursor pagination, idempotency semantics, capability checks, mlem bot endpoints and MCP inputs are defined in [DESIGN-004-API](../work/designs/DESIGN-004-API.md). This annex is normative for TICKET-011 but remains unimplemented until approval.
