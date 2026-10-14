# Story: Pinned tab and Pin action (participant)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** feeds-discovery (new: Pinned)  ·  **Decisions:** DF-5, DF-6, DF-7  ·  **Issue:** _TBD_
**Stack:** frontend  ·  **World:** participant  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

The participant half of pins (backend: 04). A third tab, **Pinned**, sits after All Posts and Following and lists the
pinned feed (exercise pins first, then my pins and likes). Each post gets a **Pin** action. Posts a controller pinned
for everyone are marked and arrive live.

## Acceptance Criteria

- [ ] `HomeView` shows three tabs: All Posts, Following, **Pinned**. Arrow/Home/End keyboard handling is generalised
      to N tabs. Pinned is lazy-mounted like Following and shows only when the viewer can compose (same gate as
      Following); a view-only session sees All Posts only, as today.
- [ ] The Pinned panel fetches `GET /api/feed/pinned` (mock adapter behind the existing mock switch) and renders the
      items with `PostCard` in DF-5 order. A post with `pinnedForAll` shows a small "Pinned" label with a thumbtack
      icon above the author line (fiction-safe wording: no "controller", no "exercise control"). Empty state: "Posts you
      pin or like show up here."
- [ ] `PostActions` gains a **Pin** action (FontAwesome thumbtack) after Like, gated like Like, with an optimistic
      toggle and rollback on failure (same pattern as `useReaction`), calling `PUT/DELETE /api/posts/{id}/reactions/pin`.
      It shows no count. Its accessible name is "Pin" / "Unpin" and `aria-pressed` reflects `viewer.pinned`.
- [ ] Pinning, unpinning, liking or unliking while the Pinned tab is mounted updates it without a reload (add or remove
      the item; re-fetch is acceptable).
- [ ] `realtimeFeed` subscribes to `PostPinChanged` and exposes
      `subscribePinChanged(handler: (e: { postId: string; pinnedForAll: boolean }) => void): () => void` (the frozen
      name story 08 uses). The Pinned tab and visible `PostCard`s update `pinnedForAll` live; a removed post
      (`PostRemoved`) leaves the tab.
- [ ] `ParticipantPostView` gains `pinnedForAll?: true` and `viewer.pinned`; the realtime parser keeps both;
      `post.provenance.test.ts` is updated for the third viewer key.

### Cross-cutting
- [ ] **Two worlds:** participant skin only; no COBRA.
- [ ] **Scenario time (COR-053)** on every timestamp in the tab.
- [ ] **Accessibility (NFR-001):** tabs keep `role="tab"` semantics; the pin state is never colour-only.

## Out of Scope

The console's pin-for-everyone action (08). Pin ordering. Profile tabs (unchanged).

## Tests

Three-tab keyboard nav; pinned panel order and empty state; Pin toggle optimistic + rollback; live `PostPinChanged`
add/remove; `PostRemoved` removes from the tab; view-only sees no Pinned tab.
