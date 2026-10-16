# Implementation: Exercise build & go-live

> Staff-world content-development phase + the two gated go-live moments. Sits on the lifecycle state
> machine (exercise-configuration COR-032) and the clock (exercise-clock COR-050). Backend not present.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Build workspace | Hosts conduct composers in an unpublished/held state. | `features/planner/components/BuildWorkspace.tsx` | — |
| 02 Preview-as-participant | Staff-invoked participant render at a chosen scenario time. | `features/planner/components/ParticipantPreview.tsx` | `<ParticipantPreview>` |
| 03 Readiness dashboard | Aggregates per-subsystem readiness status. | `features/planner/components/ReadinessDashboard.tsx`, `hooks/useReadiness.ts` | `useReadiness()` |
| 04 Gated go-live | Two Director-gated lifecycle transitions (Staged, StartEx). | `features/planner/components/GoLiveControls.tsx` | go-live actions |
| 05 Content lock | Versioning/lock boundary at go-live. | (backend) content lock | lock boundary |
| 06 Duplication | Deep-copy of world-definition entities. | (backend) `cloneExercise` | `cloneExercise()` |

## Reuse map
- exercise-configuration lifecycle (`useLifecycleState`) — Build/Staged/Live transitions
- exercise-clock (COR-050) — StartEx starts the clock
- Participant surfaces (E2) + scenario-time (COR-053) — preview (02) renders them
- Readiness inputs: exercise-isolation/09 (network), identity-auth-roles (provisioning/shared cred),
  persona-management (seeding), exercise-configuration (chrome), NFR-002 (load rehearsal)
- COBRA theme (staff) — `@/theme/styledComponents`

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Build workspace | BuildWorkspace | lifecycle; composers | 02 | 1 | M |
| 02 Preview-as-participant | ParticipantPreview | participant surfaces; COR-053 | 01 | 1 | M |
| 04 Gated go-live | GoLiveControls | lifecycle; clock; roles | 03 | 2 | M |
| 03 Readiness dashboard | ReadinessDashboard, useReadiness | readiness inputs | 04 | 2 | M |
| 05 Content lock | content lock | 04 | 06 | 3 | M |
| 06 Duplication | cloneExercise | 01; exercise-configuration | 05 | 3 | M |

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 09 Participant name | `Exercise.ParticipantName`, `ExerciseScopeDto`, settings field | A1 | 07, 08 | A3 | S |
| 07 Reset/reopen/unstage/unarchive | `Features/ExerciseLifecycleAdmin/Reset*`, `LifecycleEndpoints.cs`, `Clear-DemoContent.ps1`, confirm dialog | A1 (16, 17) | 08, 09 | A3 | L |
| 08 Delete | `ExerciseDelete*.cs`, list row action | 07 (shared transaction/outbox helper) | 09 | A3 | M |
| 10 Hub + loop gate | `ReactionLoopHost`, hub | A3, A1 | 11 (disjoint) | A5 | M |
| 11 Frozen write gate | participant write filter | identity 17, A3 | 10 | A5 | M |
| 12 Push lifecycle | hub group message, composer + header | 10, 11 | — | A5 | M |

Reuse: `PulseDbContext` central filter for every delete, blob outbox, `ComplianceChromeGuard`, COBRA type-to-confirm, SignalR feed hook, telemetry emitter. The A3 migration (`Posts.IsSetupContent`, `Exercises.ParticipantName`) is orchestrator-owned. Stories 01/03/04/05/06 edits ride in wave A3 alongside.
