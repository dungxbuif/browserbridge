---
artifact_type: adr
id: ADR-002
status: accepted
owner: human
date: 2026-08-20
trace:
  requirement: FR-010, FR-017, NFR-009
  phase: PHASE-002
  tickets_or_bugs:
    - TICKET-004
  detail_design: DESIGN-002
  master_docs:
    - docs/architecture/ARCHITECTURE.md
    - docs/architecture/SDD.md
---

# ADR-002: Keep social credentials in Chrome and proxy media chunks to Drive

## Context

Some social media bytes are available only in the owner's active browser session. Moving social cookies to the backend would enlarge the account-compromise blast radius and may not work when anti-bot state is tied to browser context or IP. Buffering full media in WSS/Base64 conflicts with the protocol payload limit and MV3 memory constraints.

## Decision

Chrome acquires media using its existing authorized session and sends ordered raw chunks to authenticated backend HTTP endpoints. The backend immediately proxies each chunk into a Google Drive resumable upload session, keeps only ephemeral session metadata, and never receives social credentials or writes a temporary media file.

## Alternatives Considered

- Backend downloader with copied social cookies: rejected for security and session-binding reasons.
- Full media Base64 over WSS: rejected for payload expansion and memory limits.
- Backend disk spool: rejected for privacy and duplicate I/O in the personal MVP.
- Drive OAuth in extension: rejected to keep Google refresh credentials and provider lifecycle centralized.

## Consequences

- Positive: social credentials stay in Chrome; memory is bounded by chunk size; no backend media retention; Drive supports large files and resumable offsets.
- Negative: uploads are sequential; in-memory sessions do not survive backend restart; the browser must remain available; `MAIN` world fallback needs broad host/scripting permissions.
- Neutral: backend receives user media bytes in transit and must use HTTPS outside localhost.

## Linked Work

- [TICKET-004](../work/tickets/TICKET-004-media-drive-chunk-upload.md)
- [DESIGN-002](../work/designs/DESIGN-002-media-drive-chunk-upload.md)
- [Architecture](../architecture/ARCHITECTURE.md)
- [API](../architecture/API.md)
