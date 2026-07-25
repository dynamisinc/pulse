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
- [ ] All Posts / Following are tabs with an accent underline (D1); switching preserves scroll per feed.
      **Not built by this story** — deliberately left to the integration pass that owns `SocialChannel`
      (this story was scoped not to touch it). See Technical Notes for the exact mount point/props.
- [ ] Real-time updates arrive per story 04 (pill). **Deliberately disabled** under `scope="following"`:
      story 04's stream (`useFeedStream`/`postStore`) is not follow-aware — it buffers every arrival
      regardless of author — so wiring it in would show a pill counting posts from unfollowed accounts
      under the Following label, a worse bug than no pill. Stays this story's Out of Scope item; story
      04's own follow-up is where the stream becomes scope-aware.

## Deferred (tracked follow-ups)
- **Tab UI + per-feed scroll preservation (AC3).** Needs the integration pass wiring both scopes into
  `SocialChannel` (see Technical Notes for the mount point this story exposes).
- **Follow-aware real-time (AC4).** `useFeedStream`'s source has no per-post author filter; making the
  Following scope's pill correct is story 04's follow-up, not this story's.
- **Mock-mode "who does the session follow".** There is no frontend follow store in this worktree yet
  (profiles-social-graph story 02's write path, `useFollow`/`followService.ts`, is a parallel,
  not-yet-merged build) — `feedService.ts`'s mock adapter filters against a small fixed placeholder set
  (`DEFAULT_MOCK_FOLLOWED_PERSONA_IDS`) documented as a Wave-boundary stand-in, with a test-only override
  (`setMockFollowingForTests`). Once the real mock follow store lands, the mock adapter should read from
  it instead, so following/unfollowing an account in mock mode actually moves posts into/out of this feed.
  Live mode is unaffected by this — the real filtering is entirely server-side.

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
profiles-social-graph (follow edges — story 07/#370, backend built + wired, under review as of this
story's build); story 01 (feed infra); COR-015 (read-only default).

## Tests
- Service (unit) — `services/feedService.test.ts` (`resolveFeed('following')` mock-adapter filtering) +
  `services/feedService.following.live.test.ts` (LIVE mode: `?scope=following` request shape, the
  no-argument/`'all'` byte-identical request, empty-array resolution, and a rejection — e.g. the
  documented unknown-scope 400 — propagates rather than substituting a default feed).
- Hook (RTL) — `hooks/useFeed.following.test.ts`: filters to the mock following set; an empty follow set
  resolves an empty, non-error `posts` array; re-resolves on a `scope` change across a re-render.
- Component (RTL) — `pages/Feed.following.test.tsx`: renders only followed accounts; an empty follow set
  shows the honest Following-specific empty copy (never the All Posts copy, never any post card, never
  a fallback); the live "new posts" pill never appears under this scope, even after a live arrival.
- Component (RTL) — `pages/Feed.followingReadOnlyDefault.test.tsx`: a read-only session (persona still
  bound) AND a session with no bound persona each get the FULL All Posts set — never the
  filtered/empty Following feed — when mounted with `scope="following"`; the mount-view telemetry
  target stays `'all-posts'` in both cases.
