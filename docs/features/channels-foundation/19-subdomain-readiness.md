# Story: Host-relative URLs and subdomain readiness

**Feature:** Channels foundation  ·  **Epic:** E1 (cross-cutting)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** COR-008, COR-001, XC-001, NWS-011  ·  **Design decisions:** PDF-11 (#679, Tom 10/21)  ·  **Issue:** #715
**Stack:** fullstack  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** S

## Context
PDF-11 puts each exercise on its own subdomain (`exercise-a.<env-host>`) with wildcard DNS/cert via Front Door; a rename keeps the old host as an alias; the host is kept while archived.
Channel content makes this sharper: permalinks are **shared in posts and opened on phones**, so one baked-in hostname or absolute URL breaks across exercises. This story guarantees the
foundation is host-agnostic and proves it with tripwires the channel stories inherit. The provisioning itself is PDF-11's.

## Acceptance Criteria
- [ ] **Path-only everywhere.** Given every foundation DTO, alert `href`, link preview, outlet `homeRoute`, signed-media-URL wrapper and telemetry payload, then none contains a scheme, a host or a protocol-relative `//`; a tripwire test scans the DTO producers, the mock fixtures and the OpenAPI-like route list and fails on `://` or a hard-coded platform domain.
- [ ] **Browser resolves against the exercise host.** Given the app is served from `exercise-a.<env-host>`, when a permalink, link card or alert Details link is followed, then navigation stays on that host (a test mounts the router under a non-localhost host and asserts no cross-host navigation, no `VITE_API_URL`-derived host in a link).
- [ ] **Shared link works on the right host only.** Given a permalink opened on exercise A's host, when the same path is opened on exercise B's host, then B returns the same 404 as an unknown slug (no cross-exercise content, XC-001); an unknown host fails closed (existing host resolver).
- [ ] **Rename and archive.** Given an exercise renamed (old host kept as alias) or archived (subdomain kept), then both hosts resolve to the same exercise and existing permalinks keep working; an archived exercise serves the existing archived behaviour (no live push, participant-inaccessible).
- [ ] **Cookies and CORS.** Given multiple exercise subdomains, then no channel route relies on a cross-subdomain cookie or an `Access-Control-Allow-Origin` wildcard; the realtime negotiate for channel events uses the host-resolved scope (verified with the existing hub tests under two hosts).
- [ ] **No absolute canonical/OG tags.** Pages rendered for a permalink set no absolute `<link rel=canonical>` or OG URL from config; any such tag is built from `window.location.origin` at render time (shared links shown in previews are a post concern, see story 18).

## Out of Scope
Wildcard DNS, certificates, Front Door provisioning and the alias table (PDF-11 / #679 itself); custom customer domains beyond COR-008's existing support; server-side OG/unfurl endpoints.

## Technical Notes
Files: `Features/Channels/Urls/**` (the `IContentPermalinks` implementation hardening + tripwire tests), `features/channels/urls/**`. Reuse `Features/ExerciseResolution` (`ExerciseHostName`, `HostExerciseResolver`) and the existing `exercise-isolation/08` + `/09` tests as the pattern.

## Dependencies
06, 15 (so there is something to scan). Can run with 16, 17, 18.
