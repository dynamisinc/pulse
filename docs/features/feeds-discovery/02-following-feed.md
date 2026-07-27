# Story: Following feed

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete except AC2b
(the SOC-081 citizen-role default — deliberately deferred, see AC2b)
**Requirements:** SOC-081 (COR-015)  ·  **Design decisions:** none  ·  **Issue:** #121

## Context
The Following feed: posts from followed accounts. Default for citizen-role participants **with named
accounts**; read-only sessions (COR-015) default to All Posts (they cannot follow, so Following would be
empty). The gap between "official message sent" and "what a citizen who didn't follow the agency sees"
is the teaching moment (SOC-081).

## Acceptance Criteria
- [x] **AC1.** The Following feed shows posts from accounts the user follows (profiles SOC-051),
      chronological, exercise-scoped (COR-001), scenario time (COR-053). *(`<Feed scope="following">`
      — extends story 01's `useFeed`/`feedService` with a `FeedScope` param rather than forking a
      second feed; live mode sends `GET /api/feed?scope=following`, the backend's documented
      follow-graph seam (`profiles-social-graph/07`, #370) does ALL the filtering server-side — no
      client-composed second round trip. An empty follow set resolves an empty array, rendered as an
      honest, Following-specific empty state — never a silent fallback to the unfiltered feed.)*
- [x] **AC2a — the COR-015 half.** Read-only sessions default to All Posts (COR-015), never the empty
      Following feed. *(The COR-015 guard is built INTO `<Feed>`/`useFeed` itself — defensively,
      mirroring `useReaction`'s `canReact` predicate exactly: a `scope="following"` request is served
      as `'all'` whenever the session is read-only or has no bound persona, regardless of what the
      caller asked for. Verified by `SocialChannel.feedSwitch.test.tsx`/`.noPersona.test.tsx` and
      `pages/Feed.followingReadOnlyDefault.test.tsx`: the tablist is absent entirely, and a
      `scope="following"` mount still resolves the full All Posts set for such a session.)*
- [ ] **AC2b — UNTICKED, the SOC-081 half is not delivered.** "Following is the default for
      citizen-role participants with named accounts" is **not** what the integrated build does: as
      landed (`SocialChannel.tsx`'s `feedTab` state), **every** session — citizen-role or not — lands
      on the **All Posts** tab by default (`useState<FeedTabId>('all')`), confirmed by
      `SocialChannel.feedSwitch.test.tsx`'s own assertion "renders a tablist with All Posts selected by
      default". Only AC2a (read-only → All Posts, never empty Following) is true.
      **Recorded as a deliberate deferral, not an oversight:** a newly-onboarded participant follows
      nobody at exercise start, so defaulting a citizen-role session straight to an empty Following
      feed would be a worse first experience than the unfiltered feed with real content — and *when*
      to flip a citizen-role default (immediately vs. after their first follow, say) is a real UX
      decision this integration pass correctly declined to make unilaterally. Tracked as a follow-up
      to be picked up on its own pass, not silently claimed here.
- [x] **AC3.** All Posts / Following are tabs with an accent underline (D1); switching preserves scroll
      per feed. *(Built by the profiles-social-graph final integration pass, #88 — not by this story,
      which was scoped not to touch `SocialChannel`. The channel now renders a WAI-ARIA tablist above
      the feed (`role="tablist"`/`role="tab"`/`aria-selected` + roving tabindex; accent underline
      **plus** weight and colour, never colour alone — NFR-001) and mounts the two scopes as SEPARATE
      `<Feed>` instances exactly as Technical Notes recommends: the Following instance mounts on first
      switch and both stay mounted (the inactive one `hidden`) thereafter, so each keeps its own frozen
      baseline, its own one-shot mount `view` telemetry, and its own rendered scroll state across a
      switch. The switch is ABSENT for a read-only/no-persona session — see AC2a. Covered by
      `SocialChannel.feedSwitch.test.tsx` + `SocialChannel.feedSwitch.noPersona.test.tsx`.)*
- [x] **AC4.** Real-time updates arrive per story 04 (pill) — **now follow-aware, delivered on a
      later pass** (`build/feeds-discovery/08-follow-aware-stream`, #91). The earlier build
      **disabled** the stream under `scope="following"` because the source is author-agnostic and a
      Following-labelled pill counting unfollowed accounts would be a lie. Live manual testing showed
      what that traded it for: a Following feed that never moved and never said so — the reader had no
      way to know anything had arrived short of a full reload. **The fix is to filter, not to
      disable.** `useFeedStream` now takes an optional `admit(post) => boolean`, applied at the moment
      a post is offered to the buffer: a rejected arrival is never buffered, never counted, and never
      recorded in the dedup id set, so the pill's number always drains to exactly that many visible
      posts. `<Feed scope="following">` passes a predicate admitting only posts whose
      `authorPersonaId` is in the VIEWER's followed set (`hooks/useFollowedSet.ts` →
      `followService.resolveFollowing(session.personaId)` — the same server-authoritative seam, and in
      mock mode the same shared `followEdgeStore`, that the Following baseline itself filters on, so
      the pill and the feed can never disagree about who is followed). `<Feed scope="all">` passes NO
      predicate at all — the All Posts path is unchanged. Observer/read-only sessions still get no
      pill and an inert stream (D1-011): `streamEnabled` now gates on the shell variant alone.
      A follow made MID-SESSION takes effect on that account's next arrival with no remount —
      `useFollowedSet` re-reads the graph on every successful follow/unfollow write
      (`followService.subscribeFollowChanges`) while keeping its predicate's identity stable, so the
      stream is never torn down and re-subscribed for a filter change.

## Deferred (tracked follow-ups)
- **AC2b — the SOC-081 citizen-role default.** Not delivered; see AC2b above for the rationale. This
  is real, undone scope, tracked for a future pass — not merely a residual of an otherwise-done AC.
- **RESOLVED — tab UI (AC3).** Delivered by the profiles-social-graph final integration pass (#88); see
  AC3. One precise residual: keeping both instances mounted preserves each feed's own DOM/scroll state,
  which is what per-feed scroll preservation needs, but the channel does not (yet) save/restore the
  WINDOW scroll offset across a switch — with a single page-level scroller the viewport offset is
  shared, so a switch between feeds of very different heights can still land clamped. Explicit
  per-tab scroll-offset restore is a small follow-up polish on `SocialChannel.tsx`, not a data-layer
  concern.
- **RESOLVED — follow-aware real-time (AC4)** (#91, `build/feeds-discovery/08-follow-aware-stream`).
  This section previously said the Following scope's pill was story 04's follow-up because
  `useFeedStream`'s source has no per-post author filter. The filter now lives one layer up, in the
  hook rather than the source: an optional `admit` predicate applied as a post is offered to the
  buffer, so the transport stays author-agnostic (and COR-001-clean — no client-side scope parameter
  was added to `start()`/`subscribe()`) while the Following mount only ever counts posts it can
  actually show. See AC4 above for the full shape.
  **How much of story 04 this covers:** the *Following case* of SOC-083/D1-005 — buffered, no
  auto-insert, honest count, observer-hidden — and nothing else. Story 04 also owns the transport half
  (shared SignalR connection + polling fallback, NFR-003), which this pass did not touch: the filter
  is applied to whatever the existing source delivers, in both mock and live mode. Story 04's own
  status is unchanged by this work.
- **The already-open Following feed still does not gain a newly-followed account's OLDER posts.**
  Narrowed by the AC4 work above, not resolved: `useFeed` freezes its resolved post set on mount per
  scope (the module's own "frozen baseline" design — see `hooks/useFeed.ts`), so following a new
  account while the Following tab is open does not backfill that account's already-published posts
  until the tab is remounted (switch away and back, or a reload). What DOES now work is everything
  from that moment forward: their next post is admitted by the live stream and surfaces on the pill.
  The remaining backfill gap is **correct per the frozen-stream decision** (SOC-083/D1-005's "never
  live-insert into the reading stream" applies to composition changes too, not just new posts) —
  recorded here as known, intentional behavior, not a bug.
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
The follow mechanic (profiles SOC-051); All Posts (story 01); the real-time pill's own transport and
buffering machinery (story 04 — this story only supplies the follow filter it is fed, see AC4); the
tab UI / `SocialChannel` wiring (integration pass, not this story).

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
  a fallback) and admits no live arrival either (every author is unfollowed, so the pill stays absent).
- Component (RTL) — `pages/Feed.followingStream.test.tsx` (AC4): an arrival from a FOLLOWED account
  increments the pill and tapping it shows that post at the top; an arrival from an UNFOLLOWED account
  is never counted and never shown; a mixed burst's count matches the drain exactly (3 arrive, 2
  admitted, 2 rendered); a follow made mid-session admits that account's NEXT arrival without a
  remount (and does not resurrect the pre-follow one, which was never buffered); a
  `readOnly`/`preview` mount still gets no pill at all (D1-011).
- Hook (RTL) — `hooks/useFeedStream.test.ts` (AC4): omitting `admit` admits everything (the All Posts
  path is unchanged); a rejected arrival is neither counted nor buffered nor dedup-recorded; the count
  always equals the drain; a stable predicate causes no re-subscribe, and a changed one re-subscribes
  without clearing the buffer. `hooks/useFollowedSet.test.ts`: resolves through `resolveFollowing`,
  refreshes on a mid-session follow while keeping a STABLE predicate identity, issues no request with
  no viewer persona, and fails CLOSED on a rejected read.
- Service (unit) — `services/followService.test.ts` (AC4): `subscribeFollowChanges` notifies after a
  successful follow AND unfollow (including an idempotent `changed: false` repeat — precisely when a
  cached set may be the stale thing), never after a failed write, and stops on unsubscribe.
- Component (RTL) — `pages/Feed.followingReadOnlyDefault.test.tsx`: a read-only session (persona still
  bound) AND a session with no bound persona each get the FULL All Posts set — never the
  filtered/empty Following feed — when mounted with `scope="following"`; the mount-view telemetry
  target stays `'all-posts'` in both cases.
