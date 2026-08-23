# Browser Bridge

Dự án cá nhân để agent điều khiển Chrome đang dùng thay cho chủ máy.

```text
AI Agent / MCP Client
        |
        v
Go server  <==== WSS tự kết nối ====  Chrome MV3 extension
                                      |
                                      +-- tabs/windows
                                      +-- debugger/CDP
                                      +-- DOM/screenshot/input/events
                                      +-- media fetch -> chunk upload
```

## MVP đã chốt

- Một người dùng, một server, một hoặc vài Chrome của chính người dùng.
- Cài extension, nhập `Server URL` và `Token` một lần; sau đó extension tự kết nối khi Chrome khởi động.
- Khi công tắc `Enable control` bật, agent được điều khiển mọi web tab mà Chrome Extension API cho phép.
- Không pairing code, account/workspace, phân quyền theo tab, approval từng hành động, audit database hay multi-tenant.
- Không cần local companion process và không dùng SQLite trong MVP.
- Backend Go standard library, extension Manifest V3 JavaScript ES module, transport JSON/WebSocket; MCP ở phase 3.

“Toàn quyền” trong MVP gồm quản lý tab/window, điều hướng, đọc DOM/accessibility, screenshot, click/type/key/scroll/hover/drag, dialog, download/upload khi API cho phép, JavaScript evaluation và console/network events. Chrome vẫn chặn extension trên một số trang nội bộ như `chrome://`, Chrome Web Store, UI trình duyệt và hộp thoại hệ điều hành.

Media upload to Google Drive dùng ranh giới riêng: extension tải media URL bằng session Chrome hiện tại, backend chỉ nhận raw chunks và proxy sang Google Drive resumable upload. Backend không nhận social cookies/token và không ghi media xuống disk.

## Tài liệu

- [SRS](docs/requirements/SPEC.md)
- [Kiến trúc](docs/architecture/ARCHITECTURE.md)
- [API/WSS protocol](docs/architecture/API.md)
- [Roadmap](docs/work/ROADMAP.md)
- [Backlog](docs/work/BACKLOG.md)
- [Context](docs/CONTEXT.md)

## Chạy Phase 1 local

```bash
export BROWSER_BRIDGE_AUTH_TOKEN='thay-bang-secret-dai-ngau-nhien'
cd server
go run ./cmd/browser-bridge
```

Muốn bật upload Google Drive, cấu hình thêm một trong hai cách trước khi chạy server:

```bash
export GOOGLE_DRIVE_ACCESS_TOKEN='ya29...'
```

hoặc:

```bash
export GOOGLE_DRIVE_CLIENT_ID='...apps.googleusercontent.com'
export GOOGLE_DRIVE_CLIENT_SECRET='...'
export GOOGLE_DRIVE_REFRESH_TOKEN='...'
```

Nếu đã tải file `client_secret_*.json` từ Google Cloud, có thể dùng file thay cho hai biến `CLIENT_ID/CLIENT_SECRET`:

```bash
export GOOGLE_DRIVE_CLIENT_SECRET_FILE='/absolute/path/client_secret_*.json'
export GOOGLE_DRIVE_REFRESH_TOKEN='refresh-token-moi'
export GOOGLE_DRIVE_FOLDER_ID='drive-folder-id'
```

`GOOGLE_DRIVE_FOLDER_ID` lấy từ URL thư mục Drive, ví dụ `https://drive.google.com/drive/folders/<folder-id>`.

Nếu đã có refresh token nhưng chưa có folder cố định, tạo folder Drive và ghi `GOOGLE_DRIVE_FOLDER_ID` vào `server/.env`:

```bash
node tools/configure_drive_folder.mjs
```

Muốn lưu catalog media vào PostgreSQL:

```bash
export DATABASE_URL='postgres://browserbridge:browserbridge@127.0.0.1:55432/browserbridge?sslmode=disable'
```

Khi `DATABASE_URL` được set, server tự migrate schema và lưu mỗi media đã upload vào `media_assets`. Script TikTok following lưu danh sách user nền tảng vào `social_users`.

Setup PostgreSQL local bằng Docker và migrate schema:

```bash
./scripts/setup-local-postgres.sh
```

Script này chỉ tự điền `DATABASE_URL` mặc định vào `server/.env` nếu biến đang thiếu/rỗng.

Export following từ browser session hiện tại:

```bash
TIKTOK_TAB_ID=123 node tools/export_tiktok_following.mjs
INSTAGRAM_TAB_ID=456 node tools/export_instagram_following.mjs
```

