# Story: Audience magnitude & follower affordance

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-054  ·  **Design decisions:** D1-012  ·  **Issue:** #113

## Context
Every account has an **audience magnitude** (from the E1 template band, evolving with activity)
distinct from the real follow graph. Displayed follower **count** = audience magnitude + real edges.
Follower **lists** render real edges plus a "…and ~48.2K others" affordance — **never a fabricated
scrollable list** (SOC-054, D1-012). Reach/impressions (E10 EVL-012) and amplification velocity (E8
ADP-004) are defined as functions of magnitude — the formula lives here and is shared.

## Acceptance Criteria
- [ ] A profile's displayed follower **count** = audience magnitude (magnitude-formatted, e.g. "48.2K")
      + real edges.
- [ ] Expanding Followers lists the **real edges**, then an italic **"…and ~48.2K others"** — never a
      fabricated scrollable list (D1-012).
- [ ] Audience magnitude is defined (band from E1 COR-020/SOC-054, evolving with activity) and this
      story owns the **reach/velocity formula** consumed by E8 (ADP-004) and E10 (EVL-012).
- [ ] Counts are exercise-scoped (COR-001).

## Out of Scope
The E10 reach metric UI (E10); E8 amplification behavior (E8 ADP-004); the follow action (story 02).

## Technical Notes
Participant world display + a shared magnitude/reach formula module (the single source E8/E10 import).
See implementation.md (story 05).

## Dependencies
E1 audience-magnitude band (COR-020); story 02 (real edges). Shared by E8 (ADP-004) + E10 (EVL-012).

## Tests
- Unit: count = magnitude + edges; reach/velocity formula; follower list shows edges + "…and ~N
  others", never fabricated rows.
