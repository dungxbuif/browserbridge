---
artifact_type: ticket
id: TICKET-010
status: in_progress
owner: shared
priority: high
lane: high-risk
approval: approved_by_owner_chat
updated: 2026-08-25
trace:
  backlog_item: docs/work/BACKLOG.md#ticket-010
  feedback: docs/work/FEEDBACK_LOG.md#fb-004--resilient-social-media-agent-gateway
  requirement: FR-020, NFR-010
  phase: docs/work/phases/PHASE-004-resilient-agent-gateway.md
  detail_design: docs/work/designs/DESIGN-005-two-schema-resilient-social-pipeline.md
  detail_design_annex: docs/work/designs/DESIGN-005-FLOWS.md
  test_verification: planned normalized fixture, fake-bridge and live platform tests
  validation_matrix: docs/work/VALIDATION_MATRIX.md
  docs_review: this ticket
  adrs:
    - docs/decisions/ADR-002-browser-media-drive-boundary.md
  release_notes: docs/releases/CHANGELOG.md
---

# TICKET-010: TikTok, Instagram, and Facebook collector parity

## Context and scope

TikTok and Instagram have current worker support; Facebook is missing. Refactor all three behind one normalized adapter contract and use `social_media_download/` only as a local reference for page/media shapes.

Owner approved implementation in chat on 2026-08-25 after clarifying that bulk media APIs/jobs, not general browser manipulation, are the primary requirement. First implementation slice keeps the existing `public` tables until PHASE-004 migration is safe.

In scope: adapter interface, TikTok/Instagram hardening, Facebook collector/exporter, carousel/image/video normalization, best-quality candidate selection, bounded pagination, enqueue into durable media jobs, tab cleanup and tests.

Out of scope: credential interception/export, private provider API emulation, CAPTCHA/MFA bypass, anti-bot evasion, arbitrary graph expansion, and platforms beyond TikTok/Instagram/Facebook.

## Acceptance criteria

- [ ] `SOCIAL_MEDIA_PLATFORM=all` expands to exactly TikTok, Instagram and Facebook.
- [ ] All adapters return the DESIGN-005 normalized media contract with stable source/user/media IDs.
- [ ] Carousel order and media type are preserved; duplicate candidates normalize to one job identity.
- [x] Collectors use only content available to the owner's active browser session for the first TikTok profile-media slice.
- [ ] No code copies cookie/webRequest credential capture, CSRF/device-token cache or declarative header rewrite behavior from the reference extension.
- [ ] Bounded page/item limits, cooldown and tab cleanup apply to every platform.
- [ ] Fake-bridge tests cover all three; live UAT records one visible profile and one successful image upload per platform.

## Impact and approval

- Small task exemption: no.
- Impact checked: API=no, DB=yes, Security=yes, Runtime=yes, Standards=no.
- Dependencies: TICKET-008 and TICKET-009.
- Detail design: [DESIGN-005](../designs/DESIGN-005-two-schema-resilient-social-pipeline.md), approval pending.

## Verification plan

- Unit: saved fixtures/page-state samples for normalized image/video/carousel output.
- Integration: fake BrowserBridge export, profile open/evaluate, job enqueue and tab close for all three platforms.
- Security/static: reject imports or code patterns that use social cookies/request credential caches/provider secret headers.
- Live UAT: owner-visible account/profile on each platform; no requirement to bypass platform blocks.

## Normative contract

- [Runtime and platform flow](../designs/DESIGN-005-FLOWS.md)
- Each carousel child is a separate image/video item with stable provider ID or `{post_id}:item:{position}` fallback.
- Facebook initial following discovery is bounded visible-DOM collection; no private GraphQL replay or `fb_dtsg` use.

## Completion state

- Implementation: in progress. First slice complete: session-safe tab reuse/open/close behavior, TikTok `/api/post/item_list/` cursor pagination, and `tools/collect_user_media.mjs` for TikTok/Instagram profile-media runner.
- UAT: required per platform.
- Docs reconciliation required: requirements, architecture, API media contract, context, validation matrix and changelog.

## Progress checklist

- [x] Feedback, phase, design and backlog trace created.
- [x] Owner approved first pre-migration bulk-media implementation slice in chat.
- [ ] TICKET-008/009 verified; detail design approved; durable queue path moved to `ready`.
- [x] TikTok profile-media pagination and session-safe tab handling implemented with unit tests.
- [ ] TikTok saved-media collector implemented.
- [ ] Instagram saved-media collector implemented.
- [ ] Facebook profile-media collector implemented.
- [ ] Three normalized adapters and bounded collectors implemented.
- [ ] Unit/fake-bridge/security checks and fix-cycle counts recorded.
- [ ] TikTok, Instagram and Facebook live UAT signed off.
- [ ] Master docs, validation matrix, context, backlog and changelog reconciled.
