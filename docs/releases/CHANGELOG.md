---
artifact_type: changelog
id: CHANGELOG
status: active
owner: shared
human_fields: [release_approval]
ai_fields: [change_entries, linked_releases]
shared_fields: [status]
---

# Changelog

## Unreleased

- Added personal Browser Bridge Phase 1 source skeleton: self-contained Go WebSocket server and unpacked MV3 extension with shared-token auth, On/Off, reconnect/heartbeat and `tabs.list`.
- Added Browser media chunk upload to Google Drive with backend resumable proxy, Drive folder configuration and PostgreSQL `media_assets` persistence.
- Added PostgreSQL-backed social user catalog, media worker, and independent Mezon bot flow with scheduled/manual media posts, Like/Che reactions, admin-only archive, event dedup and process lock.
- Hardened Mezon bot event handling with self-message ignore and normalized snake/camel/Pascal event fields, matching the operational patterns ported from `mac-ocr` OmniScan.
- Fixed button event normalization so reaction/archive audit uses the media message ID rather than a button-click event ID when both are present.
- Tightened bot/worker boolean env parsing so typo values fail startup instead of being interpreted as false.
- Hardened bot and media worker shutdown by clearing intervals and guarding duplicate signal handling.
- Added validation and `--dry-run` mode to `tools/configure_mezon_env.mjs` so Mezon setup can be checked without writing or printing secrets.
- Updated `tools/configure_mezon_env.mjs` to preserve existing env-file values and support `--target-env-file` for alternate setup validation.
- Added local setup/verification scripts for Postgres migration, Drive upload, social import, bot DB flow, worker DB flow, and pipeline readiness.
- Added `scripts/wait-live-ready.sh` for polling live BrowserBridge/extension/PostgreSQL/Mezon readiness without exposing secrets.
- Added `scripts/run-live-uat.sh` to start PostgreSQL and BrowserBridge first, wait for live readiness, then launch the media worker and Mezon bot.
- Added `tools/export_social_following.mjs` to discover open TikTok/Instagram tabs through BrowserBridge and run the platform following exporters.
- Added `scripts/run-social-once.sh` for one-shot social following export followed by one media-worker tick per requested platform.
- Added `tools/verify_social_once_flow.mjs` to exercise `run-social-once.sh` against a fake BrowserBridge and real PostgreSQL without Chrome.
- Added `tools/media_status.mjs` for PostgreSQL social/media/bot operational counts.
- Added secret-focused `.gitignore` coverage for env files, OAuth/client/authorized-user credential JSON, tokens, private keys/certificates and local secret/credential/token/OAuth folders.
- Added `tools/verify_extension_package.mjs` and wired it into `bot` checks to validate the MV3 extension files and zip package.
- Added BrowserBridge `tabs.close` capability plus `DELETE /v1/tabs/{id}` so the media worker can close social profile tabs after scraping.
- Updated the media worker to pass profile `tab_id` into media upload requests, ensuring authenticated MAIN-world fallback fetches run in the intended social tab.
- Added scheduled `SOCIAL_MEDIA_PLATFORM=all` support so the long-running media worker processes TikTok and Instagram in each tick.
- Added worker-side `media_assets` existence checks so periodic scrapes skip media already saved instead of re-downloading/re-uploading duplicate Drive files.
- Renamed the admin media action button to `Delete (admin)` while preserving soft-delete/archive storage semantics and backward-compatible `bb:archive:*` button parsing.
- Added extension package verification to `scripts/doctor.sh` so local doctor runs validate the MV3 source/zip package before live readiness.
- Added send-more command aliases for the Mezon bot: `*bb next` and `*bb thêm` in addition to `*bb` and `*bb more`.
- Added `TICKET-007` trace artifact for the social media worker and Mezon bot live UAT scope, acceptance criteria, evidence, and remaining live blockers.
- Added `DESIGN-003` to capture the approved `mlem` bot name, `*mlem` command prefix, bounded social crawl behavior, curated Mezon posting behavior, and `social_media_download` reference guidance for TikTok/Instagram/Facebook extractor optimization without copying credential-capture patterns.
- Added explicit verifier assertions that Mezon identities are not mirrored into `social_users` and social identities are not mirrored into `mezon_users`.
- Added a shared scheduler guard for the Mezon bot and media worker, with tests proving periodic runs skip overlaps and recover after scheduled task errors.
- Tightened the worker DB flow verifier to assert the BrowserBridge upload payload includes the metadata needed for backend Drive upload and `media_assets` persistence.
- Extended the bot DB flow verifier to prove the media queue skips archived items and sends the next available media card after admin delete/archive.
- Tightened the social user import verifier to assert display/profile/avatar fields, original platform metadata, and immediate scrape eligibility are preserved in `social_users`.
- Added a live-readiness reporting verifier that uses a fake BrowserBridge to prove env flags are boolean, extension-disconnected hints are present, authenticated status is called, and bridge tokens are not leaked.
- Extended the one-shot social pipeline verifier to cover both TikTok and Instagram export, worker upload, and profile tab cleanup against a fake BrowserBridge.
- Added PHASE-004 planning for the remaining resilient agent-controlled social pipeline work, split into TICKET-008..011 with explicit dependencies and acceptance criteria.
- Added DESIGN-005 and ADR-003 to define exactly two PostgreSQL schemas (`gateway` and `bot`), non-destructive migration ownership, per-media retry/dead-letter, one fixed Google Drive folder, and Drive file/folder ID tracking.
- Reconciled planned requirements, architecture, API, ERD, SDD, roadmap and validation rows for TikTok/Instagram/Facebook collector parity and scoped/audited agent control APIs/MCP; no runtime behavior changed in this docs-only update.
- Completed PHASE-004 implementation-ready design annexes: exact two-schema DDL and non-destructive migration/rollback; collector/media/bot sequence and state flows; retry/error/lease/fixed-Drive/platform contracts; and exact agent HTTP/MCP, session, permission, pagination, idempotency, redaction and audit contracts.
- Added proposed ADR-004 for short-lived scoped agent sessions with deny-by-default policy and shared HTTP/MCP enforcement. Runtime remains unchanged pending owner approval.
- Refined PHASE-004 design with `gateway.operational_errors`, end-to-end trace/request/job/attempt/audit correlation, component/stage error queries through HTTP/MCP, and a PostgreSQL-outage structured-log fallback.
- Chose MCP as the primary executable agent surface and limited optional skills to secret-free workflow guidance; API/session/provider credentials remain in gateway/MCP process configuration or OS secret storage.
- Added ADR-004 (proposed) for scoped agent sessions with deny-by-default policy, redacted audit and shared HTTP/MCP enforcement.
- **Deferred ADR-004, TICKET-011, DESIGN-004 and its API annex in favour of a single-scope API key model** (ADR-005, TICKET-012, DESIGN-006). The scoped-session model is retained, not rejected, and is additive if the deployment ever gains multiple agents, untrusted callers, a non-localhost bind or an audit requirement.
- Added ADR-005 to authenticate agents with single-scope API keys stored in `gateway.api_keys` (SHA-256 only) and cached in the existing `dev-env` Redis container with no expiry and a PostgreSQL cache-aside fallback. Key management is CLI-only (`bb-apikey`) and can never be performed through an HTTP route, so one leaked key cannot mint a replacement.
- **Accepted, recorded risks**: one key grants `POST /v1/runtime/evaluate`; BrowserBridge depends on a Redis container it does not own; issuing/revoking writes PostgreSQL before Redis, so a failed Redis write must be retried; `scripts/doctor.sh` does not manage that container's lifecycle.
- Amended TICKET-008 to accept a deliberate media-worker outage between it and TICKET-009: dropping the legacy social claim columns removes the collector claim path until `gateway.collector_jobs` exists, so `verify_worker_db_flow` and `verify_social_once_flow` are excluded and the worker is non-functional during the window.
- Scoped `drive_folder_id` into TICKET-008 so `SaveMediaAsset` writes a non-empty folder and creates the paired `bot.media_delivery_state` row in one transaction, preventing a `NOT NULL` failure immediately after the schema cutover.

