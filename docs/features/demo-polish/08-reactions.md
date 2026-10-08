# Story: Reactions (like, repost) and the engagement reader

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** SOC-030, SOC-020 (repost toggle only), SOC-021, XC-004, COR-001, COR-015  ·  **Design decisions:** DP-10 (implementation.md §0)  ·  **Issue:** #427
**Story ID:** B3  ·  **Stack:** backend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 1b  ·  **Review:** Tier-2 (Tom — reaction isolation)
**Home stories:** [`reactions/01`](../reactions/01-like.md), [`amplification/01`](../amplification/01-repost-quote.md) (repost as a toggle; quote is cut).

## Context
**As** a participant, **I want** my likes and reposts to persist and the counts to be real, **so that** counts
respond to clicks and survive a refresh. Today a like is an optimistic local toggle plus a telemetry event; it
resets on refresh and the live counts are hard-coded `0,0,0`. This story adds the persisted reaction endpoints
and the `IPostEngagementReader` that BP's projector consumes. Model the write on
`Features/Social/Follows/FollowService.cs` + `FollowEndpoints.cs` (idempotent, one event per state change, race
fold). Wire shapes: implementation.md §1.5.4.

## Acceptance Criteria
- [ ] **Idempotent endpoints.** `PUT /api/posts/{postId:guid}/reactions/{kind}` creates and `DELETE …`
      **soft-deletes** (sets `DeletedAt`, DP-15; never a hard delete, XC-010) the active reaction of the **session-bound persona** (never a body or route persona); `kind ∈ like|repost` else
      400. Repeating either call returns 200 with the same state, creates no second row and emits **no second
      telemetry event**. The response is `ReactionStateDto` (`active`, post-change `counts` = baseline + real,
      `viewer {liked, reposted}`).
- [ ] **Race-safe.** The unique `(PostId, PersonaId, Kind)` index backstops a concurrent double-submit: the
      loser folds to 200 (not 500) and its telemetry event is discarded, exactly as `FollowService` does.
- [ ] **Engagement reader.** `PostEngagementReader : IPostEngagementReader` returns real like/repost counts,
      non-deleted direct-reply counts and the viewer's own state for a set of post ids in one batched read per
      kind (no N+1); ids outside the current exercise are simply absent from the result; with `viewerPersonaId
      == null` the viewer flags are false.
- [ ] **Isolation (always-Critical, COR-001).** A reaction on a post in another exercise returns the same 404 as
      an unknown id and writes nothing; a persona from another exercise cannot react; the reader never returns
      another exercise's rows. The standing isolation suite is extended (new file).
- [ ] **Authorization.** Only a session of kind `participant` with a bound persona may react — a positive
      allowlist on the kind, as `PostAttributionResolver` does, because a staff session can carry a persona
      binding too (staff and persona-less sessions → 403, DP-10); a shared read-only session → 403 via
      `DenyReadOnlySessions()`; a soft-deleted post → 404; anonymous → 401.
- [ ] **Telemetry (XC-004).** Exactly one server-side event per state change — `reaction` (`payload
      {reaction:'like', liked}`) or `repost` (`payload {reposted}`) — with the persona actor, the acting human,
      the target post and **scenario time from the exercise clock** (`FollowService` pattern); wall-clock is
      staff/telemetry-only.

## Out of Scope
Quote posts, the "X reposted" feed fan-out, sentiment reactions (SOC-031), notification generation, who-liked
lists, controller reactions (DP-10), rate limiting of reactions (NFR-009 is upload-only this push).

## Technical Notes
- Participant API; no UI. Files: implementation.md §4.1 row B3. Implements the frozen `IPostEngagementReader`
  (do not edit it). Ships `AddSocialReactions()` + `MapSocialReactionEndpoints()` for the orchestrator to wire
  **inside** the `MapGroup(string.Empty).DenyReadOnlySessions()` group in `Program.cs`. `/api/posts` is already
  in `ExerciseLifecycleGatedRoutes` by prefix.
- Reuse `ICurrentSessionPersonaAccessor` for the persona; resolve the post through the scoped `Posts` set (LINQ
  predicate, not `Find`) so the central filter is the access check.
- Counts the endpoint returns must equal what the next `GET /api/feed` returns for the same post (both go
  through the same reader + baseline).

## Dependencies
B1. Runs with BM, BP, B2, B6. BP consumes the reader at Gate 2; F3 depends on this for its live check.

## Tests
- **Isolation (first):** `Features/Social/Reactions/ReactionIsolationTests.cs` — cross-exercise post and
  persona, unresolved scope, reader scoping (real SQL).
- Soft delete (DP-15): DELETE sets `DeletedAt` and leaves the row; re-like after un-like inserts a new active row; counts and `viewer` ignore soft-deleted rows.
- Idempotency + single-event-per-change (PUT twice, DELETE twice), concurrent double-submit fold, authorization
  matrix (participant / staff / persona-less / read-only / anonymous / deleted post).
- Reader: counts, viewer flags, batch (query count asserted), out-of-scope ids absent.
- Telemetry: event type, payload, actor, scenario time is the clock's (not wall-clock).
- `ReactionCompositionRootWiringTests.cs` (route answers 401 unauthenticated, not 404).
