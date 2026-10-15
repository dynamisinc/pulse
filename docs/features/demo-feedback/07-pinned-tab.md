# Story: Pinned tab and Pin action (participant)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** feeds-discovery (new: Pinned)  ·  **Decisions:** DF-5, DF-6, DF-7  ·  **Issue:** #503
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

All under `src/frontend/src/features/social/` (Vitest, mock mode unless noted).

| AC | Tests |
|---|---|
| Three tabs, N-tab keyboard, lazy mount, view-only gate | `layout/routes/HomeView.pinnedTab.test.tsx` (order + roving tabindex, click opens and keeps the panel mounted, Right/Left wrap with focus following, Home/End, observer sees no Pinned tab); losing the switch mid-view falls back to All Posts: `layout/routes/HomeView.sessionLoss.test.tsx`; no-persona: `SocialChannel.feedSwitch.noPersona.test.tsx` (no tablist at all); the two-tab suite `SocialChannel.feedSwitch.test.tsx` still passes |
| Pinned panel: DF-5 order, `PostCard`, "Pinned" marker, empty state | `pinned/PinnedFeed.test.tsx` (order + marker above the author line, fiction-safe, word not colour; the card's article is described by "Pinned"; scenario-time header; empty copy; error state); mock parity of DF-5 in `pinned/pinnedFeedService.mock.test.ts`; live wire + fail-closed + XC-002 narrowing in `pinned/pinnedServices.live.test.ts` |
| Pin action: after Like, no count, stable name "Pin" + `aria-pressed`, optimistic + rollback, PUT/DELETE | `components/post/PostActions.pin.test.tsx` (anatomy, absent on a read-only card, optimistic flip before the write settles, in-flight guard, DELETE to unpin, exact rollback + polite live region, cross-card sync, a later server read overrides an older confirmed pin); route + body in `pinned/pinnedServices.live.test.ts`; read-only / no-persona sessions in `PostActions.sessionReadOnly.test.tsx` / `PostActions.noPersona.test.tsx`; row order updated in `PostActions.test.tsx`, `PostCard.test.tsx`, `post/PostCard.parts.test.tsx` |
| Pin / unpin / like / unlike updates the mounted tab | `pinned/PinnedFeed.test.tsx` ("unpinning a post in the tab takes it off and keeps focus in the tab", "does not pull focus back once the reader has moved it out of the tab", "liking or pinning a post elsewhere adds it without a reload"); `PostActions.pin.test.tsx` ("notifies once a like settles") |
| `subscribePinChanged` + live `pinnedForAll`; `PostRemoved` leaves the tab | `services/realtimeFeed.pinChanged.test.ts` (frozen name on the singleton, exact two-key payload, malformed dropped, handler isolation, nothing after stop, `PostReceived` keeps `pinnedForAll: true`, never `viewer`); `pinned/PinnedFeed.test.tsx` (push adds/removes the marker and the post, patch lands before the re-read, `PostRemoved` takes the post off at once) |
| `ParticipantPostView.pinnedForAll`, `viewer.pinned`, provenance test | `types/post.provenance.test.ts` (third viewer key, `pinnedForAll` kept, who/when pinned never carried, `false`/`null` treated as absent) |
