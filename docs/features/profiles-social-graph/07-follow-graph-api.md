# Story: Follow graph (backend)

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-051, SOC-054, SOC-081, COR-001, XC-004  ·  **Design decisions:** none  ·  **Issue:** _TBD — mirrored after authoring_
**Stack:** backend

## Context
There is **no follow edge anywhere in the backend today** — no entity, no table, no endpoint
(verified by grep across `src/Pulse.WebApi`). Three frontend stories sit directly on this gap:
`02-follow-unfollow` ("A participant can follow/unfollow any account in their exercise"),
`04-who-to-follow`, and the real-edge half of `05-audience-magnitude`'s displayed count
(`count = magnitude + real edges`, story 06 supplies the magnitude half). Building any of the three
frontend-only, against a mock adapter, would ship another unit-green seam that does nothing in UAT
— the same failure mode already recorded for other Phase-1 controller features (pause / dial /
live AI shipped "Complete" while unwired to anything live). This story is the write/read seam those
three stories, and `feeds-discovery/02`'s Following feed (SOC-081, "posts from followed accounts...
default for citizen-role participants with named accounts"; tracked as feeds-discovery #121),
actually build against.

## Acceptance Criteria
- [ ] **Entity + isolation.** A `Follow` entity implementing `IExerciseScoped` records a directed
      edge (follower persona → followee persona) with a unique index on `(ExerciseId,
      FollowerPersonaId, FolloweePersonaId)` so following the same account twice is the same row,
      not a duplicate. An EF Core migration adds the table. Isolation is **inherited** from
      `PulseDbContext`'s central query filter + write-guard exactly like every other
      `IExerciseScoped` entity — this slice never applies its own `exerciseId` filter and never
      accepts one from a client (COR-001); the exercise scope comes only from the resolved request
      context, the same posture `PersonaEndpoints`/`FeedEndpoints` already use.
- [ ] **Follow / unfollow endpoints.** `POST /api/personas/{id}/follow` and `DELETE
      /api/personas/{id}/follow` create/remove the edge for the caller's session-bound persona
      (the follower). Both are idempotent — following an already-followed persona, or unfollowing an
      already-unfollowed one, succeeds without erroring. Both are refused for a read-only session
      via the existing `ReadOnlySessionWriteFilter` (COR-015, D1-011) — the same gate `POST /posts`
      is denied through.
