# Story: Live world: pin for everyone and unread highlighting

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** live-monitoring (lite), feeds-discovery (new: Pinned)  ·  **Decisions:** DF-7  ·  **Issue:** #504
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

Two console asks land in the Live world column. Controllers pin a post (the newscast) **for everyone**. And "bold
unread posts: other systems look just like Twitter with no highlighting; highlighting would help controllers spot
what's new."

## Acceptance Criteria

- [ ] Each Live world row gets a **Pin for everyone** / **Unpin** action beside *Take down*, calling
      `PUT/DELETE /api/staff/posts/{id}/pin`, with visible errors (no swallowed catch) and a pinned indicator on the row
      (icon + "Pinned for everyone" text, never colour-only). It updates from its own response immediately and from
      `realtimeFeed.subscribePinChanged` for changes made in other consoles (story 07 adds that function; until it
      merges, build against a test double with the frozen signature).
- [ ] **Unread:** a post that arrives live (not part of the opening baseline) is **unread**: bold text, an accent left
      bar and a "New" chip. It becomes read once at least half of the row has been visible in the column for one second
      (IntersectionObserver), or when the controller clicks **Mark all read**. The column header shows "N unread".
- [ ] Read state is per browser and per exercise (`localStorage`, wrapped in try/catch; a failure just means nothing is
      remembered). A reload marks the baseline read and keeps arrivals since the last visit unread.
- [ ] The existing "N new" pending behaviour while the controller is reading is unchanged and composes with unread
      (merged rows arrive unread).

### Cross-cutting
- [ ] **Two worlds:** COBRA styling and `liveWorldStyles` tokens; never confusable with a participant view.
- [ ] **Performance:** unread tracking adds no per-row re-render storm at 120 posts/min (memoised rows stay memoised;
      test with a burst).

## Out of Scope

Hiding the pin action for evaluators (11). Unread elsewhere in the console.

## Tests

Pin/unpin calls and error display; live pin change from the subscription; unread on arrival, read after visibility,
Mark all read, persistence across remount, storage failure tolerated; burst render count.

Implemented in (all under `src/frontend/src/features/controller/liveWorld/`):

- [`LiveWorldColumn.pinUnread.test.tsx`](../../../src/frontend/src/features/controller/liveWorld/LiveWorldColumn.pinUnread.test.tsx):
  pin / unpin through the service beside Take down, "Pinning…" single-flight, failure alert + Dismiss, wire-seeded
  marker, live `PostPinChanged` through a `subscribePinChanged` double (incl. a held post), no pin on a removed row;
  unread on arrival (bold, accent bar, "New", "N unread"), read after half the row is visible for 1 s (fake
  IntersectionObserver) and not before, a burst does not restart the dwell, Mark all read, no-IO fallback;
  persistence across remount, per-exercise scope, throwing `localStorage` tolerated, malformed value ignored;
  "N new" merges rows unread; 120-post burst render count (settled rows do not re-render).
- [`pinForAllService.test.ts`](../../../src/frontend/src/features/controller/liveWorld/pinForAllService.test.ts):
  `PUT` / `DELETE /staff/posts/{id}/pin`, encoding, timeout, plain-text errors.
- [`pinChangeSource.test.ts`](../../../src/frontend/src/features/controller/liveWorld/pinChangeSource.test.ts):
  no-op before story 07, delegation to `realtimeFeed.subscribePinChanged` after, malformed events dropped.
- [`liveWorldModel.pinUnread.test.ts`](../../../src/frontend/src/features/controller/liveWorld/liveWorldModel.pinUnread.test.ts):
  `live` / `pinnedForAll` on entries, refresh rules, `applyPinChange` identity.
- `liveWorldStyles.test.ts` (unread accent contrast), `liveWorldTwoWorlds.test.ts` (allowlist + exercise-scope
  guard updated), `LiveWorldColumn.test.tsx` / `TakedownAction.inColumn.test.tsx` (tab order now Reply as… → Pin for
  everyone → Take down).
