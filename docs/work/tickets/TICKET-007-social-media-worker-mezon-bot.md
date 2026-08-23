---
artifact_type: ticket
id: TICKET-007
status: in_review
owner: shared
priority: high
lane: high-risk
approval: approved
updated: 2026-08-23
human_fields:
  - title
  - priority
  - acceptance_criteria
  - scope
  - approval
ai_fields:
  - impacted_areas
  - test_expectations
  - verification_results
  - docs_review
  - context_updates
shared_fields:
  - status
  - trace
  - small_task_exemption
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-007
  requirement: user goal in active Codex thread
  phase: docs/work/phases/PHASE-003-agent-integration.md
  detail_design: docs/work/designs/DESIGN-003-social-media-mezon-mlem-bot.md
  test_verification:
    - bot/test/bot-core.test.js
    - bot/test/media-worker-core.test.js
    - bot/test/scheduler.test.js
    - tools/verify_bot_db_flow.mjs
    - tools/verify_worker_db_flow.mjs
    - tools/verify_social_user_import.mjs
    - tools/verify_social_once_flow.mjs
    - tools/verify_live_readiness_reporting.mjs
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs: []
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-007: Social media worker + mlem Mezon bot live UAT

## Field Ownership

- Human owns the product intent, live-account credentials, browser session, social-account access, Mezon channel/admin identity, and UAT sign-off.
- AI owns the implementation analysis, local verification evidence, docs reconciliation, and setup/run guidance.
- Shared fields include status, trace links, validation state, and blocker notes.

## Status

- ID: TICKET-007
- Status: in_review
- Type: feature
- Priority: high
- Phase: PHASE-003
- Owner: shared

## Trace Links

- Backlog item: [BACKLOG](../BACKLOG.md)
- Requirement: active user goal to port `mac-ocr` Mezon bot logic, keep Mezon users separate from social users, scrape social users through the browser, download/upload media to Drive/DB, and post media to Mezon as the `mlem` bot with Like/Che/admin delete buttons plus command-triggered extra posts.
- Phase: [PHASE-003](../phases/PHASE-003-agent-integration.md)
- Detail design: [DESIGN-003](../designs/DESIGN-003-social-media-mezon-mlem-bot.md)
- Test verification: `rtk npm run check` in `bot`, `rtk node tools/verify_bot_db_flow.mjs`, `rtk node tools/verify_worker_db_flow.mjs`, `rtk node tools/verify_social_once_flow.mjs`, `rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh`
- Validation matrix: [VALIDATION_MATRIX](../VALIDATION_MATRIX.md)
- Release notes: [CHANGELOG](../../releases/CHANGELOG.md)

## Context

The owner wants BrowserBridge to coordinate a browser-backed social media pipeline and a separate Mezon bot named `mlem`:

- The agent uses the connected browser session to collect followed social users and store them in `social_users`.
- A media worker periodically opens those profiles through BrowserBridge, extracts visible media, uploads chunks to Google Drive through the existing backend path, and records rows in `media_assets`.
- A separate Mezon bot uses the same PostgreSQL database to periodically send one media item to a configured channel.
- The Mezon message includes Like, Che, and one admin-only Delete button. Delete is a soft-delete/archive operation, not immediate Drive deletion.
- Channel users can request more media by command; the approved deployment prefix is `*mlem`.
- Mezon identities and social-platform identities are intentionally separate tables and contracts.

The approved behavior design has two parts: bounded crawl/collection that avoids unbounded social graph expansion, and curated Mezon posting that pulls from stored eligible media at a configured cadence or on explicit `mlem` command.

Extractor optimization should use `social_media_download` as a local reverse-engineering reference for media URL and metadata shapes, prioritizing TikTok, Instagram, then Facebook. Credential-capture patterns from that reference extension are explicitly out of scope.

The implementation mirrors the important operational patterns from `mac-ocr/omniscan`: independent Mezon client setup, self-message ignore, event dedup, user upsert on interaction, button handlers, and PostgreSQL-backed state.

## Acceptance Criteria

