# Story: Like with count

**Feature:** Reactions  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-030  ·  **Design decisions:** none  ·  **Issue:** #104

## Context
The baseline reaction: like, with a count (SOC-030).

## Acceptance Criteria
- [ ] A participant/persona can like/unlike a post; the like count updates and reflects their own state.
- [ ] Likes emit telemetry (XC-004) and are exercise-scoped (COR-001).
- [ ] The like control renders in the post action row (posts/02), participant-world styled; observer
      mode shows the count but the control is **absent** (D1-011).

## Out of Scope
Sentiment reactions (story 02); like notifications (notifications SOC-070).

## Technical Notes
Participant world. Like toggle + count on `<PostCard>`. See implementation.md (story 01).

## Dependencies
posts (PostCard); telemetry (XC-004).

## Tests
- Component (RTL): like/unlike updates count + own state; observer sees inert count, no control.
