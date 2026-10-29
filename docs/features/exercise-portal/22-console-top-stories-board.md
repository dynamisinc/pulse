# Story: Console: Top Stories board

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-004, COR-041, XC-004  ·  **Design decisions:** D5 (console conventions via F17)  ·  **Issue:** #785
**Stack:** frontend (staff)  ·  **World:** staff (COBRA)  ·  **Wave:** 4  ·  **Effort:** S  ·  **Priority:** Could (cut order 1)

## Context
PRT-004 and E3 §3: "controllers use featured-story pinning (E7) to steer what the 'public' is seeing first". F17 already lets a controller set a featured rank per item. What is missing is **one place to see and order what the portal leads with right now**, across all news outlets: the board. If it slips, per-item pinning in F17 still satisfies the requirement.

## Acceptance Criteria
- [ ] **Board.** Given `/staff/top-stories`, then it lists published news items currently featured in rank order, followed by the automatic fallback the portal will use (most recent), with a divider and a text label so the controller sees exactly what participants see first; the first row is marked "Lead" in text.
- [ ] **Pin and unpin.** Given a published news item in the add list, when the controller pins it, then it receives the next rank through F07 `feature`; unpin clears it; retracted items cannot be pinned and fall off the board when retracted.
- [ ] **Reorder.** Given the featured list, then rows reorder with Move up / Move down (keyboard-operable, drag optional) and the change persists through F07's atomic `POST /api/content-items/feature/reorder { ids[] }` (FU-8 resolved); a `409` (an item was retracted or re-ranked by another controller) applies nothing, refetches and shows a visible message.
- [ ] **Participant parity.** Given any change, then "Preview as participant" shows the real portal's Top Stories module via preview-as-participant (COR-041) and its order matches the board; the board itself never renders participant styling.
- [ ] **Staff-only fields.** Given the board, then rank and `background` are shown to staff (the `background` tag is read-only here; F17 owns editing); neither is ever sent to a participant.
- [ ] **Roles, two worlds, a11y.** Given the surface, then it is COBRA components only, controller/planner only, status shown as text + icon, labelled controls, announced results, clean axe (NFR-001); each pin/unpin is a server-audited command (F07).

## Out of Scope
Authoring and the `background` toggle (F17), scheduling a pin for a scenario time, pinning press/weather items (Q-E3-9), the participant module (09).

## Technical Notes
Files: `features/controller/topStoriesBoard/**`. React Query on F07 list/feature endpoints with guards; reuse F17 list row components. Orchestrator adds the registry entry.

## Dependencies
F07 (`feature`, list), F17. Uses F07's `feature/reorder`. Can run with 17-19, 21.
