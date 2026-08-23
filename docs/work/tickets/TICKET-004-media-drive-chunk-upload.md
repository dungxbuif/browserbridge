---
artifact_type: ticket
id: TICKET-004
status: implemented
owner: shared
priority: high
lane: high-risk
approval: approved
updated: 2026-08-20
trace:
  requirement: FR-010, FR-017, NFR-009
  phase: PHASE-002
  detail_design: DESIGN-002
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  adrs:
    - ADR-002
---

# TICKET-004: Browser media chunk upload to Google Drive

## Context

Owner cần lấy media mà phiên Chrome hiện tại được phép truy cập và chuyển thẳng lên Google Drive. Cookie/session social chỉ được dùng trong browser context; backend không được nhận hoặc lưu credential social.

## Acceptance Criteria

- `media.uploadToDrive` nhận media URL, filename, optional tab/folder và upload theo chunk.
- Backend mở Google Drive resumable upload session và proxy từng chunk ngay sang Drive, không tạo file media tạm.
- Extension thử fetch trong service worker; khi cần phiên trang, fallback sang `MAIN` world của tab mà không đưa bridge token vào page context.
- Mọi API upload yêu cầu shared bearer token, validate range/size/order và giới hạn request body.
- Google OAuth refresh token chỉ tồn tại ở backend; social cookie không rời trình duyệt.
- API, architecture, SDD, requirements, deployment, context và validation docs phản ánh implementation thực tế.

## Scope

In scope: generic browser media URL transfer, chunk transport, Drive resumable upload, OAuth token refresh, retry-safe sequential offsets, tests và docs.

Out of scope: tự phát hiện Instagram/TikTok URL, bulk profile crawler, persistence qua server restart, parallel/out-of-order chunks, Drive account UI và bypass DRM/CAPTCHA/paywall.

## Impacted Areas

- Code: `extension/`, `server/internal/bridge`, new `server/internal/drive`, server startup config.
- API: HTTP transfer/session endpoints and WSS method `media.uploadToDrive`.
- Security: new Google OAuth secret and browser-to-backend byte path.
- Data: in-memory upload session metadata only; no database or file spool.
- Docs: requirements, architecture, API, SDD, integrations, deployment and context.

## Detail Design

- Required: yes
- Link: [DESIGN-002](../designs/DESIGN-002-media-drive-chunk-upload.md)
- Approval: approved by owner choice on 2026-08-20

## Test Expectations

- Go unit/integration tests cover auth, session creation, ordered chunks, completion and invalid ranges.
- JavaScript syntax checks cover modified extension modules.
- Real Chrome/Google Drive UAT remains required because OAuth and MV3 behavior need owner credentials.

## Verification Results

- Implemented backend Drive resumable client, in-memory upload sessions and HTTP transfer/session routes.
- Implemented extension `media.uploadToDrive` with direct service-worker fetch and MAIN-world fallback.
- Passed `rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...` on 2026-08-20.
- Passed `rtk node --check extension/background.js` on 2026-08-20.
- Real Chrome/Google Drive UAT is still pending owner OAuth configuration.

## Fix/Test Attempt Log

- Same-path failure attempts: 0 / 3
- Total fix/test cycles: 2 / 5
- Blocked by loop guard: no

## UAT

- Required: yes
- Expected: a media URL accessible in Chrome appears in the selected Drive folder with identical byte size.
- Verified: automated server/extension checks pass; real Drive upload pending owner Google OAuth configuration and Chrome run.
