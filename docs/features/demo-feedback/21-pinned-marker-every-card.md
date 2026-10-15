# Story: "Pinned" marker on every card

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** feeds-discovery (Pinned), NFR-001  ·  **Decisions:** DF-5, DF-7, DF-34  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** Wave 3 session · **Branch:** `build/demo-feedback/21-pinned-marker` → `feature/demo-feedback-w4-polish`

## Context

Story 07's ACs were amended at Gate-1 to show the pinned-for-everyone marker **in the Pinned tab only** for the demo
(`PinnedFeed.tsx:109-112`, `data-testid="pinned-for-all-label"`). Tom wants it wherever the post appears, like X's
"Pinned" line. `PostCardProps` has no pinned prop; the data is already on the model (`post.pinnedForAll?: true`,
`social/types/post.ts:171`) and arrives live via `PostPinChanged` (story 07/08's `subscribePinChanged`).

## Acceptance Criteria

- [ ] New `social/components/post/PinnedMarker.tsx` (+ module css): FontAwesome `faThumbtack` + the text **"Pinned"**
      (icon `aria-hidden`, text read by screen readers), in the brand skin, placed above the author row as X does.
      Never icon-only or color-only.
- [ ] `PostCard.tsx` renders it when the post is pinned for everyone, in **every variant** that shows a post: home
      feed (All and Following), thread (root and replies), profile tabs, Pinned tab, search/hashtag results.
- [ ] It follows the live pin state: pinning for everyone adds the marker to mounted cards without a reload; unpinning
      removes it (read through the existing pin state store from story 07, not a new subscription).
- [ ] `PinnedFeed.tsx` uses the shared marker instead of its own label (test id kept so story 07's tests still pass,
      or those tests updated in this story).
- [ ] A personal pin (`viewer.pinned`) shows **no** marker to anyone (DF-6: private); it stays the Pin action's
      pressed state.
- [ ] Two worlds: participant skin only; nothing in `controller/**` changes (Live world already shows "Pinned for
      everyone").

## Out of Scope

Pinning to a profile (X's profile pin), ordering changes, staff UI.

## Technical Notes

Owns `PostCard.tsx`, new `PinnedMarker.*`, `pinned/PinnedFeed.tsx` only. **Does not touch** `PostActions.tsx`,
`PostHeader.tsx`, `PostBody.tsx` or `social/types/post.ts` (story 20 owns them).

## Dependencies

None.

## Tests

`social/components/post/PinnedMarker.test.tsx` and a `PostCard` test per variant (marker present when
`pinnedForAll`, absent for personal pins); live add/remove through the pin store; accessible text "Pinned".
