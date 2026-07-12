# Story: Soft delete & tombstones (thread-only)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-005 (XC-010, CTL-025)  ·  **Design decisions:** D1-009  ·  **Issue:** #96

## Context
Participants can delete their own posts (**soft delete**, retained for AAR per XC-010). Per the D1
design, a deleted post shows a **"post unavailable" tombstone in threads only — feeds silently omit
it**, matching real platforms (SOC-005, D1-009). Controller takedowns (CTL-025) reuse the same
tombstone mechanism.

## Acceptance Criteria
- [ ] A participant can delete their own post; the delete is **soft** (retained staff-only for AAR,
      XC-010) — never hard-deleted during a live exercise.
- [ ] A deleted/removed post shows a **"This post is unavailable." tombstone inside threads** where a
      reply/ancestor was removed; **feeds show no tombstone** — the post simply vanishes from feeds
      (D1-009).
- [ ] Removed content is never re-rendered in participant surfaces, including replay (XC-010, CTL-025).
- [ ] Controller takedown (E7 CTL-025) uses this same tombstone/soft-delete path.

## Out of Scope
The controller takedown UI + incident tagging (E7 world-steering CTL-025); edit-with-history (out at
launch, E2 open question 3); feed rendering internals (feeds-discovery).

## Technical Notes
Participant world. Tombstone is a thread-context render; feeds filter removed posts out. Shared with
CTL-025. See implementation.md (story 05).

## Dependencies
Threads (threads-replies) for tombstone context; feeds-discovery for the silent-omit; E7 CTL-025
(shared path); XC-010 soft delete.

## Tests
- Unit: delete soft-deletes + retains; a removed post is omitted from feeds and tombstoned in a thread;
  excluded from replay.
