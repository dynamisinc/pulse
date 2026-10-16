# Story: Cache-Control: no-store on auth routes (#485)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-009, COR-012  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §3.3, §10 (A5)  ·  **Issue:** —
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A5

## Context
Auth responses carry tokens and org/identity data and must never be cached by browsers or proxies ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §3.3, tracker #485).

## Acceptance Criteria
- [ ] Given any of `/api/auth/login`, `/api/auth/staff/login`, `/api/auth/staff/login/choose`, `/api/auth/password/forgot`, `/api/auth/password/reset`, `/api/session`, refresh and logout, when called, then the response has `Cache-Control: no-store` (and `Pragma: no-cache`).
- [ ] The header is applied by one shared mechanism (endpoint group filter/metadata), and a test fails if a new `/api/auth/*` route lacks it.
- [ ] Error responses (401/403/404/429) carry the header too.
- [ ] Static assets and public participant feeds keep their existing cache headers.
- [ ] Isolation: no route is added; the shared filter adds no data access (stated), so no foreign-exercise/org test beyond the existing suite.
- [ ] User guide (C5): "no guide impact" stated in the PR.

## Out of Scope
CDN rules; changing token storage.

## Technical Notes
Backend, small. Endpoint filter on the auth route group; `Program.cs` line is orchestrator-owned. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A5; can ship early. Pairs with 21 (new auth routes).

## Tests
Per-route header test enumerating auth routes from endpoint metadata.
