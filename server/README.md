# Server

Go backend source cho WSS command router và MCP adapter.

Hiện có:

- WSS handshake shared-token, heartbeat và `tabs.list`.
- HTTP `/v1/media/transfers` để dispatch `media.uploadToDrive` sang extension.
- HTTP `/v1/media/upload-sessions` để extension proxy raw chunks sang Google Drive resumable upload.
- Optional PostgreSQL media catalog via `DATABASE_URL`.

PostgreSQL config:

```bash
export DATABASE_URL='postgres://browserbridge:browserbridge@127.0.0.1:5432/browserbridge?sslmode=disable'
```

Khi có `DATABASE_URL`, server tự tạo bảng `media_assets` và lưu metadata sau khi upload Drive hoàn tất: `platform`, `source_user_id`, `source_username`, `media_id`, `post_id`, `media_type`, `preview_url`, Drive file ID/link, filename, MIME, size và JSON metadata.

Schema cũng có các bảng phục vụ flow social + bot:

- `social_users`: user đã scrape từ từng nền tảng, ví dụ TikTok/Instagram.
- `mezon_users`: user tương tác với bot trong Mezon.
- `media_reactions`: like/dislike theo media và Mezon user.
- `media_archives`: lịch sử admin archive/delete media khỏi vòng gửi bot.
- `bot_media_posts`: lịch sử bot đã post media nào vào channel nào.
- `bot_event_dedup`: event IDs đã xử lý để tránh double command/button khi reconnect hoặc chạy nhiều bot instance.

Google Drive config:

```bash
export GOOGLE_DRIVE_ACCESS_TOKEN='ya29...'
```

hoặc:

```bash
export GOOGLE_DRIVE_CLIENT_ID='...apps.googleusercontent.com'
export GOOGLE_DRIVE_CLIENT_SECRET='...'
export GOOGLE_DRIVE_REFRESH_TOKEN='...'
```

Hoặc dùng file JSON tải từ Google Cloud:

```bash
export GOOGLE_DRIVE_CLIENT_SECRET_FILE='/absolute/path/client_secret_*.json'
export GOOGLE_DRIVE_REFRESH_TOKEN='refresh-token-moi'
export GOOGLE_DRIVE_FOLDER_ID='drive-folder-id'
```

Nếu `GOOGLE_DRIVE_FOLDER_ID` được set, mọi upload không truyền `drive_folder_id` sẽ vào folder đó.

Nếu không có Google env, server vẫn chạy nhưng media upload endpoints trả `503`.
