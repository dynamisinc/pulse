# Story: Flattened thread view

**Feature:** Threads & replies  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-010  ·  **Design decisions:** D1-006  ·  **Issue:** #98

## Context
Replies form branching threads of unlimited depth. Per D1-006 (open question 1 settled), the thread
renders **X-style flattened**: ancestry chain above the focused post (enlarged), replies below with
"Replying to @handle" lines. Nested/indented was built, reviewed, and rejected (truncates past ~3
levels on real content).

## Acceptance Criteria
- [ ] A thread renders **flattened**: ancestor post(s) → focused post (enlarged, with stat row) →
      replies, each reply labelled "Replying to @handle" (D1-006).
- [ ] Threads support unlimited reply depth without nested indentation.
- [ ] A taken-down reply renders a "This post is unavailable." tombstone **in the thread** (posts
      SOC-005 / D1-009).
- [ ] Timestamps render in scenario time (COR-053); the view is participant-world styled (Pulse skin,
      no COBRA/default MUI).

## Out of Scope
Reply composition (posts composer, SOC-001); reply counts on feed cards (story 02); nested layout
(rejected).

## Technical Notes
Participant world. Reuses `<PostCard>` (posts/02) + `<Tombstone>` (posts/05). Flattened is the only
layout. See implementation.md (story 01).

## Dependencies
posts (PostCard, Tombstone), scenario-time (COR-053).

## Tests
- Component (RTL): a thread renders ancestry→focused→replies flattened with "Replying to" lines; a
  removed reply shows the in-thread tombstone.
