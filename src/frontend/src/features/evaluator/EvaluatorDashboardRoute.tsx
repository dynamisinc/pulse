/**
 * features/evaluator/EvaluatorDashboardRoute.tsx
 * ---------------------------------------------------------------------------
 * The Evaluator Dashboard ROUTE composition — the element the staff route
 * registry mounts at `/staff/evaluate`.
 *
 * MOVED HERE FROM `App.tsx` (staff deep-linking change). It used to be defined
 * in the composition root because the role-aware entry took a role→surface map
 * that only `App.tsx` could fill. Staff surfaces are now declared once in
 * `@/features/staff/staffRouteRegistry`, and that registry must be able to
 * IMPORT each surface's composition — which it cannot do while the composition
 * lives in the module that imports the registry (an import cycle). So every
 * staff route composition now lives with its own feature, exactly as
 * `ControllerConsoleRoute` already did. `App.tsx` re-exports this symbol so its
 * existing consumers (the Integration-B wiring test) are unaffected.
 *
 * PROVIDER STACK (staff world — COBRA lives inside `StaffShellFrame`):
 *   ToolstripProvider        — the shell-owned toolstrip registry (D7-011).
 *   > PreviewProvider        — the preview-as-participant toggle (story 04).
 *   > EvaluatorStaffShell    — the frame + header + toolstrip + work area.
 *
 * NO `ExerciseContextProvider` HERE — deliberately (CR-001). This composition
 * used to mount its own, justified as "a deliberate, benign RE-resolve of the
 * same host/auth-resolved scope". That rationale is obsolete: the scope is now
 * RE-RESOLVABLE at runtime (`useExerciseScopeRefresh`, staff-navigation/04) and
 * the switcher that triggers it (`ExerciseSwitcherSlot`) is a SIBLING of
 * `StaffRouteTree`, so it refreshes the provider hoisted in
 * `features/app-shell/routes.tsx`. That refresh commits atomically WITHOUT a
 * remount, so a second provider mounted here would never learn about the switch:
 * `StaffHeader`'s exercise badge would keep naming the OLD exercise while
 * `resetQueries()` refilled this dashboard with the NEW one's data. The single
 * hoisted provider is the only scope this surface reads; a test that mounts this
 * route directly must supply the provider itself.
 *
 * World: STAFF. Never reachable from a participant path — the registry is only
 * consulted after the resolved role is a staff role (COR-004).
 */

import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { ParticipantAdminFlyout } from '@/features/staffShell/components/ParticipantAdminFlyout'
import { PreviewProvider, usePreview } from '@/features/staffShell/previewContext'
import { PreviewAsParticipant } from '@/features/staffShell/components/PreviewAsParticipant'
import { EvaluatorDashboardPage } from './pages/EvaluatorDashboardPage'

/**
 * Inner staff-shell composition for the Evaluator Dashboard. Reads the preview
 * toggle (`usePreview`) to drive the header's Preview-as button AND to swap the
 * work area for the read-only participant-preview stage (story 04). Renders
 * inside `PreviewProvider` + `ToolstripProvider` (see
 * `EvaluatorDashboardRoute`), under the hoisted `ExerciseContextProvider`.
 */
function EvaluatorStaffShell() {
  const { active: previewActive, toggle: togglePreview } = usePreview()
  return (
    <StaffShellFrame
      header={
        <StaffHeader
          surfaceName="Evaluator Dashboard"
          previewActive={previewActive}
          onTogglePreview={togglePreview}
        />
      }
      toolstrip={<Toolstrip />}
      // Shell-global participant-admin flyout (story 03). Suppressed while the
      // participant preview is staged, so it can never render above the preview
      // stage (SHELL-CONTRACT §4 / story-03 stacking note); it re-registers on
      // preview exit.
      globalOverlay={previewActive ? undefined : <ParticipantAdminFlyout />}
    >
      {previewActive ? <PreviewAsParticipant /> : <EvaluatorDashboardPage />}
    </StaffShellFrame>
  )
}

/** The `/staff/evaluate` route element. See the module header. */
export const EvaluatorDashboardRoute = () => (
  <ToolstripProvider>
    <PreviewProvider>
      <EvaluatorStaffShell />
    </PreviewProvider>
  </ToolstripProvider>
)
