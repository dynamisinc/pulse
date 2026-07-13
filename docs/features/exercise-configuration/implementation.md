# Implementation: Exercise configuration

> Staff-world settings that shape the world; the lifecycle state machine other features subscribe to.
> Compliance chrome is participant-world framing. Backend not present yet.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Settings | Per-exercise settings editor + model. | `features/planner/components/ExerciseSettings.tsx` (+ backend) | exercise settings model, `useExerciseSettings()` |
| 02 Compliance chrome | App-shell banner outside the skin subtree + chrome/watermark guard. | `src/frontend/src/core/ComplianceChrome.tsx` | `<ComplianceChrome>` |
| 03 Lifecycle | Lifecycle state machine + subsystem hooks. | (backend) lifecycle; `core/lifecycle.ts` | `useLifecycleState()` |
| 04 Practice flag | Sandbox flag read by export filtering. | (backend) flag | practice flag |
| 05 Participant exercise identity | **Requirements decision, no code** — resolves COMPONENTS.md divergence #5; outcome lands in story 02's chrome content and the D7 shell. Not in the wave plan. | — | the decision (D7 input) |

## Reuse map
- Exercise entity (exercise-isolation) — settings hang off it
- Participant app shell — compliance chrome renders outside each channel skin
- NFR-008 watermark slot — the chrome/watermark mutual guard (02)
- Scenario clock (exercise-clock) — consumes the time-zone setting (01)
- Consumed by: exercise-build-golive (lifecycle transitions), all channels (enablement/theming), E10 (practice flag)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Settings | ExerciseSettings, model | exercise-isolation (Exercise) | 03 | 1 | M |
| 03 Lifecycle | lifecycle state machine | exercise-isolation | 01 | 1 | M |
| 02 Compliance chrome | ComplianceChrome | 01; app shell; NFR-008 | 04 | 2 | M |
| 04 Practice flag | flag | 01; E10 export | 02 | 2 | S |
