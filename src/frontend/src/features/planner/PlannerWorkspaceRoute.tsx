/**
 * features/planner/PlannerWorkspaceRoute.tsx
 * ---------------------------------------------------------------------------
 * The PLANNER staff surface ROUTE composition (E1 exercise-configuration, story
 * 01b) — the element the staff route registry mounts at `/staff/plan`.
 *
 * MOVED HERE FROM `App.tsx` (staff deep-linking change), for the same reason as
 * `EvaluatorDashboardRoute`: the registry in `@/features/staff/staffRouteRegistry`
 * has to import each staff surface's composition, and it cannot import one that
 * lives in the module which imports the registry. `App.tsx` re-exports this
 * symbol so its existing consumers (the Integration-B wiring test) are
 * unaffected.
 *
 * NO `ExerciseContextProvider` HERE — deliberately (CR-001). This composition
 * used to mount its own, described as "a benign re-resolve of the same
 * host/auth-resolved scope". It was not benign: the switcher
 * (`ExerciseSwitcherSlot`) renders as a SIBLING of `StaffRouteTree`, so
 * `useExerciseScopeRefresh()` resolves to the provider hoisted in
 * `features/app-shell/routes.tsx` — and that refresh commits atomically WITHOUT
 * a remount. A second provider mounted here would keep serving the PRE-switch
 * scope to everything inside it (`StaffHeader`'s exercise badge above all) while
 * `resetQueries()` refetched this surface's data under the NEW server scope:
 * new-exercise data beneath the old exercise's name. The one hoisted provider is
 * the only scope this surface reads; tests that mount this route directly must
 * supply it themselves.
 *
 * Staff world: `StaffShellFrame` applies COBRA inside its own theme boundary, so
 * this is never reachable from a participant path. No `PreviewProvider` — the
 * preview-as-participant stage belongs to the conduct surfaces (controller /
 * evaluator); a planner configuring the world has no scenario moment to preview
 * yet, so the header's preview control is simply not wired here (its props are
 * optional). `ExerciseSettingsPage` is a composition point — a left section nav
 * over a content pane, one registry entry per section: wave 3's
 * `ComplianceChromePanel` (story 02) and `PracticeModePanel` (story 04) are two
 * of its five sections.
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ExerciseSettingsPage } from './pages/ExerciseSettingsPage'

/** The `/staff/plan` route element. See the module header. */
export const PlannerWorkspaceRoute = () => (
  <ToolstripProvider>
    <StaffShellFrame
      header={<StaffHeader surfaceName="Exercise Settings" />}
      toolstrip={<Toolstrip />}
    >
      <ExerciseSettingsPage />
    </StaffShellFrame>
  </ToolstripProvider>
)
