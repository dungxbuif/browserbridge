---
artifact_type: adr
id: ADR-004
status: deferred
owner: shared
date: 2026-08-23
updated: 2026-08-24
deferred_by: ADR-005
deferred_reason: owner rejected scoped agent sessions as disproportionate for a single-user localhost deployment
trace:
  requirement: FR-021, NFR-012
  phase: PHASE-004
  tickets_or_bugs:
    - TICKET-011
  detail_design: DESIGN-004
  contract_annex: docs/work/designs/DESIGN-004-API.md
  master_docs:
    - docs/architecture/ARCHITECTURE.md
    - docs/architecture/API.md
    - docs/architecture/ERD.md
    - docs/architecture/SDD.md
---

# ADR-004: Use scoped agent sessions with deny-by-default policy and redacted audit

> **Deferred on 2026-08-24 by [ADR-005](ADR-005-single-scope-api-keys-with-redis-cache.md).**
> The owner reviewed this model and rejected it as disproportionate for a single-user
> deployment bound to `127.0.0.1`. Agent authentication now uses single-scope API keys
> stored in `gateway.api_keys`. This ADR is retained, not rejected: nothing here is known
> to be wrong, and promoting it later is additive because `gateway.api_keys` does not
> conflict with `gateway.agents`. Reactivate if the deployment gains multiple agents,
> untrusted callers, a non-localhost bind, or a need for an audit trail.

## Context

The existing shared bearer token is acceptable for one trusted browser bridge, but it is too broad when agents can enqueue crawls, retry media, send mlem messages, inspect interactions or change policy. Giving agents raw provider tokens or direct database credentials would bypass central permissions, idempotency and audit.

## Proposed decision

- Keep `BROWSER_BRIDGE_AUTH_TOKEN` only for extension and temporary legacy browser routes.
- Authenticate agent/API/MCP calls using short-lived random session tokens whose SHA-256 hashes are stored in `gateway.agent_sessions`.
- Authorize every operation with named capabilities, target restrictions and deny-by-default evaluation. Deny overrides approval, and approval overrides allow.
- Route HTTP and MCP through the same domain services so neither transport bypasses policy, idempotency or audit.
- Require idempotency keys for external/job mutations and persist redacted audit events for allow, deny, start and result.
- Persist redacted operational error events separately from audit history, correlated by trace/request/job/attempt IDs so an agent can identify the failing component and stage.
- Use MCP as the executable agent interface and keep skills as optional workflow documentation. Credentials belong to gateway/MCP process configuration or an OS secret store, never skill content or tool arguments.
- Never return raw browser cookies, OAuth/provider secrets, Drive resumable URLs or captured headers to agents.
- Preserve a local bootstrap path for creating/revoking the owner agent and sessions; no multi-tenant identity provider is introduced.

## Alternatives considered

- Reuse the shared browser token for all callers: rejected because it cannot scope worker, bot and owner-agent actions.
- Give agents direct database/provider credentials: rejected because authorization, redaction and audit become unenforceable.
- Build full OAuth/OIDC multi-tenant auth: rejected as excessive for the personal deployment.
- Implement policy only in MCP: rejected because HTTP callers could bypass it.
- Put a static API key in a BrowserBridge skill: rejected because skills are prompt-visible guidance, not secret storage or an authorization boundary.
- Expose only raw HTTP APIs to agents: retained as a compatibility/integration option, but not the primary agent UX because MCP provides typed discovery and structured tool errors.

## Consequences

- Positive: agent control is explicit, revocable, auditable and consistent across HTTP/MCP.
- Positive: workers and the bot can receive narrower service grants than the owner agent.
- Negative: session/grant/audit tables and bootstrap tooling add migration/runtime complexity.
- Negative: compatibility mode must be removed deliberately after clients migrate.
- Neutral: initial approval requests use short-lived grants/bootstrap CLI rather than a new UI.

## Linked work

- [DESIGN-004](../work/designs/DESIGN-004-agent-control-api-mcp-permissions.md)
- [DESIGN-004 API contract](../work/designs/DESIGN-004-API.md)
- [TICKET-011](../work/tickets/TICKET-011-agent-control-api-mcp.md)
- [PHASE-004](../work/phases/PHASE-004-resilient-agent-gateway.md)
