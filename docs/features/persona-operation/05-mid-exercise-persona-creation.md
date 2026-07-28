# Story: Mid-exercise persona creation from the picker

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-005, COR-022  ·  **Design decisions:** none  ·  **Issue:** #18

## Context
Participants do the unexpected, and the controller needs a voice for it *now*. A "+ New persona"
action in the picker spins up a usable persona in **≤60 seconds** (COR-022): name, handle, type,
avatar pick — created live in the active exercise and immediately selectable to post from (CTL-005).

## Acceptance Criteria
- [ ] Given the persona picker, when the controller chooses "+ New persona", then a quick-create
      dialog captures name, handle, persona type, and an avatar (from the bundled library or upload)
      and nothing else is required to start posting.
- [ ] On save, the new persona exists in the **active exercise** (COR-001/003), appears in the
      picker, and can be set active and posted from immediately (story 01).
- [ ] Handle validation enforces per-exercise uniqueness (§7 Q3, **resolved**: per-exercise,
      case-insensitive — so `MVega_FH` collides with an existing `mvega_fh` and the message must say so) and
      surfaces a clear, keyboard-accessible error (NFR-001). The database already refuses the duplicate
      (`IX_Personas_ExerciseId_Handle`, `backend-host/03`); this AC is about catching it before the write so
      the controller sees a friendly error, not a 500.
- [ ] The create action is captured in telemetry/audit as a controller action (XC-004) and is never
      visible to participants (XC-002).
- [ ] The whole path is achievable in ≤60s for a practiced controller (COR-022) — minimal fields, no
      forced template assembly.

## Out of Scope
Full persona-template authoring, casts, backdated history, voice-note depth (E1 persona management
COR-020/021/023) — quick-create is intentionally minimal; a mid-exercise persona can be enriched
later via E1.

## Technical Notes
Staff world (COBRA). Quick-create writes a Persona (not a reusable PersonaTemplate) in the active
exercise. Avatar picker reuses the E1 bundled avatar library (COR-024). See implementation.md
(story 05).

## Dependencies
E1 persona create + avatar library (COR-022/024); story 02 (picker). Feeds story 01.

## Tests
- Component (RTL): quick-create adds a persona to the picker and it becomes postable.
- Unit: per-exercise handle-uniqueness validation rejects a duplicate handle.
- Unit: a create emits a controller-action telemetry event.
