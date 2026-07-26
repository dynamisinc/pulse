# Story: Follow / unfollow

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
(hook + write path + guard + the `<Profile>` header integration, incl. the Gate-2 CR-002/CR-003
fold — see "Integration pass" below)
**Requirements:** SOC-051 (COR-001, COR-015)  ·  **Design decisions:** none  ·  **Issue:** #110

## Context
Follow/unfollow with follower-count effects; participants can follow any account in their exercise
(SOC-051). Follow edges feed the Following feed (feeds-discovery SOC-081). The write/read seam this
story's frontend calls is `profiles-social-graph/07-follow-graph-api.md` (#370, backend, Complete).

## Acceptance Criteria
- [x] A participant can follow/unfollow any account in their exercise (COR-001); the follow button
      reflects state. **This half was NOT true until the Gate-2 CR-002 fold** — `useFollow` seeded
      `isFollowing` from `initiallyFollowing = false` and nothing in shipped code ever passed that
      prop, so on the profile of an account the viewer already followed the button read "Follow" /
      `aria-pressed="false"`, and tapping it ran the optimistic `+1` against the server's idempotent
      `{ following: true, changed: false }` (no edge, no telemetry) and settled on `previousCount + 1`
      — the client displaying a follower gain that never happened. `<Profile>` now resolves the
      viewer's following set (`resolveFollowing(session.personaId)`, the same directed read
      `useWhoToFollow` uses) and passes `initiallyFollowing`; the control is WITHHELD until that
      resolves (`useFollow` seeds once, so a late prop could not correct it) and keyed on the resolved
      value, so no frame ever paints the wrong state. *(`<FollowButton>`
      (`components/FollowButton.tsx`) + `useFollow()`
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

## Integration pass (landed — Gate-2 CR-002 / CR-003 fold)
`<FollowButton>` was built and tested standalone first (mirroring `<FollowerList>`'s build order) and
mounted into `<Profile>`'s header in a later pass. That mount was initially **prop-less**, which is
what Gate 2 caught: the control rendered, but neither of the two props that make it truthful in a
host was passed. Both are now wired in `pages/Profile.tsx`:

- **CR-002 — `initiallyFollowing`.** Resolved from `resolveFollowing(session.personaId)` (skipped
  entirely for a read-only / personaless session and on the viewer's own profile, where the control is
  absent anyway; fails closed to "not following"). Because `useFollow` seeds `isFollowing` ONCE via
  `useState`, a late-arriving value could never be picked up — so the control is **withheld** until
  the read settles rather than mounted in a placeholder state, and is keyed on
  `` `${persona.id}:${viewerFollows}` `` so any later change remounts it instead of keeping a stale
  seed. Re-pointing the page at a different persona re-arms the gate in the same render-phase reset
  that already re-collapses the follower list.
- **CR-003 — `onFollowerCountChange`.** The header used to render
  `formatMagnitude(persona.followerCount)` off an object that never changes, so after a follow the
  button read "Following" while the header sat still. It now tracks the button's own optimistic ±1.
  Invisible for mid/large-band personas (`formatMagnitude` truncates a ±1 away) — which is exactly why
  no test caught it — and plainly visible for the seeded nano-band accounts, which render as exact
  integers below 1,000. `Profile.follow.test.tsx` pins it at the **nano** band for that reason.
- **SG-003 (honoured):** `<FollowButton>`'s count-sync effect depends on the callback's IDENTITY, so
  `<Profile>` passes a stable `useCallback` rather than an inline arrow, which would re-fire that
  effect on every render of the page.

## Deferred (tracked follow-ups)
- **`<WhoToFollow>`'s own `<FollowButton>` mount** (`components/WhoToFollow.tsx`) still passes neither
  prop. It is a *suggestion* list that by construction excludes accounts the viewer already follows
  (`useWhoToFollow`), so the CR-002 wrong-seed case cannot arise there today, and it renders no
  separate follower count for CR-003 to desync from. Revisit if either invariant changes.
- **Shell variant vs session read-only.** The Follow control is removed by the SESSION's `isReadOnly`
  (`useFollow().canFollow`), not by the shell mount variant — so a `variant: 'readOnly'` shell with a
  writable session still renders it, unlike the `<PostCard>` affordances WR-003 threads. Flagged, not
  changed: D1-011's absent-control rule is written against the observer SESSION, and re-deciding the
  shell-variant contract is a separate call.

## Out of Scope
Magnitude display (story 05); the Following feed itself (feeds-discovery); suggested follows
(story 04).

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

**Mock follower COUNTS, WR-005 fold (Gate 2).** `SEEDED_PERSONAS` is computed once at module load and
the mock follow write only mutates `followEdgeStore`, so in mock mode a target's
`persona.followerCount` never moved — not even across a reload — while live recomposes from
`GetEdgeCountsAsync` on every read. `personaService.ts`'s mock adapters (both projections) now compose
`followerCount = audienceMagnitude + mockFollowerIdsOf(id).length` per REQUEST, so the two modes agree;
`audienceMagnitude` is passed through raw so nothing double-counts the edges. That import is
mock-scaffold-only, and `followEdgeStore` takes `personaIdForHandle` from the leaf `personas/types`
rather than the barrel to keep the module graph acyclic.

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
- Integration (RTL) — `pages/Profile.follow.test.tsx` (the CR-002/CR-003 pins, driving the REAL mock
  edge store end to end rather than stubbing the write): the button reads "Following" on an
  already-followed account **with no wrong-state frame** (a `MutationObserver` records every committed
  `data-following` value, so a "Follow" → "Following" flip fails — a `findBy` assertion only samples
  the end state and would pass against the bug); tapping an already-followed NANO-band account
  unfollows instead of showing the phantom `+1`; the HEADER count moves 568 → 569 on a follow and
  rolls back on a rejected write; follow state does not carry across a re-point to a different
  persona. All five fail against the pre-fold code.
- Adapter (unit) — `features/personas/personaService.test.ts` (WR-005): the mock read recomposes
  `followerCount` as a follow lands and is undone, on both projections, leaving `audienceMagnitude`
  raw.
