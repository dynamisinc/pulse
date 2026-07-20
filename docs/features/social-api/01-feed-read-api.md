# Story: Feed & thread read API — GET /feed, GET /threads/:id

**Feature:** Social API (backend)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-080, SOC-010 (XC-002, COR-001/002, COR-053)  ·  **Design decisions:** none  ·  **Issue:** #270

## Context
The All Posts feed (SOC-080, E2 §3) and the flattened thread view (SOC-010, E2 §F2.2) are both
shipped, participant-facing, and fully mocked. This story builds their server: `GET /feed` and
`GET /threads/:id`, standing in for the `mockAdapter`s `feedService.resolveFeed()`
(`feedService.ts:67-73,103-112`) and `useThread.resolveThread()` (`useThread.ts:232-254`) already
call. Both hooks are documented "Participant world (Pulse Social skin)" in their own module
headers — they have no other caller today — so this endpoint's provenance projection is
**unconditional** for every request (contrast `02-post-write-api`, whose single endpoint serves a
staff caller too and is deliberately role-conditional).

This retires a specific, named engineering finding: **S2-2** (`docs/BUILD_PLAN.md:127-129`) —
today `resolveFeed`/`resolveThread` return the *full* `Post` over the (mock) transport, narrowed to
`ParticipantPostView` **client-side** by `toParticipantView` (`postService.ts:152-162`). That is a
trust-the-client design the mock era could afford; a real backend must not repeat it. This
endpoint projects provenance out **before serialization** — a compromised or bypassed client can
never recover `origin`/`actingHumanId`/`createdWallClock`/`injectId` because they are never on the
wire, not because a component chooses not to render them.

## Acceptance Criteria
- [ ] **Feed scoping + shape (SOC-080).** Given a request whose resolved exercise scope
      (`IExerciseContext` from `exercise-isolation/01`) is exercise A, when the client calls `GET /feed`,
      then the response is exercise A's public post set only, and every item satisfies
      `feedService.ts`'s `isPost` runtime guard (`id`, `authorPersonaId`, `text`, `scenarioTime`,
      `counts.{reply,repost,like}` present) — `resolveFeed()` and `assembleFeedView()`
      (`feedService.ts:140-165`) require no code change to consume it.
- [ ] **Thread shape (SOC-010).** Given the same scope, when the client calls
      `GET /threads/{postId}` for a post in exercise A, then the response matches `useThread.ts`'s
      `ThreadWireResponse` shape (`ancestors: Post[]` oldest-first with unbounded depth per D1-006,
      `focused: Post | null`, `replies: (Post & {replyToPersonaId, status})[]`) and passes
      `isValidThreadResponse`; an unknown or cross-exercise `postId` resolves `focused: null` and
      empty `ancestors`/`replies` — never a 500 and never another exercise's content.
- [ ] **XC-002 guarantee, server-side, unconditional (testable at the wire, not just client-side).**
      Given either endpoint returns a post or reply, when the raw HTTP response body is inspected,
      then it contains no `origin`, `actingHumanId`, `createdWallClock`, or `injectId` key on any
      item — structurally absent, not merely unread by `toParticipantView`. This is the retirement
      of finding S2-2 above.
- [ ] **[Tier-2 — human sign-off, always-Critical isolation class]** Given a request scoped to
      exercise A, when it targets `GET /threads/{postId}` for a `postId` known to belong to
      exercise B, then the response is 403/404 — never exercise B's content. Add this case to the
      standing cross-exercise isolation suite (`exercise-isolation/07-isolation-test-suite`,
      COR-007).
- [ ] **Scenario time preserved (COR-053).** Given any returned post/reply, `scenarioTime` is the
      stored scenario-time ISO instant exactly as persisted — the server never substitutes,
      localizes, or derives it from its own wall clock. `formatScenarioTime()` (frontend,
      unchanged) remains the only rendering step.
- [ ] **Fails closed on an unresolvable scope.** Given a request whose exercise scope cannot be
      resolved (no valid host/session scope; full host/session-token auth is Phase B2 `identity-backend`), when either endpoint is called,
      then it returns 401/403 — never a default, empty-but-200, or unscoped result.

## Out of Scope
Following feed (SOC-081), full-text search (SOC-082), engagement-weighted "For You" (SOC-084) — all
later `feeds-discovery` stories. The soft-delete/takedown **mutation** (SOC-005, CTL-025) — this
endpoint serves whatever `status` a reply already carries (`'visible'` by default; no takedown
mutation exists yet in this phase). A staff-only, origin-aware monitoring feed (CTL-030,
`live-monitoring`, F7.4 stub) — a separate, later, and separately-scoped route; this endpoint is
never the one CTL-030 reads from. Pagination/cursor design — the frozen contract returns the whole
array today; do not invent pagination ahead of the client needing it. NFR-002 burst-scale query
optimization — functional correctness now; performance is the explicit "one hardening pass after
B1" (`BACKEND_ROADMAP.md` §3.6/§8).

## Technical Notes
Backend/service work, no visual world of its own. See `implementation.md` for the full reuse map
and Wave Plan; owns `Pulse.WebApi/Features/Social/{FeedEndpoints.cs,ThreadEndpoints.cs,
ParticipantPostDto.cs,PostReadService.cs}`. The response DTO (`ParticipantPostDto`) should mirror
`ParticipantPostView` (`types/post.ts:104-112`) field-for-field; `02-post-write-api`'s
participant-caller response branch and `03-signalr-feed-host`'s broadcast payload both reuse this
same shape rather than re-deriving it. The frontend flip (removing `feedService.ts`'s/
`useThread.ts`'s `mockAdapter` branches) is **orchestrator-owned** — see implementation.md's
Integration seam table; this story's builder touches only `Pulse.WebApi/**` (+ its own xUnit
tests).

## Dependencies
Phase B0: `backend-host/01-webapi-host-bootstrap`, `backend-host/02-persistence-efcore`, and the
read-side exercise-scoping filter (`exercise-isolation/01`, extending `backend-host/02`'s
`PulseDbContext` on its **[Tier-2]** write-time guard). Soft, non-blocking relationship with `04-persona-read-api`: author
resolution (`authorPersonaId` → `Persona`) happens client-side via `assembleFeedView`'s `Map`
lookup, so this story does not need 04 to be live to ship.

## Tests
xUnit integration tests in the `Pulse.WebApi` test project (bootstrapped by `backend-host/01`)
covering: exercise-scoped feed contents; thread ancestry/focused/replies shape and depth;
cross-exercise `postId` returns 403/404 (added to the standing isolation suite,
`exercise-isolation/07`); response-body field absence for `origin`/`actingHumanId`/
`createdWallClock`/`injectId`; unresolvable-scope 401/403. A documented contract check: the
response, deserialized against the frozen TypeScript `isPost`/`isValidThreadResponse` guards,
passes without modification to either guard.
