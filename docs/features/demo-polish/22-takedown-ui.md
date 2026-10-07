# Story: Takedown UI and live feed removal

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-025, XC-010, XC-004, NFR-001  ·  **Design decisions:** DP-9 (implementation.md §0), D1-009, CTL-033 (absent, not disabled)  ·  **Issue:** —
**Story ID:** C5  ·  **Stack:** frontend  ·  **Priority:** Should  ·  **Effort:** S  ·  **Wave:** 3 (after C2, F2, F4, B6)
**Home story:** [`world-steering/05`](../world-steering/05-content-takedown.md) (slice).

## Context
**As** a controller, **I want** to take a post down in two clicks and watch it disappear from the participant
feed, **so that** the moderation beat (demo beat 5) works. Two halves: a staff action in the Live world column
(staff COBRA) and a participant-side handler so a `PostRemoved` push removes the post from an open feed without
a refresh.

## Acceptance Criteria
- [ ] **Two clicks, with a category.** On a Live world row, **Take down** opens a small confirm popover with the
      category radio group (inappropriate · PII · real-world reference · other, default *other*) and **Confirm
      take down**; that is two clicks, fully keyboard-operable (Esc cancels, focus returns to the row action).
      It calls `DELETE /api/staff/posts/{id}?category=…`.
- [ ] **Visible outcome.** Success marks the row "Removed" (text + icon, row stays for the record, actions
      disabled); failure shows the server message with Retry; a repeat is harmless. The control is **absent, not
      disabled** for sessions that are not controllers (CTL-033), and is mounted through C2's `renderRowActions`
      slot by the orchestrator.
- [ ] **One telemetry event.** The console emits exactly one XC-004 `steering_action` (`channel: system`, actor
      system + acting human + role, `target {post, id}`, `payload { action: 'takedown', category }`); the server
      emits none (DP-9).
- [ ] **Live removal on the participant feed.** `realtimeFeed` surfaces `PostRemoved { postId }` (validated;
      unknown ids ignored) to subscribers; a small `removedPosts` store records the ids; `Feed` hides any
      displayed post whose id is removed, immediately, without a refresh — including a post still in the "new
      posts" buffer — and moves focus to the feed region if the focused card was removed.
- [ ] **Quiet elsewhere.** Profile and hashtag lists drop the post on their next fetch (the server omits it); a
      removed reply shows the thread tombstone on the next thread read (B2); no participant payload or DOM
      retains the removed post's text (XC-002).
- [ ] **Staff world only** for the action (`@/theme/styledComponents`), participant CSS Modules for the feed
      change; no scenario wall-clock leaks to participants.

## Out of Scope
Restore/undo, Director notification, an incident report view, bulk takedown, participant self-delete, AAR/replay
filtering, removing the post from profile/hashtag lists live.

## Technical Notes
- Files: implementation.md §4.1 row C5 — new `controller/liveWorld/TakedownAction.tsx` and
  `controller/services/takedownService.ts`; participant `social/services/realtimeFeed.ts` (**after F2 has
  merged** — it also owns that file), new `social/services/removedPosts.ts`, `social/pages/Feed.tsx` (**after
  F4**). `TakedownActionProps { post: LiveWorldPost }` (implementation.md §1.11). Role check uses the controller
  identity seam (`useControllerIdentity().role`).
- Mock mode: `takedownService` removes from `postStore` and notifies the same `removedPosts` store, so the full
  beat is demonstrable on `npm run dev`.

## Dependencies
B6 (endpoint), C2 (row slot), F2 (`realtimeFeed.ts`), F4 (`Feed.tsx`). **Live check** once B6 is deployed: take
a post down from the console, the open participant feed drops it.

## Tests
- `TakedownAction`: two-click flow, category default/selection, keyboard/Esc/focus return, success/failure
  states, absent for non-controller, exactly one telemetry call.
- `realtimeFeed.test.ts`: `PostRemoved` valid/invalid/unknown id; `removedPosts` store; `Feed` hides displayed
  and buffered posts and moves focus; regression of the existing feed/pill tests.
