# Story: Persona list refreshes when the controller switches exercise

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-001 (no cross-exercise bleed in the UI), CTL persona operation  ·  **Decisions:** none new  ·  **Issue:** #542
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** Wave 3 session · **Branch:** `build/demo-feedback/24-persona-refresh` → `feature/demo-feedback-w4-polish`

## Context

After switching exercise in the console, the persona picker still lists the previous exercise's personas until a
reload. `PersonaPicker.tsx:180` reads `useStaffPersonas()` (`features/personas/personaService.ts:415`), whose
`usePersonaResolution` effect runs on `[resolve, version]` only; `version` is a global counter bumped by
`invalidatePersonas()`, not keyed by exercise. The console does not remount on switch (`ControllerConsole.tsx:471-492`).

## Acceptance Criteria

- [ ] The staff persona store is keyed by the active exercise id: switching exercise discards the old list and loads
      the new one without a reload; a response for the previous exercise that arrives late is dropped.
- [ ] `PersonaPicker` clears a selected persona that does not belong to the new exercise and shows the new list.
- [ ] Persona edit (`usePersonaEdit.ts`) and Live world's unknown-author refresh keep working through
      `invalidatePersonas()`.
- [ ] No persona of exercise A is ever shown while exercise B is active (test).

## Out of Scope

Remounting the whole console; other stores (run sheet and Live world are already exercise-scoped by their reads).

## Technical Notes

Owns `features/personas/personaService.ts` and `controller/components/PersonaPicker.tsx` only. Do not touch
`controller/liveWorld/**` (story 20 owns `LiveWorldRow.tsx`).

## Dependencies

None.

## Tests

`personaService.test.ts`: switch A→B loads B, late A response dropped; `PersonaPicker.test.tsx`: selection cleared
on switch, B's list shown.
