---
artifact_type: project_context
id: CONTEXT
status: active
owner: shared
updated: 2026-08-23
---

# Project Context

## Current status

- SRS và architecture đã được thu gọn cho dự án cá nhân.
- Source skeleton Phase 1 đã hoàn tất bằng Go standard library và JavaScript ES module; đang chờ UAT Chrome thật của owner.
- Browser media -> Google Drive chunk upload đã implement và đã verify upload thật lên Google Drive qua backend credential.
- PostgreSQL catalog cho `social_users`, `media_assets`, Mezon reaction/archive/post và dedup đã implement, migrate được, và DB flow verifier pass.
- Node media worker đã implement flow lấy `social_users`, gọi BrowserBridge để mở/evaluate profile social, upload media và lưu metadata/claim state; worker hỗ trợ `SOCIAL_MEDIA_PLATFORM=all` cho TikTok + Instagram trong scheduled ticks, skip media đã tồn tại theo `(platform, source_user_id, media_id)`, truyền `tab_id` vào upload để fallback fetch dùng đúng tab rồi đóng profile tab sau scrape.
- Social following export có entrypoint `tools/export_social_following.mjs` để tự tìm tab TikTok/Instagram qua BrowserBridge rồi upsert users vào `social_users`.
- One-shot social pipeline có `scripts/run-social-once.sh` để export following rồi chạy media worker một tick cho nền tảng tương ứng.
- Operational catalog status có `tools/media_status.mjs` để xem social/media/bot counts theo PostgreSQL.
- Mezon bot độc lập đã implement logic gửi media định kỳ hoặc theo command, ghi Like/Che, archive admin-only, event dedup, single-host lock, ignore self-message và normalized Mezon event fields. Button events ưu tiên `message_id` hơn event `id` để reaction/archive audit đúng message chứa media.
- Owner đã chốt bot name là `mlem`; design deployment dùng `BOT_COMMAND_PREFIX='*mlem'` để command là `*mlem`, `*mlem more`, `*mlem next`, và `*mlem thêm`.
- `social_media_download/` được chốt làm reference để tối ưu extractor TikTok/Instagram/Facebook, nhưng chỉ dùng media/page-data shape; không copy cơ chế bắt cookie, `webRequest` credential cache hoặc header rewrite.
- Command gửi thêm media hỗ trợ prefix cấu hình qua `BOT_COMMAND_PREFIX`; tests hiện cover `*bb`, `*bb more`, `*bb next`, và `*bb thêm`, còn deployment design dùng `*mlem`, `*mlem more`, `*mlem next`, và `*mlem thêm`.
- Bot/worker config fail-fast với boolean env không hợp lệ cho `MEZON_USE_SSL`, `BOT_SINGLE_HOST_LOCK`, và `SOCIAL_MEDIA_WORKER_RUN_ONCE`.
- Bot và media worker shutdown path clear interval và guard double signal để giảm rủi ro process/lock treo khi live UAT dừng.
- `tools/configure_mezon_env.mjs` đọc giá trị hiện có từ env file, validate Mezon port/timeout/boolean, hỗ trợ `--dry-run` và `--target-env-file` để kiểm tra setup mà không ghi secret file.
- `.gitignore` chặn local env files, OAuth/client-secret/authorized-user/token/credential JSON, private keys/certificates, local secret/credential/token/OAuth folders và generated exports/build output.
- `tools/verify_extension_package.mjs` kiểm tra Chrome extension manifest/protocol/file set, required capabilities gồm `tabs.close`, zip package, và hash source-vs-zip trước khi load hoặc phân phối.
- Active phase: [PHASE-002](work/phases/PHASE-002-full-browser-control.md).
- Active ticket: [TICKET-004](work/tickets/TICKET-004-media-drive-chunk-upload.md) (`implemented`, UAT pending).
- Active bug: none.

## Product decision đã chốt từ người dùng

- Single-user/personal project.
- Extension tự kết nối khi khởi động.
- Một công tắc toàn cục cho phép agent điều khiển mọi web tab được Chrome cho phép.
- Ưu tiên đơn giản, không cần pairing/tenant/tab-grant/approval/audit database trong MVP.
- Media social chỉ lấy bằng browser session; backend không nhận cookies và upload chunk trực tiếp lên Google Drive.
- Mezon user và social-platform user là hai identity riêng; bot reaction/archive chỉ dùng Mezon identity.
- Bot Mezon live dùng tên `mlem` và command prefix `*mlem`.

