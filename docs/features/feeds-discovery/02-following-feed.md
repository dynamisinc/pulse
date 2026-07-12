# Story: Following feed

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-081 (COR-015)  ·  **Design decisions:** none  ·  **Issue:** #121

## Context
The Following feed: posts from followed accounts. Default for citizen-role participants **with named
accounts**; read-only sessions (COR-015) default to All Posts (they cannot follow, so Following would be
empty). The gap between "official message sent" and "what a citizen who didn't follow the agency sees"
is the teaching moment (SOC-081).

## Acceptance Criteria
- [ ] The Following feed shows posts from accounts the user follows (profiles SOC-051), chronological,
      exercise-scoped (COR-001), scenario time (COR-053).
- [ ] It is the default for citizen-role participants with named accounts; **read-only sessions default
      to All Posts** (COR-015), never the empty Following feed.
- [ ] All Posts / Following are tabs with an accent underline (D1); switching preserves scroll per feed.
- [ ] Real-time updates arrive per story 04 (pill).

## Out of Scope
The follow mechanic (profiles SOC-051); All Posts (story 01); real-time pill (story 04).

## Technical Notes
Participant world. Following feed filters by the user's follow edges. See implementation.md (story 02).

## Dependencies
profiles-social-graph (follow edges); story 01 (feed infra); COR-015 (read-only default).

## Tests
- Component (RTL): Following shows only followed accounts; a read-only session lands on All Posts.