Hai script này gọi `runtime.evaluate` qua BrowserBridge, nên request social chạy trong tab Chrome đã đăng nhập. Output nằm trong `exports/`; nếu có `DATABASE_URL`, user được upsert vào `social_users`.

Nếu extension đã connected và tab TikTok/Instagram đang mở, có thể để tool tự tìm tab social:

```bash
node tools/export_social_following.mjs --platform all
node tools/export_social_following.mjs --platform tiktok
node tools/export_social_following.mjs --platform instagram
```

Khi có nhiều tab hoặc muốn chỉ định rõ:

```bash
node tools/export_social_following.mjs --platform all --tiktok-tab-id 123 --instagram-tab-id 456
```

Chạy một vòng đầy đủ “export following -> scrape media -> upload Drive/DB”:

```bash
SOCIAL_MEDIA_PLATFORM=all ./scripts/run-social-once.sh
SOCIAL_MEDIA_PLATFORM=tiktok ./scripts/run-social-once.sh
SOCIAL_MEDIA_PLATFORM=instagram ./scripts/run-social-once.sh
```

Lệnh này cần BrowserBridge server + extension đã connected. Với `all`, script export cả hai nền tảng rồi chạy worker một tick cho TikTok và Instagram.

Import lại file JSON đã export vào DB:

```bash
node tools/import_social_users.mjs --platform tiktok --file exports/tiktok-following-<user>.json
node tools/import_social_users.mjs --platform instagram --file exports/instagram-following-<user>.json
```

Import user không set `last_scraped_at`, để media worker có thể lấy profile đó ngay trong tick kế tiếp.

Seed nhanh một user social để test worker mà chưa cần export following:

```bash
node tools/upsert_social_user.mjs --platform tiktok --username some_creator
node tools/upsert_social_user.mjs --platform instagram --username some_creator
```

Trong Chrome, mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và chọn thư mục `extension/`. Mở Extension options, nhập:

- Server URL: `ws://127.0.0.1:8788/v1/extension`
- Token: đúng giá trị `BROWSER_BRIDGE_AUTH_TOKEN`
- Bật **Enable browser control** rồi Save.

Kiểm tra kết nối (mở một vài web tab trước):

```bash
curl -H "Authorization: Bearer $BROWSER_BRIDGE_AUTH_TOKEN" http://127.0.0.1:8788/v1/tabs
```

Kiểm tra nhanh toàn bộ pipeline local mà không in secret:

```bash
node tools/verify_social_pipeline.mjs
```

Verifier này kiểm tra env bắt buộc, `/healthz`, `/v1/tabs` và count các bảng PostgreSQL chính.
Trên server mới, verifier cũng đọc `/v1/status` để báo `extension_connected`, `drive_configured`, `drive_folder_set` và `media_store_set`.

Kiểm tra package Chrome extension trước khi load hoặc gửi file zip:

```bash
node tools/verify_extension_package.mjs
```

Verifier này kiểm tra manifest MV3, default BrowserBridge URL, capability list (`tabs.list`, `tabs.open`, `tabs.close`, `runtime.evaluate`, `media.uploadToDrive`), các file extension bắt buộc, `dist/browser-bridge-extension.zip` và hash source-vs-zip để bắt package stale.

Wait tới khi live pipeline đủ điều kiện chạy bot/worker thật:

```bash
./scripts/wait-live-ready.sh --wait-seconds 120 --interval-seconds 5
```

Lệnh này poll server, Chrome extension, PostgreSQL và biến Mezon bắt buộc; output chỉ in boolean/count/hint, không in secret value.

Chạy doctor một lệnh cho local pipeline:

```bash
./scripts/doctor.sh
```

Doctor sẽ setup/migrate PostgreSQL, verify bot DB flow, verify media worker DB flow, verify one-shot social flow, verify extension package/zip, start server tạm nếu cần, verify upload chunk lên Google Drive + `media_assets`, rồi chạy readiness verifier. Dùng `SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh` nếu không muốn tạo/xóa file verify trên Drive.

Chạy stack local dài hạn:

```bash
./scripts/run-stack.sh
```

Stack runner sẽ đảm bảo PostgreSQL local đã migrate, chạy BrowserBridge server, chạy media worker, và chỉ chạy Mezon bot nếu đủ `MEZON_BOT_ID`, `MEZON_BOT_TOKEN`, `MEZON_CHANNEL_ID`, `MEZON_ADMIN_USER_ID`. Dùng `RUN_MEDIA_WORKER=false ./scripts/run-stack.sh` nếu chỉ muốn chạy server/bot.

