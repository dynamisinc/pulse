/**
 * features/exerciseLifecycleAdmin/ExerciseManagementRoute.tsx
 * ---------------------------------------------------------------------------
 * The EXERCISE MANAGEMENT staff surface ROUTE composition (feature:
 * exercise-lifecycle-admin, stories 01/02/03 — COR-074/075/076) — the element
 * the staff route registry mounts at `/staff/exercises`.
 *
 * Lives with its own feature, not in `App.tsx`, for the same reason as
 * `PlannerWorkspaceRoute` / `EvaluatorDashboardRoute`: the registry
 * (`@/features/staff/staffRouteRegistry`) has to import each surface's
 * composition, and it cannot import one that lives in the module which imports
 * the registry.
 *
 * ## Surface #4 — and the first one two roles can reach
 * Every registry entry before this one was allowed for exactly one role, which
 * meant `SurfaceLauncher` always hit its `entries.length <= 1` degrade and
 * rendered the static brand lockup in production. This entry is allowed for
 * BOTH `planner` and `orgAdmin`, so a planner now has two destinations and the
 * launcher renders for real for the first time. That is behaviour nothing but a
 * no-props render inside the real route tree can see (a wired and an unwired
 * launcher are pixel-identical), which is what
 * `exerciseManagementLauncher.test.tsx` exists to pin.
 *
 * NO `ExerciseContextProvider` HERE — deliberately, matching
 * `PlannerWorkspaceRoute` (CR-001). Exactly one provider is mounted, hoisted in
 * `features/app-shell/routes.tsx` above both worlds; a second one here would
 * keep serving the pre-switch scope to everything inside it while the cross-
 * exercise switcher refreshed the hoisted one.
 *
 * No `PreviewProvider`: previewing the participant world belongs to the conduct
 * surfaces. Someone administering the organization's portfolio has no scenario
 * moment to preview, so the header's preview control is simply not wired here
 * (its props are optional).
 *
 * Staff world: `StaffShellFrame` applies COBRA inside its own theme boundary, so
 * this is never reachable from a participant path.
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ExerciseManagementPage } from './pages/ExerciseManagementPage'

/** The `/staff/exercises` route element. See the module header. */
export const ExerciseManagementRoute = () => (
  <ToolstripProvider>
    <StaffShellFrame
      header={<StaffHeader surfaceName="Exercise Management" />}
      toolstrip={<Toolstrip />}
    >
      <ExerciseManagementPage />
    </StaffShellFrame>
  </ToolstripProvider>
)
