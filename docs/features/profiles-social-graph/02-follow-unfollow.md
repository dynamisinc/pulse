# Story: Follow / unfollow

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Built (hook +
write path + guard); wiring into `<Profile>`'s header is a parallel integration pass — see
"Not yet wired" below
**Requirements:** SOC-051 (COR-001, COR-015)  ·  **Design decisions:** none  ·  **Issue:** #110

## Context
Follow/unfollow with follower-count effects; participants can follow any account in their exercise
(SOC-051). Follow edges feed the Following feed (feeds-discovery SOC-081). The write/read seam this
story's frontend calls is `profiles-social-graph/07-follow-graph-api.md` (#370, backend, Complete).

## Acceptance Criteria
- [x] A participant can follow/unfollow any account in their exercise (COR-001); the follow button
      reflects state. *(`<FollowButton>` (`components/FollowButton.tsx`) + `useFollow()`
      (`hooks/useFollow.ts`): an optimistic toggle that settles `isFollowing`/`followerCount` on the
      server's AUTHORITATIVE `following` value once the write resolves — SG-001 fold, Gate-1
      #88/#121 — rather than trusting the optimistic guess was right, so a client/server divergence
      self-corrects; rolls BOTH back to the pre-toggle values on a rejected write. The write itself —
      `followService.followPersona`/`unfollowPersona` — calls `POST`/`DELETE
      /api/personas/{id}/follow` and returns that response's `following` field (the
      `FollowStateResponseDto` envelope, never a bare `204`). Refused server-side for a read-only
      session (COR-015) and additionally guarded client-side so such a session's control never
      renders — see AC4.)*
