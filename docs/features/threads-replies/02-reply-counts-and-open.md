# Story: Reply counts & thread open

**Feature:** Threads & replies  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-011  ·  **Design decisions:** none  ·  **Issue:** #99

## Context
Reply counts display on posts; tapping a post (or its reply affordance) opens the thread (SOC-011).

## Acceptance Criteria
- [ ] A post card shows its reply count in the action row (posts/02).
- [ ] Tapping the post (or reply count) opens the flattened thread (story 01) focused on that post.
- [ ] Reply counts update as replies are added (real-time consistent with feed updates, feeds-discovery).
- [ ] Keyboard/screen-reader operable (NFR-001).

## Out of Scope
Thread rendering (story 01); the reply composer (posts SOC-001).

## Technical Notes
Participant world. Count on PostCard; navigation to the thread route. See implementation.md (story 02).

## Dependencies
posts (PostCard), story 01 (thread view).

## Tests
- Component (RTL): reply count renders and tapping opens the focused thread.
