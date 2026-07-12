# Feature: Exercise clock & scenario-time model

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.6
**World:** platform/foundation  ·  **Issue:** #43

## Summary
Pulse owns a **native exercise clock from Phase 1** — not an E9/Cadence dependency. It provides
scenario time to every subsystem (E8 inaction timers, scheduled content, the weather timeline,
StartEx), supports discrete Director time-jumps and overnight/TTX advancement, makes scenario time the
only time participants see, and defines EndEx. When Cadence is linked (Phase 4), its clock becomes the
provider behind the same interface.

## Requirements covered
COR-050, COR-051, COR-052, COR-053, COR-054 (with XC-008 time zone, and consumed cross-cuttingly by
E7 CTL-015/023, E8 ADP-001, and every participant surface).

## Design references
Master decision 12 (discrete jumps + suspension only; no continuous compression). Consumes the
exercise time zone (exercise-configuration COR-030).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Native exercise clock (provider interface) | COR-050 | Not Started | #77 |
| 02 | Discrete Director time-jumps | COR-051 | Not Started | #78 |
| 03 | Suspension & module advancement (TTX) | COR-052 | Not Started | #79 |
| 04 | Scenario time is the participant-visible time | COR-053 | Not Started | #80 |
| 05 | EndEx | COR-054 | Not Started | #81 |

## Dependencies
exercise-configuration (time zone COR-030, lifecycle COR-032); consumed by exercise-build-golive
(StartEx), E7 (CTL-015 jump, CTL-023 freeze), E8 (scenario-time timers), and every channel
(scenario-time rendering). Backend not present yet.

## Design notes
Foundation. **Providers are swappable** (native now; Cadence-linked in Phase 4) behind one interface
(COR-050). **Continuous clock compression is explicitly out of scope** (Master decision 12) — only
discrete jumps + suspension. Scenario time is the sole participant-visible time (COR-053); wall-clock
is telemetry-only.
