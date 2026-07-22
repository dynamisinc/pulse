# Story: Like with count

**Feature:** Reactions  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-030  ·  **Design decisions:** none  ·  **Issue:** #104

## Context
The baseline reaction: like, with a count (SOC-030).

## Acceptance Criteria
- [x] A participant/persona can like/unlike a post; the like count updates and reflects their own state.
- [x] Likes emit telemetry (XC-004) and are exercise-scoped (COR-001).
- [x] The like control renders in the post action row (posts/02), participant-world styled; observer
      mode shows the count but the control is **absent** (D1-011).

## Out of Scope
Sentiment reactions (story 02); like notifications (notifications SOC-070).

## Technical Notes
Participant world. Like toggle + count on `<PostCard>`. See implementation.md (story 01).

## Dependencies
posts (PostCard); telemetry (XC-004).

## Tests
- Unit/hook — `hooks/useReaction.test.ts`: `buildLikeTelemetryInput` assembles a well-formed XC-004
  `'reaction'` envelope (persona actor, `social` channel, participant origin, post target,
  `{reaction:'like', liked}` payload); `useReaction` seeds count/own-state and `toggleLike` moves the
  count ±1, flips `likedByViewer`, and emits exactly one `'reaction'` event per toggle stamped with the
  injected scenario instant, never wall-clock — covers AC1/AC2.
- Unit/hook — `hooks/useReaction.readonly.test.ts`: a read-only session reports `isReadOnly`/
  `canReact: false`, the count still renders, and a stray `toggleLike()` is a hard no-op (no state
  change, no telemetry) — covers AC3 (D1-011).
- Unit/hook — `hooks/useReaction.noPersona.test.ts`: a session with no bound persona also cannot react
  (a distinct guard from observer mode) — regression coverage adjacent to AC1/AC3.
- Component (RTL) — `pages/Feed.actions.test.tsx` ("Feed — like wiring (SOC-030)"): end-to-end proof
  the hook is wired into the LIVE action row — clicking Like on the top feed card updates its rendered
  count immediately and emits one `reaction` telemetry event targeting that post; clicking again
  unlikes and drops the count with a second event; under a read-only session no like control renders
  at all — covers AC1/AC2/AC3 against the integrated `<Feed>`, not just the hook in isolation.