## Field Ownership

- Human owns release approval.
- AI maintains change entries and links to release notes.

All notable changes should be recorded here.

## [1.1.1] - 2026-06-07

### Changed
- **Debugging Standards Enhancements**: Upgraded `docs/standards/DEBUGGING.md` to include 5 major proactive bug-fixing practices for AI agents. The detailed rationale for these changes is as follows:
  - **Assess Impact (Blast Radius Analysis)**:
    - *Problem:* Fixing a local bug in a shared library or core utility can cause a chain reaction, breaking multiple other features.
    - *Solution:* Added a mandatory `Assess Impact` phase before implementing fixes, requiring agents to find references and verify that the proposed change will not break dependent features.
  - **Horizontal Fix & Proactive Search**:
    - *Problem:* Fixing a single instance of a bug (e.g., a missing null check) often leaves similar undiscovered vulnerabilities elsewhere in the codebase.
    - *Solution:* Added a `Proactive Search` phase. After fixing the local bug, agents must scan the entire codebase for the same problematic pattern and address it proactively.
  - **Telemetry First for Opaque Bugs**:
    - *Problem:* The previous standard mandated blocking a bug if it could not be reproduced locally, which could stall progress on environment-specific production issues.
    - *Solution:* If a bug lacks local reproduction steps but occurs in higher environments, the agent must create a PR/Ticket to add Telemetry/Logs/Tracing to gather data before marking it as blocked.
  - **Strict Red-Green Testing**:
    - *Problem:* Writing regression proofs after the fix or without explicit validation can lead to tests that always pass, providing a false sense of security.
    - *Solution:* Enforced strict Red-Green testing. The regression test MUST be written and fail (Red) with recorded output *before* any fix code is written, ensuring the test is actually catching the bug.
  - **Anti-Patterns Documentation (Post-mortem)**:
    - *Problem:* Valuable knowledge gained from complex architectural bugs is often lost after the fix is merged.
    - *Solution:* Required documenting root causes and gotchas as *Anti-Patterns* during the Reconcile phase so future agents avoid repeating the same mistakes.

