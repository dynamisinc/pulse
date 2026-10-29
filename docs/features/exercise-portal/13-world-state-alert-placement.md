# Story: World-state shift and alert placement

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-010, PRT-011, COR-053, NFR-001, NFR-008  ·  **Design decisions:** D2-004 (amended by conflict C-2), D7-002  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** M

## Context
PRT-010 makes the alert bar persist across every enabled channel: the shell hosts the one bar (D7-002, F11 wires it live), so the portal's job is **placement and mood**, not a second bar. E3 §3 and D2-004: the portal is where a participant *feels* the world state change; the page's mood shifts when an emergency alert is active. Per conflict C-2 the shift is **non-textual** (the platform adds no BREAKING chrome inside a channel, FC-9.5); the message is carried by the bar and by the lead story's own authored kicker.

## Acceptance Criteria
- [ ] **One bar.** Given the portal mounted in the shell, when alerts are active, then exactly one alert bar (`role="status"`) exists on the page, hosted by the shell directly above the portal masthead; the portal renders no second bar, banner or ticker, and the bar persists when the participant navigates to another channel (verified with 17's integration test).
- [ ] **World state.** Given `useAlerts()` from the shell, when the active set changes, then `usePortalWorldState()` returns `normal | info | advisory | emergency` = the highest active severity (FC-1 `AlertSeverity`), recomputed on every `AlertsChanged` set replacement (reconnecting clients converge) and back to `normal` when the last alert clears or expires.
- [ ] **Mood shift is non-textual (C-2).** Given `emergency`, then `WorldStateFrame` swaps a **bounded** set of CSS custom properties (a cooler page tint, a severity-colored masthead under-rule) and adds **no** words, chips, kickers or "live" labels of its own; `advisory` / `info` apply a lighter variant; every state meets AA contrast for all text/background pairs (a computed test over the four states).
- [ ] **Never color-only (NFR-001).** Given any state, then no information is conveyed by the mood alone: severity is announced by the shell bar's icon + label text; the mood is decorative and `aria-hidden`.
- [ ] **Motion.** Given a state change, then the transition is a short color change only, disabled under `prefers-reduced-motion`, with no flashing (WCAG 2.3.1).
- [ ] **Content drives the rest.** Given D2-004's "swaps lead story, top stories, rail", then the portal does so **only through published content** (09, 10, 11, 12 react to their own data); there is no portal-side special case keyed to alert state, which a test asserts by rendering the same content under all four states.
- [ ] **Watermark and chrome.** Given the emergency state, then the lead hero still reserves the EXERCISE chip and compliance chrome is untouched (NFR-008).

## Out of Scope
Raising or clearing alerts (E7 / F10), the alert bar's design (final, D7-002), a "WATCH LIVE" control, the alerts entry (14), a portal-era alert hero, any text added by the platform.

## Technical Notes
Files: `features/portal/alerts/{usePortalWorldState.ts*, WorldStateFrame.tsx*, worldState.css*}`. Consumes the shell's `useAlerts` unchanged; uses the CSS variable names declared in 06's tokens. 17 mounts `WorldStateFrame`.

## Dependencies
02, 06 (variable names), F11. Can run with 08-12, 14-16.
