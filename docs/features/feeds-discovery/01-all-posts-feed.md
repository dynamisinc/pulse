# Story: All Posts feed (global chronological)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-080  ·  **Design decisions:** none  ·  **Issue:** #120

## Context
The All Posts feed (global): every public post in the exercise, chronological. Default view for PIO-role
accounts (SOC-080) — the firehose a PIO monitors.

## Acceptance Criteria
- [ ] The All Posts feed lists every public post in the exercise in chronological order (COR-001 scoped),
      rendered with `<PostCard>` in scenario time (COR-053).
- [ ] It is the default landing feed for PIO-role accounts and for read-only sessions (COR-015).
- [ ] The feed stays smooth and legible under burst (NFR-002/SOC-071) via virtualization; real-time
      updates arrive per story 04 (pill, not auto-scroll).
- [ ] Participant-world styled (Pulse skin, left-anchored per D1-013); no COBRA/default MUI.

## Out of Scope
Following feed (story 02); search (story 03); real-time pill (story 04); "For You" (story 05); PIO
columns (story 06).

## Technical Notes
Participant world. Virtualized chronological list over `<PostCard>`. See implementation.md (story 01).

## Dependencies
posts (PostCard); E1 isolation/scenario-time; story 04 (real-time).

## Tests
- Component (RTL): All Posts renders chronologically, exercise-scoped; PIO + read-only default here.
