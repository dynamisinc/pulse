# Story: Network readiness (self-test, allowlist, GFE guidance)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-009  ·  **Design decisions:** none  ·  **Issue:** #52

## Context
Novel per-exercise subdomains are exactly what government web filters, TLS-inspection proxies, and MDM
block. Pulse ships a participant-facing connectivity self-test, a published allowlist/firewall
specification for customer IT, and verification guidance for locked-down GFE devices; network readiness
is an item on the go-live readiness dashboard (COR-009, COR-042).

## Acceptance Criteria
- [ ] A participant-facing **connectivity self-test page** (reachable pre-exercise) checks the
      WebSocket/SSE, media, and auth paths and reports pass/fail per check.
- [ ] The self-test conveys results by text/icon, not color alone (NFR-001), and is usable on
      locked-down GFE.
- [ ] A published **allowlist/firewall specification** (hosts, ports, protocols) is available for
      customer IT.
- [ ] Network readiness surfaces as an item on the go-live readiness dashboard (COR-042).

## Out of Scope
The readiness dashboard itself (exercise-build-golive COR-042); the real-time transport (SignalR) build.

## Technical Notes
Participant-reachable but out-of-fiction utility page. Tests the same transports the app uses. See
implementation.md (story 09).

## Dependencies
Story 08 (hostname); the real-time/media/auth paths; feeds COR-042 (readiness dashboard).

## Tests
- Component: the self-test reports per-check pass/fail (not color-only) and runs the WS/media/auth
  probes.
