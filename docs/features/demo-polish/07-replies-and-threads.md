# Story: Replies and real threads

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** SOC-010, SOC-011, SOC-012, SOC-005, COR-001, XC-010  ·  **Design decisions:** D1-006 (flattened), D1-009 (tombstones in threads only)  ·  **Issue:** #426
**Story ID:** B2  ·  **Stack:** backend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 1b
**Home stories:** [`threads-replies/01`](../threads-replies/01-flattened-thread-view.md), [`/02`](../threads-replies/02-reply-counts-and-open.md), [`/03`](../threads-replies/03-persona-participant-replies.md).

## Context
**As** a participant (or a controller replying as a persona), **I want** replies to be real and to show up in
the thread, **so that** "citizen personas pile on" and "the PIO sees the reply" work live. Today `Post` has no
parent and `GET /api/threads/{id}` always returns empty ancestors and replies (`ThreadEndpoints.cs`). This story
supplies the **reply-parent resolver** that BP's ingest calls (frozen seam `IReplyParentResolver`, DP-8) and the
**real thread read**. Wire shapes: implementation.md §1.5.3.

## Acceptance Criteria
- [ ] **Resolver is scope-bound and non-disclosing.** `ReplyParentResolver : IReplyParentResolver` returns
      `None` for a null/empty id, `Resolved` only for a post in the **current exercise** that is not
      soft-deleted, and `NotFound` for unparseable, unknown, cross-exercise and soft-deleted ids —
      indistinguishable from each other (no existence oracle).
- [ ] **Real thread read.** Given a focused post, `GET /api/threads/{id}` returns `ancestors` (root → parent,
      oldest first, depth capped at 50, soft-deleted ancestors omitted), `focused`, and `replies` (direct
      children, oldest first), each projected through `IParticipantPostProjector` (media, counts, `inReplyTo`,
      `viewer`); replies add `replyToPersonaId` and `status`.
- [ ] **Tombstones in threads only (D1-009).** A soft-deleted *reply* appears with `status: 'taken-down'`,
      `text: ''`, no `media`, zero counts (its content never leaves the server); feeds omit it silently. A
      soft-deleted, missing, unparseable or cross-exercise **focused** id returns the existing byte-identical `{
      ancestors: [], focused: null, replies: [] }`.
- [ ] **Reply counts are real.** `counts.reply` on any post = baseline + non-deleted direct replies (via the
      engagement reader), so opening a post whose reply count is N shows N visible replies when the baseline is
      0, and a takedown decrements it.
- [ ] **Isolation (always-Critical, COR-001/XC-001).** A thread id, a reply parent or an ancestor chain that
      crosses into another exercise never resolves: exercise B's session gets the byte-identical not-found for
      A's post, and cannot reply to it (resolver `NotFound`).
- [ ] **Thread shape parity.** `ThreadReplyDto : ParticipantPostDto` serializes every participant field plus
      `replyToPersonaId` and `status`; a test asserts JSON-property parity with `ParticipantPostDto` so drift
      fails CI. The response always satisfies the frozen client guard (`isValidThreadResponse`).

## Out of Scope
Writing the reply (BP's ingest calls the resolver); quote/repost threading; nested/indented rendering (flattened
only); thread pagination (≤ 200 replies assumed); participant self-delete; telemetry (the post path emits the
`reply` event).

## Technical Notes
- Participant API; no UI. Files: implementation.md §4.1 row B2. Implements the frozen `IReplyParentResolver` (do
  not edit it). Ships `AddSocialThreads()` for the orchestrator to wire in `Program.cs` **before** the first
  reply is posted (BP rejects a non-empty `parentPostId` if no resolver is registered).
- Keep `ThreadEndpoints` raw-string route (`{postId}` not `:guid`) so an unparseable id takes the not-found path
  rather than a framework 404 — that is the Tier-2 isolation guarantee already in the file. Ancestor walk:
  iterative, with a visited-set and depth cap (a malformed cycle must not loop).
- The end-to-end "POST reply → thread read → feed excludes it" test (`ReplyFlowTests.cs`) is authored here but
  only goes green at **Gate 2**, after BP merges (it needs BP's ingest); B2's Gate 1 covers the resolver and the
  thread read against rows written directly through `PulseDbContext`.

## Dependencies
B1. Runs with BM, BP, B3, B6. Consumed by BP (resolver), F4 and C1 (live checks).

## Tests
- **Isolation (first):** `Features/Social/Threads/ThreadReplyIsolationTests.cs` — cross-exercise
  focused/parent/ancestor all take the not-found path and are byte-identical to an unknown id; extend coverage
  alongside `FeedThreadIsolationTests` by adding a new file (do not edit it).
- Resolver matrix (None / Resolved / NotFound ×4), ancestor ordering + depth cap + cycle guard, reply ordering
  oldest-first, tombstone content blanking, reply-count correctness incl. after a soft delete.
- `ThreadReplyDtoShapeTests` (property parity) and the updated `ThreadReadEndpointTests.cs`.
- Scenario time: ordering is by `CreatedScenarioTime`, never wall-clock.
