---
artifact_type: integrations_doc
id: INTEGRATIONS
status: approved
owner: shared
updated: 2026-08-21
---

# Integrations

| System | Dùng cho | Trạng thái |
| --- | --- | --- |
| Chrome 116+ | MV3, tabs/windows/debugger/scripting/downloads/storage | required |
| MCP host/client | Agent tool calls | required cho phase 3 |
| TLS ingress | HTTPS/WSS nếu chạy ngoài localhost | deployment choice |
| Google Drive API | Resumable upload media từ backend | optional; required cho `media.uploadToDrive` |
| PostgreSQL | Catalog social users, media assets, Mezon reactions/archive/posts | required cho social media worker + bot |
| Mezon gateway | Bot đăng ảnh vào channel và nhận button/command events | required cho bot |
| Open Browser Control | Tham khảo/fork browser action patterns sau license review | optional |

## Configuration names

- Server: `BROWSER_BRIDGE_LISTEN_ADDR`, `BROWSER_BRIDGE_AUTH_TOKEN`, `BROWSER_BRIDGE_LOG_LEVEL`, `DATABASE_URL`.
- Google Drive static token dev mode: `GOOGLE_DRIVE_ACCESS_TOKEN`.
- Google Drive refresh mode: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`.
- Google Drive client-secret file mode: `GOOGLE_DRIVE_CLIENT_SECRET_FILE`, `GOOGLE_DRIVE_REFRESH_TOKEN`.
- Bot: `MEZON_BOT_ID`, `MEZON_BOT_TOKEN`, `MEZON_CHANNEL_ID`, `MEZON_ADMIN_USER_ID`, optional `MEZON_HOST`, `MEZON_PORT`, `MEZON_USE_SSL`, `BOT_POST_INTERVAL_SECONDS`.
- Worker: `BROWSER_BRIDGE_HTTP_URL`, `SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS`.
- Extension: `serverUrl`, `authToken`, `controlEnabled` trong local storage.

Không có IdP, message broker hay cloud provider bắt buộc ngoài Google Drive cho media upload. PostgreSQL chỉ bắt buộc khi chạy social media pipeline và Mezon bot.

Implementation v0.1 không có third-party runtime/build dependency: Go dùng standard library và extension được Chrome load trực tiếp từ JavaScript ES modules. Google Drive được gọi qua HTTPS standard library, không dùng SDK.