Chạy live UAT có gate readiness trước khi worker/bot bắt đầu:

```bash
WAIT_SECONDS=300 ./scripts/run-live-uat.sh
```

Script này start PostgreSQL và BrowserBridge server trước, sau đó wait extension + Drive + DB + Mezon env sẵn sàng. Trong lúc nó đang wait, mở Chrome extension và connect tới `ws://127.0.0.1:8788/v1/extension`. Khi readiness pass, script mới start media worker và Mezon bot. Dùng `RUN_MEDIA_WORKER=false` hoặc `RUN_MEZON_BOT=false` nếu muốn bỏ qua một process trong live UAT.

Kiểm tra backend upload chunk -> Google Drive -> `media_assets` bằng file text nhỏ tự cleanup:

```bash
node tools/verify_drive_upload_flow.mjs
```

Gửi media URL đang truy cập được trong browser lên Drive:

```bash
curl -X POST \
  -H "Authorization: Bearer $BROWSER_BRIDGE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"media_url":"https://example.com/video.mp4","filename":"video.mp4","mime_type":"video/mp4"}' \
  http://127.0.0.1:8788/v1/media/transfers
```

Khi dùng server ngoài máy local, đặt Go process sau TLS reverse proxy và cấu hình extension bằng `wss://...`; không gửi token trên query URL.

## Bot Mezon `mlem`

Bot `mlem` đọc media từ PostgreSQL rồi gửi định kỳ vào channel Mezon kèm nút `Like`, `Che` và `Delete (admin)`. Nút delete được enforce theo `MEZON_ADMIN_USER_ID`; người khác bấm sẽ bị từ chối và không ghi archive. Về dữ liệu, delete là soft-delete: media được ghi vào `media_archives` và set `archived_at`, không xóa file Drive ngay.

```bash
cd bot
npm install
cd ..
./scripts/run-bot.sh
```

Các biến cần có trong `server/.env`:

```bash
DATABASE_URL='postgres://...'
MEZON_BOT_ID='...'
MEZON_BOT_TOKEN='...'
MEZON_HOST='gw.mezon.ai'
MEZON_PORT='443'
MEZON_USE_SSL='true'
MEZON_TIMEOUT_MS='10000'
MEZON_CHANNEL_ID='...'
MEZON_ADMIN_USER_ID='...'
BOT_POST_INTERVAL_SECONDS='3600'
BOT_COMMAND_PREFIX='*mlem'
BOT_DEDUP_TTL_SECONDS='86400'
BOT_MEDIA_CLAIM_TTL_SECONDS='300'
BOT_SINGLE_HOST_LOCK='true'
BOT_LOCK_FILE=''
```

Ghi biến Mezon vào `server/.env` mà không echo token:

```bash
node tools/configure_mezon_env.mjs --bot-id '<bot-id>' --token '<bot-token>' --channel '<channel-id>' --admin '<admin-user-id>'
node tools/verify_social_pipeline.mjs
```

Kiểm tra config trước khi ghi file:

```bash
node tools/configure_mezon_env.mjs --dry-run --bot-id '<bot-id>' --token '<bot-token>' --channel '<channel-id>' --admin '<admin-user-id>' --port 443 --use-ssl true
```

Tool validate port/timeout/boolean và chỉ in boolean theo tên biến, không in token.
Nếu muốn validate một file env khác, dùng thêm `--target-env-file /path/to/.env`.

Người dùng social (`social_users`) và người dùng Mezon (`mezon_users`) là hai nhóm dữ liệu riêng. Bot chỉ phản ứng với media đã có trong `media_assets`; việc scrape/download media vẫn đi qua extension và endpoint upload của server. Bot dùng `bot_event_dedup` trong PostgreSQL để tránh xử lý trùng command/button event khi process reconnect hoặc chạy nhiều instance. Khi gửi media, bot claim row bằng `BOT_MEDIA_CLAIM_TTL_SECONDS` để nhiều instance không chọn cùng một media. Mặc định `BOT_SINGLE_HOST_LOCK=true` cũng tạo lock file local trong thư mục `bot/` để chặn chạy hai bot trên cùng máy; để trống `BOT_LOCK_FILE` sẽ dùng path mặc định đó.

Bot handler core nằm ở `bot/src/bot-core.js` và được test bằng `npm test`: command gửi thêm media, empty state, like/dislike, admin-only archive.

