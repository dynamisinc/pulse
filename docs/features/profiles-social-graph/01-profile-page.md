# Story: Profile page

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-050  ·  **Design decisions:** none  ·  **Issue:** #109

## Context
A profile page per persona/participant: banner, avatar, bio, join date, follower/following counts, and
tabs for Posts / Posts & replies / Media / Likes (SOC-050).

## Acceptance Criteria
- [ ] A profile renders banner, avatar (interim R-004 treatment: duotone silhouette for humans,
      monogram for orgs, until COR-024), display name + verified mark when applicable (story 03),
      handle, bio, meta row (location/link/joined), and follower/following counts (magnitude, story 05).
- [ ] Tabs show Posts / Posts & replies / Media / Likes, each exercise-scoped (COR-001).
- [ ] Join date and post timestamps render in scenario time (COR-053); backdated history (E1 COR-023)
      renders correctly.
- [ ] Participant-world styled (Pulse skin, accent-tinted banner per COR-030); no COBRA/default MUI.

## Out of Scope
Follow button behavior (story 02); verification rules (story 03); magnitude math (story 05); suggested
follows (story 04).

## Technical Notes
Participant world. Reuses `<PostCard>` for the tabs. Accent-tinted banner uses `--pulse-ac`. See
implementation.md (story 01).

## Dependencies
posts (PostCard); scenario-time (COR-053); persona/participant model.

## Tests
- Component (RTL): profile renders identity + tabs; timestamps in scenario time.