- [ ] **Displayed counts.** A persona's follower/following counts are servable such that the
      **displayed follower count** = `AudienceMagnitude` (story 06) + real inbound `Follow` edges,
      and the **following count** = real outbound edges only (magnitude never inflates a following
      count — SOC-054's magnitude is a follower-side construct only). State in Technical Notes
      exactly which response seam was chosen — extending `PersonaResponseDto`/`GET /api/personas`
      with the composed counts, vs. a dedicated `GET /api/personas/{id}/follow-summary` (or
      equivalent) endpoint — and why.
- [ ] **Following read + feed scoping.** The caller can read which personas their session-bound
      persona follows (the set `04-who-to-follow` needs to exclude already-followed accounts from
      its suggestions, and `05-audience-magnitude`'s follower **list** needs the inverse — real
      followers of a given persona). The feed read supports a following-scoped variant (e.g. `GET
      /api/feed?scope=following`, or an equivalent explicitly named in Technical Notes) so
      `feeds-discovery/02`'s Following feed can consume it without a second, client-composed round
      trip against the full feed.
- [ ] **Telemetry (XC-004).** Follow and unfollow each emit exactly one XC-004 event server-side
      against the locked v0 envelope — scenario-time stamped, exercise scope and actor
      (`actor.kind: 'persona'`, the follower persona id, `actingHumanId` the authenticated human
      behind the session) stamped **server-side**, never accepted as client-supplied fields, mirroring
      `POST /posts`'s existing server-stamping posture.
- [ ] **Cross-exercise isolation (always-Critical, COR-001).** A persona in exercise A can never be
      followed by a persona in exercise B, and never appears in exercise B's follow graph in either
      direction — a follow request naming a followee id that resolves to a *different* exercise's
      persona is rejected, not silently a no-op that looks like success. Add this to the standing
      isolation suite (`exercise-isolation/07`).
  - [ ] **Composition-root wiring (regression class, not a one-off check).** The new `Add*`/`Map*`
      calls are verified reached from `Program.cs` on the real, fully-wired host — not only a
      self-mapped `TestServer` built by this story's own test project — mirroring
      `CompositionRootWiringTests`'s existing pattern (`identity-auth-roles/10`'s
      `ProgramCs_MapsTheBindParticipantPersonaEndpointExactlyOnce`). A slice has merged fully green
      here before with its wiring never executed (#310→#317, dead at 404); this story does not repeat
      that failure mode.

## Out of Scope
The Follow **button** and `useFollow` hook (story 02, frontend — that story's write path calls
these endpoints, it does not build them). The "Who to follow" suggestion **module** UI (story 04).
The Following **feed UI** itself (`feeds-discovery/02`) — this story only exposes the scoped read it
consumes. Suggestion seeding / controller-steered suggested follows (E7 CTL-021). The
`AudienceMagnitude` value itself and its derivation (story 06 — this story only adds the real-edge
half of the count, it does not touch magnitude). Session-required default-deny enforcement
(`identity-auth-roles/11`, Not Started, tracked separately as #359/#361) — this story's endpoints
follow whatever session-identity accessor pattern that work lands or is already in place at build
time; it does not itself close the platform-wide anonymous-access gap.

## Technical Notes
Backend/service work. New slice, likely `Pulse.WebApi/Features/Social/Follows/` (`FollowEndpoints.cs`,
`FollowService.cs`, `Data/Entities/Follow.cs`) mirroring the existing `Features/Social/` slice shape
(`PersonaEndpoints.cs`/`PostWriteEndpoints.cs`). Resolves the caller's own persona the same way
`POST /posts`'s participant path is meant to (session-bound `Account.PersonaId` →
`Session.PersonaId`) — per `identity-auth-roles/11`'s Technical Notes, `AuthenticatedSession`
does not yet carry `PersonaId`/`ActingHumanId` on its own, so this story needs the same
session-identity read that story documents (a small accessor re-resolving the presented session
against `PulseDbContext.Sessions`, following the `CurrentStaffSessionAccessor`/`ReadOnlySessionProbe`
pattern already established) — do not invent a third parallel mechanism; reuse or extend whichever
of the two exists by the time this story is built.

**Response seam decision (record here, do not re-litigate):** extend `PersonaResponseDto` with the
composed `followerCount`/`followingCount` (reads through `FollowService` at persona-read time)
rather than adding a second round trip — `GET /api/personas` is already the one unconditional,
non-role-branching persona read every consumer resolves against (`social-api/04`), and `05
-audience-magnitude`'s formula needs both figures wherever a profile is rendered, so composing
them at the same read point avoids a second network call the frontend would otherwise need to
sequence. A dedicated `GET /api/personas/{id}/follow-summary` remains an option if the composed
read proves too expensive at scale; not chosen here because nothing in Phase 1's scale profile
motivates it.

**Following-feed scope seam:** extend `GET /api/feed` with a `scope=following` query parameter
(`FeedEndpoints.cs`) that filters to posts authored by personas the caller's session-bound persona
follows, rather than a separate endpoint — mirrors the existing single-endpoint, parameterized shape
of the feed read and lets `feeds-discovery/02` add a query-string toggle instead of a second
integration. State clearly in the PR if a build finds a reason to diverge from this default.

Cross-reference `implementation.md`'s reuse map + Wave Plan (Wave 0, serial with story 06 — both
touch `Data/Migrations/**`, `PulseDbContextModelSnapshot.cs`, and `Program.cs`).

## Dependencies
`backend-host/02` (persistence/EF Core); `social-api/04` (`GET /api/personas`, extended here);
`social-api/01` (`GET /api/feed`, extended here for the following-scoped variant); story 06
(`AudienceMagnitude`, composed into the displayed follower count — migration-authoring order is
serial with this story, see `implementation.md`, but the code itself does not import story 06's
files). `identity-auth-roles/03`/`05` (session identity the follower resolves from). Unblocks:
profiles-social-graph stories 02, 04, 05 (frontend write/read paths); `feeds-discovery/02` (Following
feed, #121).

## Tests
xUnit, `src/Pulse.WebApi.Tests/Features/Social/Follows/`:
- Follow then unfollow round-trips the edge; following twice, or unfollowing when not following, is
  an idempotent success (no error, no duplicate row).
- A read-only session is refused on both `POST` and `DELETE` (`ReadOnlySessionWriteFilter`).
- A follow request naming a followee persona that belongs to a *different* exercise is rejected —
  a real two-exercise test (mirroring `identity-auth-roles/10`'s cross-exercise test pattern:
  positively assert the target persona exists in exercise B **and** that no edge is created in
  either exercise's graph), not merely an empty-result false pass.
- Displayed follower count = `AudienceMagnitude` + real inbound edge count; following count = real
  outbound edge count only (magnitude never contributes to the following side).
- Follow/unfollow each emit exactly one XC-004 event, scenario-time stamped, with
  exercise/actor/`actingHumanId` stamped server-side regardless of any client-supplied value.
- `GET /api/feed?scope=following` returns only posts authored by followed personas, exercise-scoped,
  and an empty follow list yields an empty (not error, not All-Posts-fallback) result.
- Composition-root wiring: the follow endpoints are reachable through the real `WebApplicationFactory
  <Program>` host, not only a self-mapped `TestServer` (extends the pattern `identity-auth-roles/10`'s
  `CompositionRootWiringTests` established).
