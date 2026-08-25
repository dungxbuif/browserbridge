---
artifact_type: erd_master
id: ERD-MASTER
status: approved
owner: shared
updated: 2026-08-23
---

# Data model

## Persistent data

Extension giữ đúng ba giá trị trong `chrome.storage.local`:

| Key | Mục đích |
| --- | --- |
| `serverUrl` | WSS endpoint |
| `authToken` | Shared secret cá nhân |
| `controlEnabled` | Global On/Off |

Token không sync qua `chrome.storage.sync`.

PostgreSQL là optional nhưng cần cho flow social media + bot. Khi `DATABASE_URL` có giá trị, server/bot tự migrate các bảng dưới đây.

## PostgreSQL tables

| Table | Mục đích |
| --- | --- |
| `social_users` | User scrape từ từng nền tảng social. Khóa nghiệp vụ là `(platform, source_user_id)`. |
| `media_assets` | Media đã upload lên Google Drive, gồm nền tảng, user nguồn, media ID, Drive file ID/link và metadata. |
| `mezon_users` | User Mezon đã tương tác bot. Tách riêng khỏi user social. |
| `media_reactions` | Like/dislike của Mezon user trên từng media asset. |
| `media_archives` | Audit admin archive/delete khỏi vòng gửi bot. |
| `bot_media_posts` | Lịch sử bot đã gửi media nào vào channel nào. |

```text
social_users (platform, source_user_id)
        |
        | logical source identity
        v
media_assets (platform, source_user_id, media_id)
        |             |              |
        v             v              v
bot_media_posts  media_reactions  media_archives
                         ^
                         |
                  mezon_users
```

`media_assets` không FK cứng sang `social_users` để vẫn lưu được media phát hiện trước khi user catalog đầy đủ. `media_reactions` và `media_archives` dùng Mezon identity, không dùng social identity.

## In-memory server state

- active extension connection;
- reported capabilities/status;
- pending commands theo request ID/deadline;
- event subscriptions.
- media upload sessions: opaque ID, Google resumable upload URL, filename, MIME type, total size, next offset, status, final Drive metadata and timestamps.

Server restart làm mất state, pending commands và media upload sessions; extension tự reconnect. Không persist DOM, screenshot, typed text, cookie, media bytes hoặc event payload.

## Planned PHASE-004 schema model

The following is approved architecture direction but not yet migrated:

```text
gateway.social_users
        |
        v
gateway.collector_jobs --> gateway.media_download_jobs --> gateway.media_download_attempts
                                      |
                                      v
                              gateway.media_assets
                                      |
                              bot.media_delivery_state
                                      |
              +-----------------------+-----------------------+
              v                       v                       v
      bot.media_posts        bot.media_reactions      bot.media_archives
                                      ^
                                      |
                              bot.mezon_users

gateway.agents -> gateway.agent_sessions -> gateway.capability_grants
                                              |
                                              v
                                    gateway.audit_events
                                              |
                                              v
                              gateway.operational_errors
```

Key planned constraints:

- Application data uses exactly `gateway` and `bot`; existing `public` rows are backfilled and retained for a rollback window.
- `gateway.media_download_jobs` is unique by `(platform, source_user_id, media_id)`.
- `gateway.media_assets.drive_file_id` remains the external tracking key and gains persisted `drive_folder_id`.
- Bot state references the gateway media asset; it does not duplicate Drive/source metadata.
- `gateway.operational_errors` links trace/request/audit and optional collector/media attempt/send-job IDs so failures can be located by component and stage.
- TICKET-008 owns migration; TICKET-009 owns media jobs and Drive tracking.

See [DESIGN-005](../work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md) and [ADR-003](../decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md).

Exact column, constraint, index, migration and retention contracts are in [DESIGN-005-DATABASE](../work/designs/DESIGN-005-DATABASE.md). Agent policy, audit and operational-error table fields are in [DESIGN-004-API](../work/designs/DESIGN-004-API.md).
