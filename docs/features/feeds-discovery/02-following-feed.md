# Story: Following feed

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Built (data layer + guard); tab UI is an integration pass
**Requirements:** SOC-081 (COR-015)  ·  **Design decisions:** none  ·  **Issue:** #121

## Context
The Following feed: posts from followed accounts. Default for citizen-role participants **with named
accounts**; read-only sessions (COR-015) default to All Posts (they cannot follow, so Following would be
empty). The gap between "official message sent" and "what a citizen who didn't follow the agency sees"
is the teaching moment (SOC-081).

## Acceptance Criteria
- [x] The Following feed shows posts from accounts the user follows (profiles SOC-051), chronological,
      exercise-scoped (COR-001), scenario time (COR-053). *(`<Feed scope="following">` — extends story
      01's `useFeed`/`feedService` with a `FeedScope` param rather than forking a second feed; live mode
      sends `GET /api/feed?scope=following`, the backend's documented follow-graph seam
      (`profiles-social-graph/07`, #370) does ALL the filtering server-side — no client-composed second
      round trip. An empty follow set resolves an empty array, rendered as an honest, Following-specific
      empty state — never a silent fallback to the unfiltered feed.)*
- [x] It is the default for citizen-role participants with named accounts; **read-only sessions default
      to All Posts** (COR-015), never the empty Following feed. *(The COR-015 guard is built INTO
      `<Feed>` itself — defensively, mirroring `useReaction`'s `canReact` predicate exactly: a
      `scope="following"` request is served as `'all'` whenever the session is read-only or has no bound
      persona, regardless of what the caller asked for. What remains is which tab a citizen-role session
      lands on BY DEFAULT when the tab UI mounts — that selection lives in the orchestrator's integration
      pass, see Technical Notes.)*
- [x] All Posts / Following are tabs with an accent underline (D1); switching preserves scroll per feed.
      *(Built by the profiles-social-graph final integration pass, #88 — not by this story, which was
      scoped not to touch `SocialChannel`. The channel now renders a WAI-ARIA tablist above the feed
      (`role="tablist"`/`role="tab"`/`aria-selected` + roving tabindex; accent underline **plus** weight
      and colour, never colour alone — NFR-001) and mounts the two scopes as SEPARATE `<Feed>`
      instances exactly as Technical Notes recommends: the Following instance mounts on first switch and
      both stay mounted (the inactive one `hidden`) thereafter, so each keeps its own frozen baseline,
      its own one-shot mount `view` telemetry, and its own rendered scroll state across a switch. The
      switch is ABSENT for a read-only/no-persona session — see the note under AC2. Covered by
      `SocialChannel.feedSwitch.test.tsx` + `SocialChannel.feedSwitch.noPersona.test.tsx`.)*
- [ ] Real-time updates arrive per story 04 (pill). **Deliberately disabled** under `scope="following"`:
      story 04's stream (`useFeedStream`/`postStore`) is not follow-aware — it buffers every arrival
      regardless of author — so wiring it in would show a pill counting posts from unfollowed accounts
      under the Following label, a worse bug than no pill. Stays this story's Out of Scope item; story
      04's own follow-up is where the stream becomes scope-aware.

## Deferred (tracked follow-ups)
- **RESOLVED — tab UI (AC3).** Delivered by the profiles-social-graph final integration pass (#88); see
  AC3. One precise residual: keeping both instances mounted preserves each feed's own DOM/scroll state,
  which is what per-feed scroll preservation needs, but the channel does not (yet) save/restore the
  WINDOW scroll offset across a switch — with a single page-level scroller the viewport offset is
  shared, so a switch between feeds of very different heights can still land clamped. Explicit
  per-tab scroll-offset restore is a small follow-up polish on `SocialChannel.tsx`, not a data-layer
  concern.
- **Follow-aware real-time (AC4).** `useFeedStream`'s source has no per-post author filter; making the
  Following scope's pill correct is story 04's follow-up, not this story's.
- **RESOLVED — mock-mode "who does the session follow" (WR-004 fold, Gate-1 #88/#121).** This
  section previously said profiles-social-graph story 02 (the follow/unfollow write path,
  `useFollow`/`followService.ts`) was "a parallel, not-yet-merged build" and that `feedService.ts`'s
  mock adapter filtered against its own frozen placeholder set until that write path landed. **Both
  premises are now stale: story 02 is merged, and merging it exposed the real gap** — its mock follow
  edges (`followService.ts`'s own `MOCK_EDGES`) and this story's mock Following-scope filter
  (`feedService.ts`'s `DEFAULT_MOCK_FOLLOWED_PERSONA_IDS` / `mockFollowedPersonaIds`) were two
  DISCONNECTED stores, so following an account through the mock write path moved nothing into the
  mock Following feed — exactly the gap `VITE_USE_MOCK_DATA=true` (UAT's own setting) would have hit.
  Fixed in this same pass: both mock adapters now read/write ONE shared store,
  `services/followEdgeStore.ts`, seeded on first load with the same two default accounts this story
  always used (so a fresh dev/UAT session's feed still has content before the reader follows
  anyone), and the round trip is pinned by `services/followFeedRoundTrip.test.ts` (follow → the
  account's posts appear in `resolveFeed('following')`; unfollow → they disappear). Note the store's
  test-only `resetMockFollowEdges()` clears to an EMPTY graph, not back to that seeded default — the
  clean slate the rest of the suite (e.g. `04-who-to-follow`'s suggestion-exclusion specs) already
  depends on; `setMockFollowingForTests` remains the sanctioned override for a spec that wants the
  seeded default (or any other explicit set) back on purpose. Live mode was never affected — the
  real filtering is entirely server-side.

## Out of Scope
The follow mechanic (profiles SOC-051); All Posts (story 01); real-time pill (story 04); the tab UI /
`SocialChannel` wiring (integration pass, not this story).

## Technical Notes
Participant world. Extends `<Feed>`/`useFeed`/`feedService` (story 01) with a `FeedScope = 'all' |
'following'` parameter rather than forking a second feed implementation:
- `feedService.resolveFeed(scope?: FeedScope)` — defaults to `'all'`; `resolveFeed()` with no argument
  sends the EXACT SAME request as before this story (byte-identical All Posts path). `'following'` adds
  `params: { scope: 'following' }`, live-matching the backend's `GET /api/feed?scope=following` contract.
- `useFeed(scope?: FeedScope)` — same signature extension; re-resolves (and re-freezes a fresh per-scope
  baseline) whenever `scope` changes.
- `<Feed scope?: FeedScope, onOpenThread?, onHashtagOpen?>` — the mount point for the integration pass.
  Mounting `<Feed scope="following" onOpenThread={...} onHashtagOpen={...} />` alongside the existing
  `<Feed onOpenThread={...} onHashtagOpen={...} />` (or `<Feed scope="all" .../>`, equivalent) is the
  whole of what `SocialChannel`'s tab switcher needs to do — no other prop threading required. Each
  mount emits its own `'view'` telemetry with `target.entityId` `'all-posts'` / `'following-feed'`
  respectively (XC-004) and its own Following-specific empty-state copy when applicable. Recommend
  mounting both feeds as SEPARATE component instances (e.g. keyed) rather than flipping `scope` on one
  persistent instance, so each keeps its own frozen per-scope baseline, its own mount-view telemetry, and
  (for AC3's per-feed scroll preservation) its own scroll position to restore on tab switch.

## Dependencies
profiles-social-graph (follow edges — story 07/#370, backend, Complete); story 01 (feed infra);
COR-015 (read-only default).

## Tests
- Service (unit) — `services/feedService.test.ts` (`resolveFeed('following')` mock-adapter filtering) +
  `services/feedService.following.live.test.ts` (LIVE mode: `?scope=following` request shape, the
  no-argument/`'all'` byte-identical request, empty-array resolution, and a rejection — e.g. the
  documented unknown-scope 400 — propagates rather than substituting a default feed) +
  `services/followFeedRoundTrip.test.ts` (WR-004 fold: follow via `followService` moves posts into
  `resolveFeed('following')`; unfollow removes them again).
- Hook (RTL) — `hooks/useFeed.following.test.ts`: filters to the mock following set; an empty follow set
  resolves an empty, non-error `posts` array; re-resolves on a `scope` change across a re-render.
  `hooks/useFeed.readonlyGuard.test.ts` (WR-005 fold): the COR-015 "read-only/no-persona sessions never
  get 'following'" guard is enforced INSIDE `useFeed` itself, not only in `<Feed>` — pinned by calling
  the hook directly (no `<Feed>` in the tree) with a read-only and a no-persona session.
- Component (RTL) — `pages/Feed.following.test.tsx`: renders only followed accounts; an empty follow set
  shows the honest Following-specific empty copy (never the All Posts copy, never any post card, never
  a fallback); the live "new posts" pill never appears under this scope, even after a live arrival.
- Component (RTL) — `pages/Feed.followingReadOnlyDefault.test.tsx`: a read-only session (persona still
  bound) AND a session with no bound persona each get the FULL All Posts set — never the
  filtered/empty Following feed — when mounted with `scope="following"`; the mount-view telemetry
  target stays `'all-posts'` in both cases.
