# Story: Portal mount, landing and telemetry

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-001, PRT-006, PRT-020, PRT-021, XC-001, XC-004, COR-053, NFR-001, NFR-008  ·  **Design decisions:** D2-001, D2-004, D7-001  ·  **Issue:** #781
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** L

## Context
Assembles the portal: registers the `portal` channel with F12's router, fetches `PortalDto`, and composes skin → world-state → masthead (+ alerts entry) → layout with the registered modules. F12 already decides *where* a login lands (portal if enabled, else Social, PRT-001); this story supplies the surface it lands on and proves the whole front door end to end. **Pilot mode is untouched**: with only `social` enabled nothing here is reachable.

## Acceptance Criteria
- [ ] **Registration.** Given `registerChannel({ id: 'portal', pathPrefix: '/portal', themeScope: PortalSkinScope })`, when the channel is enabled, then `/portal` mounts `PortalChannel` and the shell's nav lists "Portal"; when disabled, `/portal` renders `ChannelNotFound` (participant world) and Social stays the landing exactly as in pilot mode.
- [ ] **Landing (PRT-001).** Given a participant signs in (personal link, day word, password) on a portal-enabled exercise, then they arrive at `/portal`; a deep link they opened before sign-in (e.g. a news permalink) wins over the landing (F12 rule); a read-only shared session also lands on `/portal` and sees no affordances; a Staged exercise renders the portal with whatever is published.
- [ ] **Assembly.** Given `GET /api/portal`, then the page renders masthead, then the modules in server order, inside `WorldStateFrame`; while loading it shows a skeleton in the portal's tokens; on error or an out-of-shape payload it shows a calm in-fiction "temporarily unavailable" with a retry, never a COBRA error and never a blank page.
- [ ] **Chrome and nav (PRT-020/021).** Given the portal, then compliance chrome and the single alert bar frame it (shell-owned, unchanged), the shell strip is the cross-channel nav, and the portal adds no second nav; module "See all →" links appear only for enabled channels; the nav, the module list and the routes agree (an integration test over the enabled-set matrix).
- [ ] **Telemetry (XC-004).** Given the portal is mounted, then one `portal_view` is emitted per session per mount (actor incl. the human behind a shared org account, scenario + wall time, channel `portal`); remounts within the session do not re-emit; read-only sessions emit through the existing envelope rules.
- [ ] **Live updates (PRT-006).** Given the page is open, then new content, retractions, alerts and the clock all update the visible modules without refresh (verified by a stream-driven integration test across 09-14); a reconnect converges to the server state.
- [ ] **Focus, title, two worlds.** Given a route change into the portal, then focus moves to the `h1` and `document.title` is the masthead name; a static import test asserts no COBRA and no default MUI look anywhere under `features/portal/` outside tests.
- [ ] **Mobile-first and isolation.** Given a phone at 320 px, then the portal is a usable home screen in one column; every request goes through the host-scoped API with no exercise id, and a session of exercise B on host A never renders A's data (covered in 23).

## Out of Scope
The kiosk-lite frame (18; its `KioskGate` is wired by the orchestrator above this channel at `/portal`, `PortalChannel` itself has no `display=1` logic), F12's router internals, the module implementations, console surfaces, the `band` / `grid` layouts.

## Technical Notes
Files: `features/portal/PortalChannel.tsx`, `features/portal/hooks/usePortal.ts*`, `features/portal/index.ts`. The orchestrator owns `features/portal/modules/index.ts` (registrations) and the single `registerChannel()` line in F12's registry. Reuse F15 telemetry emitter conventions and `RouteFocusScope`.

## Dependencies
03, 06, 07, 13, 14, F08, F12, F15, modules 09-12 (via the registration seam; fixtures otherwise). Can run with 18, 19, 21, 22.
