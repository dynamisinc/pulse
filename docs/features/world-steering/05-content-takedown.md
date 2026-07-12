# Story: Content takedown (≤2 clicks, tombstone, incident category)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-025  ·  **Design decisions:** none  ·  **Issue:** #28

## Context
Real exercises hit this roughly every time: a participant posts something that has to come down *now*
(a real phone number, PII, a real-world reference, something inappropriate). Controllers can remove
any content in the exercise in **≤2 clicks**: it tombstones in-fiction ("post unavailable"), is tagged
with an incident category, optionally notifies the Director, and is retained staff-only for the record
— never re-rendered in participant surfaces, including replay (CTL-025, XC-010).

## Acceptance Criteria
- [ ] Given any content in the exercise (participant or world), when the controller takes it down,
      then within ≤2 clicks it is removed and shows an in-fiction **tombstone** ("post unavailable")
      in threads, mirroring real platforms.
- [ ] The takedown captures an **incident category** (inappropriate / PII / real-world reference /
      other) and offers a one-click **notify Director**.
- [ ] Removed content is **soft-deleted** and retained staff-only for the record (XC-010); it is
      **never** re-rendered in any participant surface, **including replay**.
- [ ] The takedown is logged (XC-004) with actor, category, scenario time; it is staff-only (XC-002)
      and exercise-scoped (COR-001).
- [ ] The action is keyboard-operable and the tombstone is accessible (NFR-001).

## Out of Scope
Participant self-delete (E2 SOC-005); Break Fiction (story 04); the AAR review UI (E10) — takedown
writes the record, it doesn't render the AAR.

## Technical Notes
Staff world (COBRA). Reuses E2 soft-delete/tombstone (SOC-005, XC-010) with a staff takedown reason +
category; replay (E10) must honor the takedown filter. See implementation.md (story 05).

## Dependencies
E2 soft-delete/tombstone (SOC-005, XC-010); E1 roles; E10 replay must exclude taken-down content;
telemetry emitter.

## Tests
- Unit: takedown soft-deletes, tags a category, and logs actor + scenario time.
- Unit: taken-down content is excluded from participant queries and from replay.
- Component (RTL): the in-fiction tombstone renders in the thread.