Scheduler định kỳ sẽ im lặng nếu queue rỗng để không spam channel; với `BOT_COMMAND_PREFIX='*mlem'`, lệnh `*mlem`, `*mlem more`, `*mlem next` hoặc `*mlem thêm` vẫn trả thông báo khi không còn media sẵn sàng.

Media worker claim user trong `social_users` bằng `SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS` để nhiều worker không cùng scrape một profile. Khi scrape xong hoặc lỗi đã được ghi metadata, claim được clear; nếu process chết giữa chừng, TTL cho phép worker khác lấy lại sau đó.

Extractor optimization đang ưu tiên TikTok và Instagram, với Facebook là platform kế tiếp. Tham khảo nội bộ nằm ở `social_media_download/`, nhưng chỉ dùng để hiểu media URL/metadata/page-data shape; không copy cơ chế bắt cookie, webRequest credential cache hoặc header rewrite của extension tham khảo vào BrowserBridge.

Seed nhanh một media để test bot live trước khi scrape xong:

```bash
node tools/upsert_media_asset.mjs \
  --platform tiktok \
  --source-user-id manual-user \
  --source-username manual-user \
  --media-id manual-media-1 \
  --drive-link 'https://drive.google.com/file/d/...' \
  --filename manual-media.jpg \
  --mime-type image/jpeg
```

Sau đó chạy `./scripts/run-bot.sh` và gửi `*mlem` trong channel Mezon đã cấu hình.

Kiểm tra bot flow trực tiếp trên PostgreSQL local bằng media mẫu tự cleanup:

```bash
node tools/verify_bot_db_flow.mjs
```

Kiểm tra media worker chọn user từ `social_users`, gọi upload và cập nhật scrape metadata bằng fake BrowserBridge:

```bash
node tools/verify_worker_db_flow.mjs
```

Kiểm tra orchestration `run-social-once.sh` bằng fake BrowserBridge local:

```bash
node tools/verify_social_once_flow.mjs
```

Xem trạng thái catalog social/media/bot trong PostgreSQL:

```bash
node tools/media_status.mjs
```

## Media Worker

Worker này chạy độc lập với bot chat. Nó đọc `social_users`, mở profile qua BrowserBridge/Chrome extension, extract media TikTok hoặc Instagram mà browser session hiện tại thấy được, rồi gọi `/v1/media/transfers` để extension download và upload chunk lên Google Drive. Worker truyền `tab_id` của profile tab vào upload request để MAIN-world fallback dùng đúng browser session, sau đó đóng tab bằng `DELETE /v1/tabs/{id}` để chạy nhiều user không làm Chrome phình tab. Backend vẫn chỉ nhận chunk raw và metadata, không nhận cookie social.

```bash
./scripts/run-media-worker.sh
```

Chạy một vòng để verify live rồi thoát:

```bash
SOCIAL_MEDIA_WORKER_RUN_ONCE=true SOCIAL_MEDIA_PLATFORM=tiktok ./scripts/run-media-worker.sh
SOCIAL_MEDIA_WORKER_RUN_ONCE=true SOCIAL_MEDIA_PLATFORM=all ./scripts/run-media-worker.sh
```

Các biến điều khiển:

```bash
BROWSER_BRIDGE_HTTP_URL='http://127.0.0.1:8788'
SOCIAL_MEDIA_PLATFORM='all' # all, tiktok, hoặc instagram
SOCIAL_MEDIA_SCAN_INTERVAL_SECONDS='1800'
SOCIAL_MEDIA_USER_COOLDOWN_SECONDS='21600'
SOCIAL_MEDIA_MAX_USERS_PER_TICK='3'
SOCIAL_MEDIA_MAX_MEDIA_PER_USER='20'
SOCIAL_MEDIA_PAGE_LOAD_WAIT_MS='5000'
SOCIAL_MEDIA_WORKER_RUN_ONCE='false'
```

Worker có extractor cho TikTok và Instagram. Khi `SOCIAL_MEDIA_PLATFORM=all`, mỗi tick chạy tuần tự TikTok rồi Instagram và gom summary theo nền tảng. Trước khi upload, worker kiểm tra `(platform, source_user_id, media_id)` trong `media_assets` và bỏ qua media đã có để không tải lại file đã lưu Drive/DB. Khả năng lấy được video gốc phụ thuộc vào page state/DOM mà Chrome session hiện tại expose; khi không thấy video URL, extractor có thể chỉ lấy ảnh/cover public nhìn thấy được.