- [x] Following affects the follower/following counts (real edges component of magnitude, story 05)
      and the Following feed (feeds-discovery SOC-081). *(Counts: `useFollow`'s optimistic
      `followerCount` is the real-edge component of story 05's magnitude formula; the composed,
      server-authoritative count itself is story 07's. Following feed: **holds LIVE today** — the
      backend's `GET /api/feed?scope=following` filters against the same `Follow` table this story's
      writes update, so a live follow/unfollow immediately changes what the Following feed serves.
      **Be honest about mock mode:** this did NOT hold until the WR-004 fold (Gate-1 #88/#121, folded
      in this same pass) — `followService.ts` kept its own mock follow edges and `feedService.ts`
      separately filtered the Following feed against a frozen literal placeholder set; the two were
      disconnected, so following an account through the mock write path moved nothing into the mock
      Following feed (the exact gap `VITE_USE_MOCK_DATA=true` — UAT's own setting — would have hit).
      Both mock adapters now read/write the ONE shared `services/followEdgeStore.ts`, and the round
      trip is pinned end-to-end by `services/followFeedRoundTrip.test.ts`.)*
- [x] Follow/unfollow emits telemetry (XC-004). *(**Satisfied by the BACKEND, not this frontend
      diff — precision matters here.** `FollowEndpoints.cs`/`FollowService.cs`
      (profiles-social-graph backend story 07, #370, Complete) emit exactly one XC-004 event per
      state CHANGE, server-stamped (actor, scenario time, exercise scope) — an idempotent repeat
      (following twice, unfollowing a non-edge) emits none. `useFollow`/`followService.ts`
      deliberately emit NOTHING client-side: a client emit here would double-count every toggle the
      server already recorded. If this AC is read as "this story's frontend build must itself emit
      telemetry", it does not — the AC is closed by story 07's backend, which this story's write path
      calls and relies on.)*
- [x] Observer/read-only mode: the Follow control is **absent** (D1-011); counts remain visible.
      *(`useFollow().canFollow` is `false` for a read-only session, OR one with no bound persona to
      follow AS, OR the viewer's own profile (story 07 AC8 — the server 400s a self-follow);
      `<FollowButton>` renders `null` in every one of those cases — never present-and-disabled. The
      follower/following counts are the CALLER's to render (this control never hides them, and
      `useFollow`'s `followerCount` output is unconditional). Covered by
      `hooks/useFollow.readonly.test.ts` / `hooks/useFollow.noPersona.test.ts` /
      `components/FollowButton.readonly.test.tsx` / `components/FollowButton.noPersona.test.tsx`.)*

## Not yet wired (why Status isn't Complete)
`<FollowButton>` is built and tested standalone (mirrors `<FollowerList>`'s own build order). It is
**not yet mounted inside `<Profile>`'s header** — that integration (rendering the button beside a
profile's follower/following counts, keeping a header-level count display in sync via
`onFollowerCountChange`, see SG-003 below) is a parallel pass over `pages/Profile.tsx` this story does
not own. **Do not flip this Status to Complete until that pass lands and is verified** — this story's
own scope (the hook + write path + control, all standalone-tested) is done; the wiring is not.

## Deferred (tracked follow-ups)
- **`<Profile>` integration** — see "Not yet wired" above.
- **SG-003 (fold, this pass):** `<FollowButton>`'s `onFollowerCountChange` effect depends on the
  callback's IDENTITY; the component's own doc comment now tells a host to `useCallback` it (a stable
  dependency) rather than pass an inline arrow, since the component itself cannot defend against an
  unstable prop identity without silently dropping legitimate rapid-fire count changes. Relevant once
  the `<Profile>` integration above lands and actually passes this prop.

## Out of Scope
Magnitude display (story 05); the Following feed itself (feeds-discovery); suggested follows
(story 04); wiring the control into `<Profile>` (parallel integration pass, see "Not yet wired").

## Technical Notes
Participant world. `hooks/useFollow.ts` (the optimistic state machine: toggle, rollback-on-reject,
settle-on-server-value) + `services/followService.ts` (the write/read seam:
`followPersona`/`unfollowPersona`/`resolveFollowing`/`resolveFollowers`) +
`components/FollowButton.tsx` (presentational, standalone).

**Mock adapters (dev/test/UAT-no-backend), WR-004 fold.** `followService.ts`'s follow/unfollow mock
writes and `feedService.ts`'s Following-scope mock read filter now share ONE in-memory edge store,
`services/followEdgeStore.ts` — see that module's own header for the full before/after. On first
load, the store seeds the mock viewer persona (`persona-dreyes_fh`) already following two real
seeded accounts, so a fresh dev/UAT session's Following feed has believable content before the
reader follows anyone. `resetMockFollowEdges()` (test-only) does NOT restore that seeded default —
it clears the graph to genuinely empty, the clean slate the rest of the suite (including
`04-who-to-follow`'s suggestion-exclusion specs) already depends on; a spec that wants the seeded
default back on purpose calls `feedService.setMockFollowingForTests(undefined)` instead.

**Wire contract, SG-001/SG-002 fold.** The real endpoint (`FollowEndpoints.cs`'s `MapResult`) returns
`200` + `FollowStateResponseDto` (`personaId`/`following`/`changed`) for BOTH the state-changing and
the idempotent-repeat case — never a bare `204`. `followPersona`/`unfollowPersona` now parse that
envelope (failing closed on a malformed body) and return the `following` field rather than `void`;
`useFollow` settles its own `isFollowing`/`followerCount` on that returned value once the write
resolves, so a client/server divergence self-corrects instead of asserting the optimistic guess was
right. The mock adapters emit the SAME envelope shape so a shape regression fails in test, not only in
UAT (mirrors the existing `FollowListResponseDto` precedent for the directed reads).

## Dependencies
story 01 (profile — the integration point, owned in parallel); feeds-discovery (Following feed
consumes these edges); telemetry (XC-004, satisfied server-side by story 07, not this story);
profiles-social-graph backend story 07 (#370, Complete — the follow/unfollow endpoints + directed
reads this story's write path calls).

## Tests
- Hook (RTL) — `hooks/useFollow.test.ts` (toggle + optimistic count + settle-on-server-value + no
  client telemetry + in-flight no-op + self-follow withheld + re-points on target change);
  `hooks/useFollow.rollback.test.ts` (rollback on a rejected write, and a retry after rollback still
  works); `hooks/useFollow.readonly.test.ts` / `hooks/useFollow.noPersona.test.ts` (control absent,
  D1-011).
- Service (unit) — `services/followService.test.ts`: the shipped mock path's idempotent
  follow/unfollow + round trip through `resolveFollowing`/`resolveFollowers`; the boundary-mocked wire
  contract against the real `FollowStateResponseDto`/`FollowListResponseDto` envelopes, including
  failing closed on a malformed body (SG-001/SG-002 fold).
- Integration (unit) — `services/followFeedRoundTrip.test.ts` (WR-004 fold, THE regression pin):
  following a persona via `followService` moves their posts into
  `feedService.resolveFeed('following')`; unfollowing removes them again; a pre-seeded default follow
  is undisturbed by following a different account.
- Component (RTL) — `components/FollowButton.test.tsx` / `FollowButton.readonly.test.tsx` /
  `FollowButton.noPersona.test.tsx`: renders the correct label/icon/`aria-pressed` per state, absent
  for observer/no-persona sessions.