## [1.1.0] - 2026-06-05

### Added
- **Feedback Intake Flow**: Added `PHASE 0: FEEDBACK INTAKE & TRIAGE` to the Agent Lifecycle.
- **Feedback Funnel**: Created `docs/work/FEEDBACK_LOG.md` to serve as the raw intake funnel for all user feedback before entering the backlog.
- **Feedback Template**: Created `docs/templates/FEEDBACK.md` for deep-dive analysis of complex user feedback.
- **SDD Template**: Added `docs/templates/SDD.md` (Software Design Document) to track high-level system architecture and required its synchronization upon detail design changes in `DOCS.md`.

### Changed
- **Triage Types**: Allowed triage types for user feedback in `WORKFLOW.md` now explicitly include `Enhancement`.
- **Detail Design Revamp**: Revamped `docs/templates/DETAIL_DESIGN.md` structure. It now integrates visual components (Architecture Overview, Execution Flow, API & Data Model Design, Security) while retaining strict Harness lifecycle metadata and reconciliation rules.
- **Agent Rules**: Updated `AGENTS.md` (Rule 9: Completion Rules) to strictly enforce writing framework and user-facing changes to `CHANGELOG.md`.
- **Docs Guide**: Updated `docs/README.md` to include the new templates and feedback intake funnel.

## [1.0.0] - 2026-06-05

### Added
- Initial SDLC agent framework scaffold.
