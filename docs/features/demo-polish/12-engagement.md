# Story: Engagement — persisted likes and reposts

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-030, SOC-020 (repost toggle), SOC-021, NFR-001, COR-015  ·  **Design decisions:** D1-011 (absent, not disabled)  ·  **Issue:** —
**Story ID:** F3  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 2
**Home stories:** [`reactions/01`](../reactions/01-like.md), [`amplification/01`](../amplification/01-repost-quote.md).

## Context
**As** a participant, **I want** my likes and reposts to stick and the counts to look real, **so that** the
engagement counters respond to clicks and survive a refresh (demo beat 3). Today a like is a local toggle that
resets on refresh and the post cards on profile and hashtag pages have dead buttons. After F0, `PostActions`
already self-wires the old local hooks everywhere; this story makes them persist. **World: participant** — no
COBRA/MUI.

## Acceptance Criteria
- [ ] **Persisted toggles.** Given a persona-bound participant, when they like/repost, then the UI updates
      **optimistically** and calls `PUT /api/posts/{id}/reactions/{like|repost}` (unlike/undo → `DELETE`); the
      response's `counts` and `viewer` reconcile local state; after a refresh the heart/repost stay active
      because the initial state comes from the post's `viewer`.
- [ ] **Rollback on failure.** If the request fails, the count and `aria-pressed` revert exactly and a brief
      inline error is announced through a polite live region; rapid double-taps do not double-count (in-flight
      guard).
- [ ] **Compact counts.** Counts render with the shared magnitude formatter — exact below 1 000, then `1.4K`,
      `12.3K`, `1.2M` (truncated, `.0` dropped); the exact number is in the accessible name
      (`spokenMagnitude`/label). Reuse `formatMagnitude`/`spokenMagnitude` from `services/audience.ts`; do not
      fork a second formatter.
- [ ] **No dead buttons anywhere.** Cards on the feed, thread, profile and hashtag pages all have live
      like/repost with no per-page wiring; a test on a Profile card proves a like fires a request.
- [ ] **Quote and share are hidden** (absent, not disabled): no Quote trigger, no Share action; `QuoteComposer`
      is no longer mounted.
- [ ] **Read-only / no-persona (COR-015, D1-011).** Controls are absent and counts are inert text, unchanged.
- [ ] **No double telemetry.** In live mode the frontend emits **no** `reaction`/`repost` event (the server is
      authoritative, implementation.md §1.8); in mock mode it emits exactly one per toggle as today. The client
      never sends an `exerciseId` or a `personaId`.
- [ ] **Never color-only (NFR-001).** The active state combines icon fill, count weight, `aria-pressed` and an
      "…, liked"/"…, reposted" accessible-name suffix.

## Out of Scope
Quote posts, the "X reposted" fan-out, who-liked lists, sentiment reactions, notifications from likes (F7
derives its own), controller reactions, rate limiting.

## Technical Notes
- Files: implementation.md §4.1 row F3 (`post/PostActions.*`, `hooks/useReaction.ts`, `hooks/useAmplify.ts`,
  `services/amplify.ts`, new `services/reactionService.ts` with a mock adapter). Keep the hooks' public shape
  (`likeCount`, `likedByViewer`, `toggleLike`, `canReact`, `isReadOnly`) so F0's relocation is not disturbed;
  add `initiallyLiked`/`initiallyReposted` from `post.viewer`. `PostCard`/`PostHeader`/`PostBody` are frozen —
  do not edit them.
- Use the shared axios client (`core/services/api.ts`). Mock mode: in-memory map, plus a test-only failure
  switch for the rollback test.
- Scenario time: the client no longer stamps reaction time in live mode (the server uses the exercise clock).

## Dependencies
F0. Runs with F1, F2, F4–F6. **Live check** once B3 (and BP for `viewer`) are deployed: like → refresh → still
liked; counts equal the feed's.

## Tests
- `useReaction`/`useAmplify`: optimistic apply, reconcile from response, rollback + live-region message,
  in-flight guard, read-only/no-persona absent controls, initial state from `viewer`, live-mode zero telemetry
  vs mock-mode one event.
- `PostActions`: compact counts + accessible names at boundaries (0, 9, 999, 1 000, 1 450, 12 300), quote/share
  absent, `aria-pressed`.
- Profile/Hashtag card smoke test (no dead buttons). Regression: `Feed.actions.test.tsx`, `ThreadView.test.tsx`.
