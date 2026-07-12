# Story: Full-text search (+ People / impersonation)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-082  ·  **Design decisions:** D1-008  ·  **Issue:** #122

## Context
Full-text search across posts, hashtags, and accounts (exercise-scoped), with recency/top sort — the
PIO workflow for finding the first mention of a rumor (SOC-082). Per D1, search results include a
**People** section that shows the impersonation pair **side-by-side** (@FairhavenWater verified vs
@FairhavenWaterUpd unmarked) — the platform never flags the fake (D1-008).

## Acceptance Criteria
- [ ] Search returns posts, hashtags, and accounts matching a query, exercise-scoped (COR-001), with
      **Top** and **Recent** sort tabs.
- [ ] A **People** section lists matching accounts, rendering verified/unverified honestly — an
      impersonation pair appears side-by-side with no platform warning (D1-008, SOC-052).
- [ ] Search of a rumor hashtag surfaces its first/earliest mentions (the PIO "find first mention"
      workflow) via Recent sort.
- [ ] Results render in scenario time (COR-053), participant-world styled.

## Out of Scope
Verification rules (profiles SOC-052); trending (hashtags-trending); the controller takedown of an
imposter (E7 CTL-025).

## Technical Notes
Participant world. Exercise-scoped full-text index; People uses `<VerifiedMark>`. See implementation.md
(story 03).

## Dependencies
posts, hashtags-trending, profiles (verified mark); E1 isolation.

## Tests
- Component (RTL): search returns posts/accounts scoped with Top/Recent; People shows the impersonation
  pair unflagged.
