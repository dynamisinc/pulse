# Story: Post provenance & telemetry

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-003 (XC-004, COR-018, COR-053)  ·  **Design decisions:** R-003 (staff-side display)  ·  **Issue:** #94

## Context
Every post records: author persona/participant (including the **individual human** behind a shared org
account, COR-018), created wall-clock time, exercise scenario time (from the native clock, COR-050),
and origin (participant / controller-as-persona / adaptive engine / fired inject). **Origin is never
participant-visible** — but it is deliberately **staff-visible**: the console renders it as an
always-visible origin line on every post card (R-003, live-monitoring/01). Participant-visible
timestamps render in **scenario time** (SOC-003, COR-053).

## Acceptance Criteria
- [ ] Every post persists author, **acting human** (COR-018), created wall-clock time, scenario time,
      and origin (participant / controller-as-persona / engine / inject).
- [ ] The persisted provenance is rich enough to drive the console's R-003 origin line without
      inference: the origin enum maps to the console vocabulary (**ENGINE · AUTO** /
      **SIMCELL-n · MANUAL**), an inject-fired post stores its **MSEL inject id** (rendered
      **INJ-nnn**, matching the fired timeline item), and the fired time is the post's scenario
      timestamp.
- [ ] Origin is **never** exposed on any participant surface (XC-002) — a participant cannot tell a
      controller/engine post from a peer's.
- [ ] Participant-visible timestamps (absolute + "2h ago") render in **scenario time** in the exercise
      time zone (COR-053); wall-clock is telemetry-only.
- [ ] Each post creation emits an XC-004 telemetry event carrying these fields, feeding E10.

## Out of Scope
Composition UI (story 01); rendering (story 02); the amplification-chain reconstruction (amplification
SOC-022); the telemetry schema definition itself (E1 XC-004 v0).

## Technical Notes
Participant world render + backend provenance. Consumes the scenario-time utility (COR-053) and the
telemetry emitter (XC-004). See implementation.md (story 03).

## Dependencies
E1 exercise-clock (COR-050/053), telemetry (XC-004), identity-auth-roles (COR-018). Underpins E10
metrics + E7 monitoring.

## Tests
- Unit: a post records author + acting-human + dual time + origin; origin never serializes to a
  participant payload; timestamps format in scenario time.
