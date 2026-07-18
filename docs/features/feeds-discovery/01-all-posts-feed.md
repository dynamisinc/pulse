# Story: All Posts feed (global chronological)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-080  ·  **Design decisions:** none  ·  **Issue:** #120

## Context
The All Posts feed (global): every public post in the exercise, chronological. Default view for PIO-role
accounts (SOC-080) — the firehose a PIO monitors.

## Acceptance Criteria
- [x] The All Posts feed lists every public post in the exercise in chronological order (COR-001 scoped),
      rendered with `<PostCard>` in scenario time (COR-053). *(Newest-first via `useFeed`/`feedService`;
      provenance stripped through `toParticipantView` (XC-002); feed-view telemetry (XC-004) emits once
      on mount; the post list lives in an `aria-live="polite"` region — NFR-001.)*
- [x] It is the default landing feed for PIO-role accounts and for read-only sessions (COR-015). *(All
      Posts is the shell's only/default channel in S2 — mounted in `App.tsx`'s `ParticipantShellRoute` —
      so it lands every account, PIO or read-only, until Following/PIO-columns exist.)*
- [ ] The feed stays smooth and legible under burst (NFR-002/SOC-071) **via virtualization**; real-time
      updates arrive per story 04 (pill, not auto-scroll). *(Partial — ships as a memoized (`FeedRow` =
      `React.memo`), stable `post.id`-keyed flat list: virtualization-**ready**, not an actual windowing
      library; the real-time "new posts" pill is explicitly story 04's job per this AC's own wording.
      See Deferred.)*
- [x] Participant-world styled (Pulse skin, left-anchored per D1-013); no COBRA/default MUI.

## Deferred (tracked follow-ups)
- **Real windowing/virtualization.** The AC's "via virtualization" clause ships as a memoized,
  stable-keyed flat list (no windowing library). Row props are referentially stable, so it is
  genuinely virtualization-*ready* — a windowing lib can wrap `views.map(...)` later with no data-flow
  reshape — but it is not real windowing yet. Lands with feeds-discovery/04 (#123) when burst volume
  (120 posts/min, NFR-002/SOC-071) is exercised.
- **Real-time "new posts" pill.** Per the AC's own wording, this is feeds-discovery/04's (#123) job —
  not built in this wave. Today's feed is a one-shot render with no live-update mechanism; a freshly
  published post does not appear without a reload (see `SocialChannel`'s "why no `onPosted` wiring" note).

## Out of Scope
Following feed (story 02); search (story 03); real-time pill (story 04); "For You" (story 05); PIO
columns (story 06).

## Technical Notes
Participant world. Virtualized chronological list over `<PostCard>`. See implementation.md (story 01).

## Dependencies
posts (PostCard); E1 isolation/scenario-time; story 04 (real-time).

## Tests
- Component (RTL) — `src/frontend/src/features/social/pages/Feed.test.tsx`: renders every seeded public
  post via `<PostCard>` newest-first; wraps the list in an `aria-live="polite"` region; renders
  interactive controls only in the `full` variant (none under `readOnly`); never renders
  origin/actingHumanId/injectId though the seeded posts carry them (XC-002); does not remount an
  unchanged row when the feed re-renders (burst/NFR-002 groundwork); emits exactly one `'view'`
  telemetry event on mount and does not re-emit on re-render (XC-004).
- Component (RTL) — `Feed.states.test.tsx`: calm loading/empty/unavailable states, no out-of-fiction
  language.
- Service (unit) — `services/feedService.test.ts`: sorts newest-first regardless of input order;
  resolves each post's author; produces a view with no origin/actingHumanId fields.
