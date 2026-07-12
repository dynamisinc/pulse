# Story: Platform-alert notifications (RIP-Alerts)

**Feature:** Notifications  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-072  ·  **Design decisions:** D1-004 (PRT-010 preview)  ·  **Issue:** #119

## Context
Notifications absorb the RIP-Alerts role together with E3's portal alert bar: high-priority official
broadcasts can be pushed as **platform-wide notifications** when a controller flags an inject as an
alert. **In pilot mode (pre-E3) this is the sole alert delivery path** (SOC-072, Master §4). The D1
mockup previews the PRT-010 in-app advisory bar (an E3/Phase-3 surface).

## Acceptance Criteria
- [ ] When a controller flags content as a platform alert (E7 CTL-021), it delivers as a platform-wide
      notification to exercise participants (SOC-072).
- [ ] In pilot mode this is the **sole** high-priority alert path (the portal alert bar PRT-010 is E3);
      the notification severity is conveyed by text+icon, not color alone (NFR-001).
- [ ] Alert delivery is exercise-scoped (COR-001), logged (XC-004), and nothing marks it as
      controller-originated to participants (XC-002).
- [ ] The D1 advisory-bar (PRT-010) preview is tracked under E3 — this story delivers the SOC-072
      notification path only.

## Out of Scope
The portal alert bar itself (E3 PRT-010, Phase 3); the E7 flag-as-alert control (world-steering CTL-021).

## Technical Notes
Participant world. A high-priority notification class pushed by the E7 alert flag. See implementation.md
(story 03).

## Dependencies
story 01 (center); E7 CTL-021 (flag-as-alert); E3 PRT-010 succeeds it in Phase 3.

## Tests
- Integration: an E7 alert flag pushes a platform-wide notification; severity is text+icon; scoped +
  logged.
