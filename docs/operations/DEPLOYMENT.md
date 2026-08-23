# Deployment

## Deployment Targets

- Local personal mode: Go server listens on `127.0.0.1:8788`, extension connects to `ws://127.0.0.1:8788/v1/extension`.
- Remote personal mode: put the Go server behind HTTPS/TLS ingress and configure extension with `wss://<host>/v1/extension`.

## Process

1. Generate a long random `BROWSER_BRIDGE_AUTH_TOKEN`.
2. Start the server:

```bash
export BROWSER_BRIDGE_AUTH_TOKEN='replace-with-random-secret'
cd server
go run ./cmd/browser-bridge
```

3. For Google Drive upload, configure either short-lived dev token:

```bash
export GOOGLE_DRIVE_ACCESS_TOKEN='ya29...'
```

or refresh-token mode:

```bash
export GOOGLE_DRIVE_CLIENT_ID='...apps.googleusercontent.com'
export GOOGLE_DRIVE_CLIENT_SECRET='...'
export GOOGLE_DRIVE_REFRESH_TOKEN='...'
```

or client-secret-file mode:

```bash
export GOOGLE_DRIVE_CLIENT_SECRET_FILE='/absolute/path/client_secret_*.json'
export GOOGLE_DRIVE_REFRESH_TOKEN='...'
```

4. Load `extension/` as an unpacked Chrome extension and set the same token.
5. Keep backend logs away from public sinks; request URLs and filenames can be user-sensitive.

## Rollback

- Stop the server or unset Google Drive env vars. Without Drive config, `/v1/media/upload-sessions` returns `503` while browser status/tabs routes keep working.
- Disable extension `Enable browser control` to stop WSS commands immediately.

## Verification

- `go test ./...` from `server/`.
- `node --check extension/background.js`.
- Auth smoke test: bad bearer token on `/v1/media/upload-sessions` returns `401`.
- Drive smoke test with real credentials: call `/v1/media/transfers` for a media URL currently accessible in the selected Chrome tab and confirm Drive returns final file metadata.
