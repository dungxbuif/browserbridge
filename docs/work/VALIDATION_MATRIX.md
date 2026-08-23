---
artifact_type: validation_matrix
id: VALIDATION_MATRIX
status: active
owner: shared
updated: 2026-08-23
---

# Validation Matrix

| Contract/behavior | Unit | Integration | E2E | Manual/platform | Status |
| --- | --- | --- | --- | --- | --- |
| Token handshake, version, bad token | yes | partial | no | no | in_progress — protocol/server unit evidence; real socket UAT pending |
| Auto-connect, heartbeat, reconnect, On/Off | no | partial | no | Chrome Linux | in_progress — extension syntax evidence; Chrome UAT pending |
| Chrome extension package integrity | yes | yes | no | local zip | verified - `rtk node tools/verify_extension_package.mjs` and `rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh` check MV3 manifest, BrowserBridge URL, required capabilities including `tabs.close`, required files, `dist/browser-bridge-extension.zip` contents, and source-vs-zip hashes |
| Tabs/windows/navigation | partial | partial | no | Chrome Linux | in_progress — `tabs.list` implemented; Chrome UAT pending |
| Snapshot/screenshot/input/evaluate | yes | yes | yes | Chrome Linux | planned |
| Dialog/file/download/events | yes | yes | yes | capability scenarios | planned |
| Browser media -> backend chunks -> Google Drive | yes | yes | no | Google OAuth | verified - `rtk ./scripts/doctor.sh` created a Drive file through backend upload; Chrome fallback UAT still pending |
| Social user catalog import and scrape claims | yes | yes | no | PostgreSQL | verified - `rtk node tools/verify_social_user_import.mjs` passed on 2026-08-23 and covers platform/source id, username, display name, profile URL, avatar URL, original platform metadata keys, import with `last_scraped_at = null`, and no scrape claim; `rtk ./scripts/doctor.sh` covers migration and scrape claim/release/clear |
| Social following exporter tab discovery | yes | partial | no | BrowserBridge extension | in_progress - `rtk node tools/export_social_following.mjs --platform tiktok` failure path reports server/extension hints; live export requires connected social tab |
| One-shot social export plus worker runner | yes | yes | no | BrowserBridge extension | in_progress - `rtk node tools/verify_social_once_flow.mjs` passed on 2026-08-23 and exercises TikTok + Instagram export -> `social_users` -> worker tick -> media transfer -> profile tab close with fake BrowserBridge; live run requires connected extension/social tab |
| PostgreSQL social/media/bot status reporting | yes | yes | no | PostgreSQL | verified - `rtk node tools/media_status.mjs` reports table/platform/activity counts without secret values |
| Media worker social scrape -> Drive upload request -> media metadata | yes | yes | no | BrowserBridge extension | in_progress - `rtk node tools/verify_worker_db_flow.mjs` passed on 2026-08-23 with fake bridge and asserts upload payload includes tab id, media URL, filename/MIME, social identifiers, post/media type, preview URL, and extractor/page metadata; live extension scrape/upload pending |
| Extractor optimization from `social_media_download` reference | no | no | no | local reference review | planned - DESIGN-003 records TikTok/Instagram/Facebook media-shape references and explicitly excludes cookie/webRequest credential capture and header rewrite patterns; implementation/tests pending |
| Media worker skip-existing uploads | yes | yes | no | PostgreSQL | verified - `rtk node --test bot/test/media-worker-core.test.js` checks existing `media_assets` are skipped before upload; `rtk node tools/verify_worker_db_flow.mjs` seeds a duplicate media row, uploads only the new item, and reports `skippedExisting: 1` |
| Scheduled multi-platform media worker | yes | no | no | local process | verified - `rtk node --test bot/test/config.test.js bot/test/media-worker-core.test.js` covers `SOCIAL_MEDIA_PLATFORM=all` expansion to TikTok + Instagram and rejects unsupported platforms |
| Periodic bot/worker non-overlap guard | yes | no | no | local process | verified - `rtk node --test test/scheduler.test.js` passed on 2026-08-23 and covers skipping overlapping interval runs, running again after completion, and recovering after scheduled task errors |
| Media worker profile tab cleanup | yes | partial | no | BrowserBridge extension | verified - `rtk node --test bot/test/media-worker-core.test.js` confirms worker forwards `tab_id` and closes opened profile tabs; `rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...` covers `DELETE /v1/tabs/{id}` validation |
| Mezon bot media post, command, Like/Che, admin delete/archive | yes | yes | no | Mezon channel | in_progress - `rtk node tools/verify_bot_db_flow.mjs` passed on 2026-08-23 and verifies media card button ids/labels for `Like`, `Che`, `Delete (admin)`, records like/dislike from separate Mezon users, denies non-admin archive, soft-deletes into `media_archives`, treats stale archived media as unavailable, and sends the next unarchived media asset; live Mezon credentials/channel pending |
| Mezon/social identity separation | yes | yes | no | PostgreSQL | verified - `rtk node tools/verify_bot_db_flow.mjs` passed on 2026-08-23 and reports `socialRowsForMezonUsers: 0`; `rtk node tools/verify_worker_db_flow.mjs` passed on 2026-08-23 and reports `mezonRowsForSocialUser: 0` |
| mlem bot send-more command aliases | yes | no | no | Mezon channel | verified - `rtk npm run check` passed on 2026-08-23 with 31 Node tests and covers configured-prefix aliases using the tested `*bb` prefix; approved deployment design sets `BOT_COMMAND_PREFIX='*mlem'`, yielding `*mlem`, `*mlem more`, `*mlem next`, and `*mlem thêm`; live Mezon channel UAT pending |
| Bot dedup, media claims, single-host lock, self-message guard | yes | yes | no | PostgreSQL/process | verified - `rtk npm run check` and `rtk ./scripts/doctor.sh` covered event dedup, media claim release/clear, lock behavior, self-message guard, normalized event IDs, and button `message_id` precedence |
| Bot/worker config fail-fast validation | yes | no | no | local env | verified - `rtk npm run check` covers invalid `MEZON_USE_SSL`, `BOT_SINGLE_HOST_LOCK`, and `SOCIAL_MEDIA_WORKER_RUN_ONCE` boolean values |
| Bot/worker shutdown cleanup | yes | no | no | local process | verified - `rtk npm run check` covers syntax after guarded shutdown and interval cleanup changes; live signal UAT pending |
| Safe Mezon env writer validation | yes | no | no | local env | verified - `rtk node --test bot/test/configure-mezon-env.test.js` validates port/boolean, preserves existing env values, writes quoted values, and reports only variable presence |
| Live readiness reporting without secret leakage | yes | partial | no | local env | verified - `rtk node tools/verify_live_readiness_reporting.mjs` passed on 2026-08-23 with a fake BrowserBridge and confirms boolean env presence, disconnected extension hint, authenticated status call, and no bridge token leak; `rtk ./scripts/wait-live-ready.sh --wait-seconds 1 --interval-seconds 1` reports missing Mezon/server/extension state with boolean env flags only |
| Gated live UAT startup sequencing | yes | partial | no | local processes | verified - `rtk env WAIT_SECONDS=1 WAIT_INTERVAL_SECONDS=1 RUN_MEDIA_WORKER=false RUN_MEZON_BOT=false ./scripts/run-live-uat.sh` starts Postgres/server and blocks worker/bot until readiness |
| MCP golden flow | yes | yes | yes | AI client | planned |
| Chrome restart/service-worker suspend | no | yes | yes | Linux/Windows/macOS smoke | planned |
| Token/log/payload redaction | yes | yes | no | log inspection | planned |
| Secret file ignore coverage | no | partial | no | git worktree | verified - `.gitignore` excludes env files, OAuth/client-secret/authorized-user JSON, credential/token JSON, private keys/certificates, local secret/credential/token/OAuth folders, exports, logs, and build output; `git check-ignore` could not run because this workspace is not currently initialized as a Git repository |

Không có row nào được chuyển `implemented` trước khi có link evidence.
