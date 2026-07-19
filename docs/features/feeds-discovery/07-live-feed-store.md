# Story: Live post store — Wave-1 minimal slice of real-time feed updates

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-083 (partial), COR-001, COR-053, XC-002, NFR-002/SOC-071, NFR-001  ·  **Design decisions:** D1-005 (partial)  ·  **Issue:** —

## Context
This is a **Wave-1 minimal slice** of SOC-083 ("feeds update in real time... without manual
refresh"), authored to unblock a cross-feature integration wave: `console-shell/01`'s ⌘K
persona-dock host mounts `persona-operation`'s picker → composer → context panel, and a controller's
published post (`persona-operation/01`'s `PersonaComposer`, via `onPublished`) needs to appear in the
participant Social feed without a page reload — the same seam the shipped `SocialChannel`'s module
header already calls out as reserved (`Composer`'s `onPosted` prop) and explicitly says a published
post "does NOT appear yet" (Wave S2).

This slice makes the feed's **read seam live** — a module-singleton post store the feed subscribes
to — so an appended post surfaces immediately, newest-first, via the feed's existing
`aria-live="polite"` announcement. It is deliberately **minimal**: it does NOT build the buffered
"▲ N new posts" pill, the SignalR transport + polling fallback, or the auto-scroll-suppression UX
that D1-005 specifies in full — those remain **`04-realtime-new-posts-pill.md` (#123)**, the FULL
follow-up and this slice's parent. **This story does not close or complete #123.**

## Acceptance Criteria
- [x] Given the feed's mock adapter, when `feedService.resolveFeed()` resolves, then it reads from a
      new module-singleton `postStore` (`features/social/services/postStore.ts`'s `getPosts()`),
      seeded from the shipped `listPosts()`, rather than calling `listPosts()` directly.
- [x] Given a post is appended via `postStore.appendPost(post)`, when `useFeed()` re-derives (via its
      subscription to the store), then the new post appears in the assembled feed at the **top**
      (newest-first, via the existing `assembleFeedView`/`toParticipantView` convergence) without a
      full remount or a re-fetch of the seeded baseline.
- [x] The feed's existing `aria-live="polite"` `<ul>` region (`Feed.tsx`) announces the arrival — this
      story adds **no** "new posts" pill, **no** auto-scroll, and **no** mid-stream slide-in animation
      (all explicitly deferred to the FULL #123 follow-up).
- [x] `postStore` is exercise-scoped **by construction, stamping-only**: appended `Post`s already carry
      their own `exerciseId` (stamped upstream by `createPost`), and this story introduces **no**
      client `exerciseId` query-scoping parameter anywhere in the read path (WAVE0-REVIEW precedent 13;
      COR-001) — `assembleFeedView`/`toParticipantView` remain the sole narrowing, so a stored post's
      provenance (`origin`/`actingHumanId`/`createdWallClock`/`injectId`) is still stripped on read
      (XC-002) even for a just-appended post.
- [x] `postStore` exposes `resetForTests()` so tests can restore the seeded baseline between cases
      without cross-test pollution.

## Delivered (Wave 1)
Built in the 5-story Wave-1 parallel fan-out on `feature/simcell-operator`, Gate-1 clean (0
Critical/0 Major); the integrated umbrella is Gate-2 clean (opus/xhigh — 0 Critical/0 Major/3 Minor
token-consistency notes/2 informational); `build:check` + `lint` clean; 684/684 tests pass (up from a
588 baseline). This remains a **minimal slice** of SOC-083/D1-005 — the buffered "▲ N new posts" pill,
SignalR transport + polling fallback, and auto-scroll suppression stay with the FULL follow-up
(`04-realtime-new-posts-pill.md`, #123), which this story does not close or complete. Browser-verified:
a post published as @FairhavenWater from the console composer appeared at the top of the participant
`/shell` All Posts feed with no reload, provenance stripped. Files:
`features/social/services/postStore.ts` (new) + edits to `features/social/{services/feedService.ts,
hooks/useFeed.ts}`.

## Out of Scope
The buffered "▲ N new posts" pill, the SignalR transport + polling fallback (NFR-003), hover-to-pause
column behavior, and auto-scroll suppression UX — all full **`04-realtime-new-posts-pill.md` (#123)**,
which this slice does not complete or supersede. Cross-participant/cross-tab real-time fan-out (this
is a same-tab, in-memory module store; a real push transport is the eventual live host). Any
composing UI — this story owns the store + read seam only; the Wave-1 **integration step** (see
`console-shell/01`'s "Wave-1 integration seam") wires `persona-operation/01`'s `onPublished` callback
to `appendPost`, not this story.

## Technical Notes
Participant world (Pulse Social skin — no COBRA, no themed MUI). Files this story owns (the **only**
story in the Wave-1 cross-feature composition touching `features/social/*`):
`features/social/services/postStore.ts` (new) + edits to `features/social/services/feedService.ts`
(mock adapter reads `postStore.getPosts()`) and `features/social/hooks/useFeed.ts` (subscribes via
`postStore.subscribe(listener)`/re-derives `assembleFeedView`). `Feed.tsx` needs no markup change
beyond the data now being live — its `aria-live="polite"` region and burst-legibility memoization
(stable `PostView` identities, `React.memo`'d rows) are unaffected.

`postStore`'s shape: `{ getPosts(): Post[], appendPost(post: Post): void, subscribe(listener: () =>
void): () => void, resetForTests(): void }` — a module-singleton seeded once from `listPosts()`.

Cross-reference: `console-shell/01` (controller identity + persona-dock host),
`persona-operation/01` (the `onPublished` producer this store's `appendPost` is wired to, at
integration — not a direct import here). See `implementation.md` for the file-ownership map + wave
plan.

## Dependencies
The shipped `features/social/services/postService.ts` (`listPosts`, `toParticipantView`) and
`feedService.ts`/`useFeed.ts`/`Feed.tsx` (`feeds-discovery/01`, Complete). Precedes the Wave-1
integration step that wires `persona-operation/01`'s `onPublished` to `appendPost`. Parent/full
follow-up: `04-realtime-new-posts-pill.md` (#123).

## Tests
- Unit: `postStore.appendPost` + `getPosts()` returns the seeded baseline plus the appended post, in
  insertion order (sorting is `assembleFeedView`'s job, not the store's); `resetForTests()` restores
  the baseline.
- Unit: `feedService`'s mock adapter resolves through `postStore.getPosts()` (not `listPosts()`
  directly).
- Component (RTL): `useFeed()`/`<Feed>` re-renders with a newly appended post at the top,
  newest-first, without disturbing the `aria-live="polite"` contract or the existing seeded posts'
  row identity/order.
