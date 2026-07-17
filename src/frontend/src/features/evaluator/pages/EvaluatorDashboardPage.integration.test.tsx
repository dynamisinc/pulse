/**
 * features/evaluator/pages/EvaluatorDashboardPage.integration.test.tsx
 * ---------------------------------------------------------------------------
 * Integration smoke test for the Evaluator Dashboard's re-hosting under the
 * REAL shared staff shell (D7, integration glue — see App.tsx's
 * `EvaluatorDashboardRoute`). Renders the exact composition App.tsx mounts at
 * `/evaluator`:
 *
 *   <ExerciseContextProvider><ToolstripProvider>
 *     <StaffShellFrame header={<StaffHeader .../>} toolstrip={<Toolstrip/>}>
 *       <EvaluatorDashboardPage/>
 *     </StaffShellFrame>
 *   </ToolstripProvider></ExerciseContextProvider>
 *
 * Deliberately does NOT mock `@/core/exerciseContext` — `ExerciseContextProvider`
 * resolves asynchronously (the Wave-0 DEV mock, see
 * `exerciseContextResolver.ts`) and renders nothing until it does, so every
 * assertion goes through `findBy*`/`waitFor` (mirrors
 * `StaffHeader.default.test.tsx`'s shipped-path coverage pattern).
 *
 * Covers (WAVE0-REVIEW precedent 17 — real assertions, not a re-implemented
 * fixture):
 *  (a) the navy staff header renders with "Evaluator Dashboard";
 *  (b) the evaluator's own tools (annotations, aar-export) appear in the
 *      toolstrip's SURFACE zone — the registration seam actually reaches the
 *      shell-owned dock, not a private strip;
 *  (c) clicking a tool button opens its flyout, and clicking again closes it;
 *  (d) no participant compliance-chrome banners are present — this is the
 *      staff world, never framed by the participant compliance chrome.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { StaffHeader } from '@/features/staffShell/components/StaffHeader'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { EvaluatorDashboardPage } from './EvaluatorDashboardPage'

function renderEvaluatorStaffComposition() {
  return render(
    <ExerciseContextProvider>
      <ToolstripProvider>
        <StaffShellFrame
          header={<StaffHeader surfaceName="Evaluator Dashboard" />}
          toolstrip={<Toolstrip />}
        >
          <EvaluatorDashboardPage />
        </StaffShellFrame>
      </ToolstripProvider>
    </ExerciseContextProvider>,
  )
}

describe('EvaluatorDashboardPage — hosted under the real staff shell (integration)', () => {
  it('renders the navy staff header with "Evaluator Dashboard"', async () => {
    renderEvaluatorStaffComposition()

    const header = await screen.findByTestId('staff-shell-header')
    expect(within(header).getByText('Evaluator Dashboard')).toBeInTheDocument()
  })

  it('registers the evaluator\'s tools into the toolstrip\'s surface zone', async () => {
    renderEvaluatorStaffComposition()

    expect(await screen.findByTestId('toolstrip-tool-annotations')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-tool-aar-export')).toBeInTheDocument()
  })

  it('opens a tool\'s flyout on click, and closes it on a second click', async () => {
    const user = userEvent.setup()
    renderEvaluatorStaffComposition()

    const annotationsButton = await screen.findByTestId('toolstrip-tool-annotations')

    expect(screen.queryByText('ANNOTATIONS')).not.toBeInTheDocument()

    await user.click(annotationsButton)
    await waitFor(() => expect(screen.getByText('ANNOTATIONS')).toBeInTheDocument())

    await user.click(annotationsButton)
    await waitFor(() => expect(screen.queryByText('ANNOTATIONS')).not.toBeInTheDocument())
  })

  it('renders no participant compliance-chrome banners (staff world)', async () => {
    renderEvaluatorStaffComposition()

    await screen.findByTestId('staff-shell-header')

    expect(screen.queryByTestId('pulse-compliance-chrome-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-compliance-chrome-bottom')).not.toBeInTheDocument()
  })
})
