# Story: Console: display control

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-040, PRT-041, COR-041, COR-052 (pairing), XC-004  ·  **Design decisions:** D5 (console conventions via F17)  ·  **Issue:** —
**Stack:** frontend (staff)  ·  **World:** staff (COBRA)  ·  **Wave:** 4  ·  **Effort:** L

## Context
The facilitator's remote: create and manage screens, get a display link/QR, choose what a screen shows, build a playlist and say "show this next". Staff world, COBRA, desktop-first but usable on a tablet at the front of the room. It pairs with module-based advancement (COR-052) only in that the facilitator advances the exercise clock elsewhere and the screen follows the content that publishes; no module UI here (Q-E3-7).

## Acceptance Criteria
- [ ] **Displays list.** Given `/staff/display`, then each display shows name, current mode and what it is showing (text: "Pinned: Weather Desk, Tornado Warning"), and a connection state as text + dot ("Connected" / "Not seen for 3 min"), never color-only; revoked displays are listed muted.
- [ ] **Create and link.** Given "New display" (name), then the surface creates it (`POST /api/displays`), shows the full link, a copy button and a QR (the server-rendered SVG data-URI pattern, no npm package), and states in plain text that anyone with the link can view the screen content of this exercise until it is revoked.
- [ ] **Rotate and revoke.** Given a display, when the user chooses Rotate link or Revoke, then a confirm dialog names the consequence ("The current screen will go blank") and, on confirm, calls the API and updates the list; neither is a one-click action.
- [ ] **Show on screen.** Given the picker, then the facilitator can choose Portal, Social feed, Alerts, a **published content item** (searchable list from the F07 content API with outlet, headline and scenario time) or a **post** (by pasting an in-sim post link), and the choice pins it; draft, scheduled or retracted items are not offered.
- [ ] **Show next.** Given a one-click "Show this next" beside any item, then it sets the one-shot interrupt (`show-next`) and the surface confirms "Showing next on Basement screen"; "Clear" removes it before it appears.
- [ ] **Playlist (cut line 4).** Given the playlist builder, then items can be added, removed and reordered with Move up / Move down (keyboard-operable), dwell is 5-120 s, the 20-item cap is enforced with a message, and Save applies via `/playlist`; a stale version shows the conflict and keeps the draft.
- [ ] **Preview.** Given any item, then "Preview as participant" renders the target in the staff frame's read-only stage (COR-041) so the facilitator can check before it goes up; the preview is not the TV.
- [ ] **Roles and two worlds.** Given the surface, then it is COBRA components only, registered via the staff route registry for `controller` / `planner`, unreachable to others, with labelled fields, announced errors, keyboard-first operation and clean axe (NFR-001); commands emit `display_command` server-side (08).

## Out of Scope
The credential and state APIs (05, 08), the screen rendering (18, 19), clock advancement / module stepping (exercise-clock/03), multi-exercise displays, scheduling a show-next for a scenario time.

## Technical Notes
Files: `features/controller/display/**`. COBRA only; React Query against the axios client with PC-3 guards (fixtures until 05/08 are live); content picker reuses F07 list hooks and F17 table conventions. Orchestrator adds the registry entry.

## Dependencies
05, 08, F07, F17. Can run with 17-19, 21, 22.