- Social following export can discover a connected TikTok or Instagram tab through BrowserBridge and upsert platform users into `social_users`.
- Media worker claims due `social_users`, opens each profile in Chrome through BrowserBridge, runs the relevant extractor in page context, uploads only new media, stores Drive/metadata rows in `media_assets`, and clears or expires scrape claims safely.
- Worker supports TikTok, Instagram, and scheduled `SOCIAL_MEDIA_PLATFORM=all`.
- TikTok and Instagram extractor improvements should prefer page-visible/media-shape learnings from `social_media_download` without copying cookie/webRequest credential interception.
- Facebook is a planned next platform slice, not part of the current verified worker support.
- Worker skips media already present by `(platform, source_user_id, media_id)` and closes profile tabs after scrape attempts.
- Bot is independent from the BrowserBridge server and worker but connects to the same PostgreSQL database.
- Bot can send scheduled media and command-triggered media to the configured Mezon channel.
- Deployed bot naming uses `mlem`, with `BOT_COMMAND_PREFIX='*mlem'`.
- Bot messages include Like, Che, and `Delete (admin)` buttons.
- Like/Che writes one reaction per Mezon user per media; changing a reaction updates the existing row.
- Delete is enforced by configured `MEZON_ADMIN_USER_ID`, writes `media_archives`, sets `media_assets.archived_at`, and keeps the Drive file untouched.
- Mezon users are stored in `mezon_users`; social users remain in `social_users`; no code path merges those identities.
- Bot ignores its own messages and deduplicates reconnect/retry events.
- Live UAT proves the flow with real Chrome extension connection, real social profile visibility, real Google Drive folder, and real Mezon channel/admin identity.

## Small Task Exemption

- Small task exemption: no
- Reason: the original implementation changes DB schema, runtime processes, and external integrations.
- Impact checked: API=yes, DB=yes, Security=yes, Runtime=yes, Standards=no

## Impacted Areas

- Code: `bot/`, `tools/export_social_following.mjs`, `tools/import_social_users.mjs`, `tools/social_db.mjs`, `scripts/run-social-once.sh`, `scripts/run-media-worker.sh`, `scripts/run-bot.sh`, `scripts/run-stack.sh`, `scripts/run-live-uat.sh`, `server/internal/store/postgres.go`
- Reference corpus: `social_media_download/` is allowed for extractor/media-shape analysis; its cookie/webRequest/declarativeNetRequest credential and header rewrite mechanisms are not to be copied into BrowserBridge.
- Requirements docs: README and project context describe the user-facing workflow.
- Architecture docs: server/database boundary and browser-cookie boundary are inherited from Drive upload architecture.
- API docs: BrowserBridge tab/evaluate/upload capabilities are used; no Mezon HTTP API is exposed by BrowserBridge.
- ERD/data docs: PostgreSQL tables `social_users`, `media_assets`, `mezon_users`, `media_reactions`, `media_archives`, `bot_media_posts`, `bot_event_dedup`.
- Decisions: No new ADR yet; a future durable change to identity model, deletion semantics, auth, or scheduling should create one.

## Detail Design

- Required: yes for the original non-small feature.
- Link: [DESIGN-003](../designs/DESIGN-003-social-media-mezon-mlem-bot.md)
- Approval: approved through iterative owner direction in the active thread for the `mlem` bot naming, `*mlem` command prefix, bounded crawl behavior, and curated Mezon posting behavior. Future DB/schema/runtime changes, including per-media retry job tables, must get a separate detail design before implementation.

## Test Expectations

- Unit tests cover command parsing through configurable `BOT_COMMAND_PREFIX`, event normalization, self-message guard, send-next behavior, claim release on send failure, button parsing, admin enforcement, worker platform/extractor behavior, and non-overlapping scheduled runs.
- Integration verifiers cover PostgreSQL migrations, bot DB flow, worker DB flow, social import metadata, one-shot social export plus worker runner against a fake BrowserBridge, and live-readiness reporting/redaction.
- Platform/live UAT must cover real Chrome extension connection, real social tab/session, real Drive upload path, and real Mezon channel messages/buttons.
- Future TikTok/Instagram/Facebook extractor work must add normalized-media tests and fake-bridge integration coverage before live UAT.

## Verification Results

- Command: `rtk npm run check` in `bot`
- Result: pass on 2026-08-23; 31 Node tests pass and extension package verifier runs.
- Notes: Covers bot core, config validation, worker core, scheduler guard behavior, lock behavior, configure-Mezon-env, and extension package integrity.

