# Story: 1:1 direct messages

**Feature:** Direct messages  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-060  ·  **Design decisions:** none  ·  **Issue:** #114

## Context
1:1 DMs between any accounts in the exercise; group DMs are a stretch (SOC-060). Two-pane layout
(conversation list + chat).

## Acceptance Criteria
- [ ] Any two accounts in the exercise can exchange 1:1 DMs (COR-001 scoped); the UI is a two-pane
      conversation list + chat with own messages accent-styled.
- [ ] Messages are sanitized (NFR-004), timestamped in scenario time (COR-053), and emit telemetry
      (XC-004).
- [ ] Org-grant holders can DM as their org account (COR-018 attribution, post-as-org).
- [ ] Observer/read-only mode: the DM composer is **absent** (D1-011); group DMs are out of scope
      (stretch).

## Out of Scope
Group DMs (stretch); specific use-case seeding (story 02); staff observability surface (story 03).

## Technical Notes
Participant world, two-pane. Reuses org identity (posts/06). See implementation.md (story 01).

## Dependencies
E1 isolation/session/COR-018; scenario-time; telemetry; sanitization.

## Tests
- Component (RTL): send/receive a 1:1 DM two-pane; observer sees no composer; org DM records acting human.
