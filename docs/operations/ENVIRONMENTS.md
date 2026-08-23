# Environments

| Environment | Purpose | URL | Owner | Notes |
| --- | --- | --- | --- | --- |
| Local | Personal BrowserBridge server, Postgres, media worker and Mezon bot | `http://127.0.0.1:8788` | Owner | Postgres uses Docker Compose host port `55432`; Chrome extension must connect to WSS endpoint |

## Secrets

Document secret names only. Do not store secret values.

| Name | Used by | Required for |
| --- | --- | --- |
| `BROWSER_BRIDGE_AUTH_TOKEN` | Server, extension, tools | BrowserBridge HTTP/WSS auth |
| `BROWSER_BRIDGE_LISTEN_ADDR` | Server | Local bind address |
| `BROWSER_BRIDGE_HTTP_URL` | Tools, bot worker | Calling BrowserBridge HTTP API |
| `DATABASE_URL` | Server, bot, worker, tools | PostgreSQL catalog and bot state |
| `GOOGLE_DRIVE_FOLDER_ID` | Server/tools | Default Drive destination folder |
| `GOOGLE_DRIVE_CLIENT_SECRET_FILE` | Server/tools | Google OAuth client secret file path |
| `GOOGLE_DRIVE_CLIENT_ID` | Server/tools | Google OAuth refresh flow when not using a client-secret file |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Server/tools | Google OAuth refresh flow when not using a client-secret file |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Server/tools | Google Drive upload |
| `GOOGLE_DRIVE_ACCESS_TOKEN` | Server/tools | Optional short-lived dev upload token |
| `MEZON_BOT_ID` | Bot | Mezon client login |
| `MEZON_BOT_TOKEN` | Bot | Mezon client login |
| `MEZON_CHANNEL_ID` | Bot | Destination channel |
| `MEZON_ADMIN_USER_ID` | Bot | Archive/delete authorization |
| `MEZON_HOST` | Bot | Optional Mezon gateway override |
| `MEZON_PORT` | Bot | Optional Mezon gateway port |
| `MEZON_USE_SSL` | Bot | Optional Mezon TLS setting |
| `MEZON_TIMEOUT_MS` | Bot | Optional Mezon request timeout |
| `BOT_POST_INTERVAL_SECONDS` | Bot | Scheduler interval |
| `BOT_COMMAND_PREFIX` | Bot | Command prefix |
| `BOT_DEDUP_TTL_SECONDS` | Bot | Event dedup retention |
| `BOT_MEDIA_CLAIM_TTL_SECONDS` | Bot | Media post claim stale timeout |
| `BOT_SINGLE_HOST_LOCK` | Bot | Prevent duplicate bot process on one host |
| `BOT_LOCK_FILE` | Bot | Optional lock file path |
| `SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS` | Worker | Scrape claim stale timeout |

## Readiness

Use `./scripts/wait-live-ready.sh --wait-seconds 120 --interval-seconds 5` before a live worker/bot run. It checks BrowserBridge server health, extension connection, Drive/media-store status, PostgreSQL table counts, and required Mezon env presence without printing secret values.

Use `WAIT_SECONDS=300 ./scripts/run-live-uat.sh` for a gated local live run. It starts PostgreSQL and BrowserBridge first, waits for readiness, then starts the media worker and Mezon bot only after extension and Mezon configuration are available.

Use `SOCIAL_MEDIA_PLATFORM=all ./scripts/run-social-once.sh` after readiness passes to export following from currently open social tabs and immediately run one worker tick per platform.

Use `SOCIAL_MEDIA_PLATFORM=all ./scripts/run-media-worker.sh` for the long-running worker to scrape TikTok and Instagram sequentially each interval.

Use `node tools/media_status.mjs` to inspect social user, media, reaction, archive, and bot post counts by platform.

Use `node tools/configure_mezon_env.mjs --dry-run ...` to validate Mezon values before writing `server/.env`; the tool reports only variable presence and validation errors, never token values. Add `--target-env-file /path/to/.env` to validate an alternate env file.
