# Implementation: Console shell

> Wave 1 foundation of the E7 console — the frame every other feature mounts into. Staff world
> (COBRA). Backend not present; participant/telemetry data is mocked behind the axios client.

> **Wave-1 cross-feature integration composition (supersedes this doc's story-01 wave slot for this
> pass).** Story 01 is the KEYSTONE of a 5-story parallel wave spanning `console-shell` (this
> feature), `persona-operation`, and `feeds-discovery` — not just this feature's own stories. See
> `docs/features/console-shell/01-toolstrip-flyouts.md`'s "Wave-1 integration seam" for the exact
> files/order. The other four stories build against story 01's INPUT/CALLBACK contract
> (`activePersona`, `actingHumanId`, `callSign`, `onPublished`) in parallel; a serial integration step
> (not a builder) wires them together, creates the `features/controller` barrel, and adds the
> App.tsx `/console` route. This section's own Wave Plan table (below) still governs stories 02–05
> once Wave 1 lands.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Toolstrip + flyouts | Console surface registering into the SHIPPED `staff-shell` toolstrip dock (`useRegisterSurfaceTool()`/`useToolstrip()`) — no console-owned strip/registry. Also ships the ⌘K command palette, the persona-dock host flyout slot, and a Phase-1 mock controller identity (COR-018 seam; rationale in the story). | `features/controller/components/ControllerConsole.tsx`, `features/controller/console/CommandPalette.tsx`, `features/controller/console/personaDockHost.*`, `features/controller/identity/controllerIdentity.ts` | `<ControllerConsole>` (registers its own tools on mount), `useControllerIdentity()`, the persona-dock host mount point (consumed by the integration step, not by other Wave-1 stories directly) |
| 02 NEEDS-YOU bar | Persistent bar bound to a derived to-dos selector; chips call a shared reveal-target primitive, never a mutation. | `features/controller/components/shell/NeedsYouBar.tsx`, `hooks/useToDos.ts`, `components/shell/revealTarget.ts` | `useToDos()`, `revealTarget()` |
| 03 Static identity badge | Header badge that reads lifecycle state to choose static vs switchable. **Placement/presentation interim — superseded by D7 shell (R-006)**; build the behavior, expect the chrome to be re-homed. | `features/controller/components/shell/IdentityBadge.tsx` | `<IdentityBadge>` |
| 04 Flag → AAR | Hover Flag affordance + an AAR-write mutation (append-only). | `features/controller/hooks/useFlagToAar.ts`, `components/FlagAction.tsx` | `useFlagToAar()`, `<FlagAction>` |
| 05 Trainee monitor | Consult-on-demand flyout of trainee cards over the activity + expected-action stream. | `features/controller/components/TraineeMonitor.tsx`, `hooks/useTrainees.ts` | `<TraineeMonitor>` (registered tool) |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- Exercise-context / active-exercise + lifecycle state (E1, COR-032/050) — read for static-vs-switch
- Telemetry emitter (XC-004) — flag + monitor read the same activity stream feeding live-monitoring
- E10 after-action record sink — Flag writes here (minimal now)
- `revealTarget()` primitive (story 02) — reused by NEEDS-YOU chips and Flag/locate affordances
- **`staff-shell`'s toolstrip dock (SHIPPED, Complete)** — `@/features/staffShell/toolRegistry`'s
  `useRegisterSurfaceTool()` / `useToolstrip()` is the seam story 01 (and, later, persona picker,
  review queue, trainee monitor, rumor tracker) registers tools through — the console never draws its
  own strip or registry (D7-011).
- **`StaffShellFrame`** (`@/features/staffShell/StaffShellFrame`, shipped) — `header`/`toolstrip`/
  `children`/`globalOverlay` slots the `/console` route composition (integration step) mounts
  `ControllerConsole` into, mirroring the shipped `/evaluator` route's composition.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Toolstrip + flyouts | `ControllerConsole.tsx`, `CommandPalette.tsx`, `personaDockHost.*`, `controllerIdentity.ts` | `staff-shell` (shipped); E1 roles/context | — (KEYSTONE of the cross-feature Wave-1 integration composition — see the callout above; runs in parallel with `persona-operation` 01/02/03 and `feeds-discovery` 07, not with 03 below) | 1 | M |
| 03 Static identity badge | IdentityBadge | E1 lifecycle state; **superseded in presentation by `staff-shell`'s header (shipped) — confirm this story still adds value before building; likely reduces to a thin behavior note** | — | 1 | S |
| 02 NEEDS-YOU bar | NeedsYouBar, useToDos, revealTarget | 01; to-do sources (review queue/timers) | — | 2 | M |
| 04 Flag → AAR | useFlagToAar, FlagAction | 01; E10 AAR sink; telemetry | 05 | 2 | S |
| 05 Trainee monitor | TraineeMonitor, useTrainees | 01; activity stream; CTL-032 | 04 | 3 | M |

This feature is Wave 1 for the whole epic: story 01 must land before the other E7 features' surfaces
have a host to mount into. **For this pass, story 01 itself builds as part of a larger 5-story
cross-feature Wave-1 composition** (this doc's own callout above) — stories 02–05 are unaffected and
still follow this table once story 01 lands.
