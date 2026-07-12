# Implementation: Persona management & cast libraries

> Staff-world authoring over the org library + exercise-scoped instances. Feeds E7 (console operates
> personas) and E8 (voice notes drive generation). Backend not present yet.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Templates | Org-library PersonaTemplate CRUD with type-driven defaults. | `features/planner/components/PersonaTemplateEditor.tsx` (+ backend model) | template model, `usePersonaTemplates()` |
| 02 Casts & seeding | Cast assembly + one-action seed producing derived state. | `features/planner/components/CastBuilder.tsx`, `services/seedCast.ts` | `seedCast()` |
| 03 Mid-exercise create | Quick-create Persona (capability behind E7 UI). | (backend) persona create | `createPersona()` |
| 04 Backdated history | Backdated posts with pre-StartEx scenario timestamps. | `features/planner/components/BackdatedComposer.tsx` | — |
| 05 Avatar library | Bundled library + validated upload. | `features/planner/components/AvatarPicker.tsx` | `AvatarPicker` |

## Reuse map
- Exercise-isolation: Persona/PersonaTemplate multi-instance (story 03), access-checked media (05)
- Audience-magnitude bands (SOC-054, E2) — templates + seeding derived state
- E2 post model + scenario-time rendering (COR-053) — backdated history (04)
- Content-security (NFR-004) — avatar upload validation/sanitization (05)
- COBRA theme (staff authoring) — `@/theme/styledComponents`
- Consumed by: E7 persona-operation (operate personas), E8 (voice notes)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Templates | PersonaTemplateEditor, model | exercise-isolation 03 | 05 | 1 | M |
| 05 Avatar library | AvatarPicker | exercise-isolation 02; NFR-004 | 01 | 1 | S |
| 02 Casts & seeding | CastBuilder, seedCast | 01; SOC-054 | 03 | 2 | M |
| 03 Mid-exercise create | persona create | 01 | 02 | 2 | S |
| 04 Backdated history | BackdatedComposer | 01; E2 post model; COR-053 | — | 3 | M |