- Command: `rtk node --test test/scheduler.test.js` in `bot`
- Result: pass on 2026-08-23.
- Notes: Verifies overlapping scheduled runs are skipped, later intervals can run after completion, and scheduler errors do not leave the runner stuck.

- Command: `rtk node tools/verify_bot_db_flow.mjs`
- Result: pass on 2026-08-23.
- Notes: Seeds media and Mezon users, verifies card button ids/labels for Like, Che, `Delete (admin)`, records like/dislike, denies non-admin archive, confirms admin soft-delete archive state, asserts Mezon user IDs are not mirrored into `social_users`, and verifies the bot skips the archived media and sends the next available media asset.

- Command: `rtk node tools/verify_worker_db_flow.mjs`
- Result: pass on 2026-08-23.
- Notes: Seeds social user and duplicate media, verifies only new media uploads and skipped-existing metadata is recorded, asserts social user IDs are not mirrored into `mezon_users`, and asserts the BrowserBridge upload payload carries the tab id, social identifiers, post/media type, preview URL, MIME/filename, and extractor metadata needed for backend `media_assets` persistence.

- Command: `rtk node tools/verify_social_user_import.mjs`
- Result: pass on 2026-08-23.
- Notes: Verifies imported social users persist platform/source id, username, display name, profile URL, avatar URL, original platform metadata keys, and remain immediately scrape-eligible with `last_scraped_at = null` and no scrape claim.

- Command: `rtk node tools/verify_social_once_flow.mjs`
- Result: pass on 2026-08-23.
- Notes: Fake BrowserBridge covers TikTok and Instagram following export, `social_users` save, worker tick, media transfer request, scrape metadata, and profile tab close request for both platforms.

- Command: `rtk node tools/verify_live_readiness_reporting.mjs`
- Result: pass on 2026-08-23.
- Notes: Fake BrowserBridge verifies readiness output reports env presence as booleans, detects disconnected extension state, includes the Chrome extension connection hint, calls the authenticated status endpoint, and does not leak the bridge auth token.

- Command: `rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh`
- Result: pass on 2026-08-21.
- Notes: Covers DB flows, social one-shot flow, extension package/zip validation, and readiness gap reporting without mutating Drive.

## Fix/Test Attempt Log

- Same-path failure attempts: 0 / 3
- Total fix/test cycles: 0 / 5 for this documentation trace artifact
- Blocked by loop guard: no
- Human/design input needed: live Mezon credentials/channel/admin identity and connected Chrome extension session for UAT.

## UAT

- Required: yes
- Reason if not required: not applicable
- Expected behavior: with configured Mezon credentials, `BOT_COMMAND_PREFIX='*mlem'`, and connected Chrome extension, the pipeline imports social users, uploads media to the configured Drive folder, records DB metadata, posts media cards to the Mezon channel as `mlem`, accepts Like/Che, allows only the admin to delete/archive, and sends more media on `*mlem` commands.
- Verified behavior: local automated and fake-bridge verification pass; real Mezon/Chrome/social UAT is pending.
- Sign-off: pending owner live UAT.

## Docs Review

- Requirements updated or not needed reason: README documents social export, worker, `mlem` bot command configuration, identity separation, setup, and live UAT flow.
- Architecture updated or not needed reason: existing Drive/browser boundary covers the sensitive cookie/Drive path; no new backend social-cookie storage was added.
- API updated or not needed reason: no new public HTTP API beyond existing BrowserBridge tab/evaluate/upload capabilities already documented in README/server docs.
- ERD/data updated or not needed reason: schema exists in server and bot migrations; validation matrix records the bot/social tables and flows.
- ADR created or not needed reason: not created for this naming/design update; current choices follow owner-directed personal-project constraints and existing ADR-002 cookie/Drive boundary.
- `docs/CONTEXT.md` updated: yes, current status and verification list include bot/social pipeline state.

## Completion Checklist

- [x] Implementation complete for local/fake-bridge path
- [x] Tests run and recorded for local/fake-bridge path
- [x] Fix/test loop guard respected
- [x] Validation matrix updated for local/fake-bridge path
- [ ] UAT completed with real Chrome extension/social tab/Mezon channel
- [x] Master docs reconciled for current behavior
- [x] Docs review completed for this artifact
- [ ] ADR created or explicitly not needed after final UAT review
- [x] `docs/CONTEXT.md` updated
- [x] `docs/work/BACKLOG.md` updated
- [x] Trace links updated