## Technical baseline

- Go server standard library, Chrome Manifest V3 JavaScript ES module extension.
- Shared token cấu hình một lần; WSS outbound và reconnect tự động.
- `chrome.debugger`, `chrome.tabs`, `chrome.windows`, `chrome.scripting`, downloads và storage theo capability.
- MCP adapter ở server; in-memory connection/command state; không DB trong MVP.
- Google Drive resumable upload dùng standard-library HTTP; upload session/offset lưu RAM, không ghi media xuống disk.
- Unpacked extension trong giai đoạn đầu.

## Queue

1. Connected skeleton: server, extension, WSS handshake, auto reconnect, `tabs.list`.
2. Full browser control: observe, navigate, input, tab/window, downloads/events/evaluate.
3. MCP integration, real-Chrome E2E, packaging và reliability.
4. Live social media pipeline: set Mezon credentials with `BOT_COMMAND_PREFIX='*mlem'`, connect BrowserBridge extension in Chrome, import/scrape social users, run worker and `mlem` bot against real channel.

## Latest verification

- Passed `rtk npm run check` in `bot` on 2026-08-21: 25 Node tests pass.
- Passed `rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...` in `server` on 2026-08-21.
- Passed `rtk ./scripts/doctor.sh` on 2026-08-21 for migration, bot DB flow, worker DB flow, social import, and real Drive upload.
- Passed `rtk ./scripts/wait-live-ready.sh --wait-seconds 1 --interval-seconds 1` failure-path check on 2026-08-21; it reports live gaps without printing secret values.
- Passed `rtk env WAIT_SECONDS=1 WAIT_INTERVAL_SECONDS=1 RUN_MEDIA_WORKER=false RUN_MEZON_BOT=false ./scripts/run-live-uat.sh` failure-path check on 2026-08-21; it starts Postgres/server first and gates worker/bot behind readiness.
- Passed `rtk node tools/export_social_following.mjs --platform tiktok` failure-path check on 2026-08-21; it reports server/extension setup hints as JSON instead of a stack trace.
- Passed `rtk env SOCIAL_MEDIA_PLATFORM=tiktok ./scripts/run-social-once.sh` failure-path check on 2026-08-21; it stops at export readiness failure before starting worker.
- Passed `rtk node tools/verify_social_once_flow.mjs` on 2026-08-21; fake BrowserBridge verifies `run-social-once.sh` exports following, saves `social_users`, runs worker once, and calls media transfer.
- Passed `rtk ./scripts/doctor.sh` on 2026-08-21 after adding the one-shot verifier.
- Passed `rtk node tools/media_status.mjs` on 2026-08-21; DB status JSON reports social/media/bot counts without secret values.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after strict boolean env parsing; 22 Node tests pass.
- Passed `rtk node --test bot/test/configure-mezon-env.test.js` on 2026-08-21; existing env values are preserved and output hides token values.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after bot/worker shutdown cleanup and configure CLI tests; 25 Node tests pass.
- Passed `rtk node tools/verify_extension_package.mjs` on 2026-08-21; extension manifest/protocol/files and `dist/browser-bridge-extension.zip` contain the required BrowserBridge package surface with matching source-vs-zip hashes.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after wiring extension package verification; 25 Node tests pass.
- Passed `rtk node --test bot/test/media-worker-core.test.js` on 2026-08-21 after tab cleanup changes; worker forwards `tab_id` to media upload and closes profile tabs on success/failure.
- Passed `rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...` in `server` on 2026-08-21 after adding `DELETE /v1/tabs/{id}` validation.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after adding `tabs.close`; 26 Node tests pass and extension zip verifier passes.
- Passed `rtk node --test bot/test/config.test.js bot/test/media-worker-core.test.js` on 2026-08-21 after adding scheduled `SOCIAL_MEDIA_PLATFORM=all`; config validates all/tiktok/instagram and worker aggregates per-platform ticks.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after scheduled multi-platform worker support; 28 Node tests pass.
- Passed `rtk node --test bot/test/media-worker-core.test.js` on 2026-08-21 after adding skip-existing media behavior; worker checks DB before upload and records skipped count in scrape metadata.
- Passed `rtk node tools/verify_social_once_flow.mjs` on 2026-08-21 after fake bridge learned `DELETE /v1/tabs/222`; one-shot verifier now covers export, upload request, and tab close request.
- Passed `rtk node tools/verify_worker_db_flow.mjs` on 2026-08-21 after skip-existing behavior; worker DB flow seeds an existing `media_assets` row, skips that media, uploads only the new item, and reports `skippedExisting: 1`.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after skip-existing behavior; 28 Node tests pass.
- Passed `rtk node tools/verify_bot_db_flow.mjs` on 2026-08-21 after renaming the admin button to `Delete (admin)`; verifier asserts the sent media card has `Like`, `Che`, `Delete (admin)` buttons, records one like and one dislike from separate Mezon users, exercises `bb:delete:*`, and confirms the action soft-deletes via `media_archives`/`archived_at`.
- Passed `rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh` on 2026-08-21 after adding the extension package verifier to doctor; doctor covers DB flows, social one-shot flow, extension package/zip validation, and readiness gap reporting without mutating Drive.
- Passed `rtk npm run check` in `bot` on 2026-08-21 after adding command aliases; 29 Node tests pass and cover `*bb more`, `*bb next`, and `*bb thêm`.
- Passed `rtk npm run check` in `bot` on 2026-08-23 after adding [TICKET-007](work/tickets/TICKET-007-social-media-worker-mezon-bot.md) trace artifact; 29 Node tests pass and extension package verifier passes.
- Passed `rtk node tools/verify_bot_db_flow.mjs` and `rtk node tools/verify_worker_db_flow.mjs` on 2026-08-23 after adding identity-separation assertions; bot flow reports `socialRowsForMezonUsers: 0` and worker flow reports `mezonRowsForSocialUser: 0`.
- Passed `rtk node --test test/scheduler.test.js` and `rtk npm run check` in `bot` on 2026-08-23 after extracting the shared scheduler guard; 31 Node tests pass and verify periodic bot/worker ticks do not overlap or remain stuck after errors.
- Passed `rtk node tools/verify_worker_db_flow.mjs` on 2026-08-23 after tightening upload contract assertions; worker verifier now checks tab id, social identifiers, post/media type, preview URL, MIME/filename, and extractor metadata are sent to BrowserBridge for backend Drive/DB persistence.
- Passed `rtk node tools/verify_bot_db_flow.mjs` on 2026-08-23 after extending queue coverage; bot verifier now archives the first media, confirms stale reactions are unavailable, then sends the next unarchived media card with its own Like/Che/Delete buttons.
- Passed `rtk node tools/verify_social_user_import.mjs` on 2026-08-23 after tightening social import assertions; import verifier now checks source id, username, display name, profile URL, avatar URL, original platform metadata keys, `last_scraped_at = null`, and empty scrape claim.
- Passed `rtk node tools/verify_live_readiness_reporting.mjs` on 2026-08-23; fake BrowserBridge verifies readiness output reports env presence as booleans, detects disconnected extension state, includes the Chrome extension hint, calls authenticated `/v1/status`, and does not leak the bridge auth token.
- Passed `rtk node tools/verify_social_once_flow.mjs` on 2026-08-23 after extending fake-bridge coverage to Instagram; one-shot verifier now covers TikTok and Instagram export -> `social_users` save -> worker tick -> media transfer -> profile tab close.
- Docs-only reconciliation on 2026-08-23 added [DESIGN-003](work/designs/DESIGN-003-social-media-mezon-mlem-bot.md) for the approved `mlem` bot naming, `*mlem` command prefix, bounded crawl behavior, curated Mezon posting behavior, and `social_media_download` reference guidance for TikTok/Instagram/Facebook extractor optimization. No code tests were required for this docs-only update.
- Readiness still reports setup gaps: `MEZON_BOT_ID`, `MEZON_BOT_TOKEN`, `MEZON_CHANNEL_ID`, `MEZON_ADMIN_USER_ID` not set, and BrowserBridge Chrome extension is not connected.

## Known platform limits

Không cam kết điều khiển `chrome://`, Chrome Web Store, browser chrome/UI, OS file picker, permission prompt hệ thống, CAPTCHA/MFA hoặc nội dung bị Chrome policy chặn.
