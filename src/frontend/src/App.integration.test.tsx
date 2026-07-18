/**
 * App.integration.test.tsx
 * ---------------------------------------------------------------------------
 * Integration-B wiring test for the staff shell's Evaluator Dashboard route
 * (`EvaluatorDashboardRoute`, exported from `App.tsx`). The individual pieces
 * are unit-tested in their own stories; this proves they are WIRED together:
 *
 *  - the evaluator surface renders inside the real `StaffShellFrame` (navy
 *    header + the shared toolstrip), not the old stub;
 *  - the evaluator's own tools register into the toolstrip SURFACE zone
 *    (rehost, Integration A);
 *  - the shell-global participant-admin tool registers into the SHELL-GLOBAL
 *    zone (story 03), mounted by the frame's `globalOverlay` slot;
 *  - the header's Preview-as button (story 01) drives `usePreview()` (story
 *    04): pressing it SWAPS the work area for the read-only participant
 *    preview stage, and suppresses the shell-global admin flyout so it can
 *    never sit above the preview stage; exiting restores the work area.
 *
 * `ExerciseContextProvider` resolves its mock scope asynchronously (it renders
 * nothing until resolved), so the first assertion waits via `findBy*`.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { EvaluatorDashboardRoute } from './App'

function renderRoute() {
  // A dedicated client so React Query state never leaks between test cases.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EvaluatorDashboardRoute />
    </QueryClientProvider>,
  )
}

describe('EvaluatorDashboardRoute — Integration B wiring', () => {
  it('renders the evaluator inside the real staff frame with both toolstrip zones populated', async () => {
    renderRoute()

    // Exercise context resolves async; the navy staff header appearing proves
    // the frame mounted (not the deleted stub).
    expect(await screen.findByTestId('staff-header')).toBeInTheDocument()
    expect(screen.getByTestId('staff-shell-header')).toHaveTextContent('Evaluator Dashboard')

    // Shell-global zone: the participant-admin tool (story 03) is mounted via
    // the frame's globalOverlay slot.
    expect(screen.getByTestId('toolstrip-tool-participant-admin')).toBeInTheDocument()
    // Surface zone: the evaluator's own tools registered through the rehost.
    expect(screen.getByTestId('toolstrip-tool-annotations')).toBeInTheDocument()

    // Not previewing yet: the button offers to enter preview, no stage shown.
    const previewButton = screen.getByTestId('staff-header-preview-toggle')
    expect(previewButton).toHaveTextContent('Preview as participant')
    expect(previewButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
  })

  it('Preview-as button swaps the work area for the read-only preview stage and suppresses the admin flyout, then restores on exit', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByTestId('staff-header')
    const previewButton = screen.getByTestId('staff-header-preview-toggle')

    // Enter preview.
    await user.click(previewButton)

    // The participant-preview stage replaces the work area, rendering the
    // read-only participant-world stub.
    expect(await screen.findByTestId('preview-as-participant')).toBeInTheDocument()
    expect(screen.getByTestId('portal-stub')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-preview-toggle')).toHaveAttribute('aria-pressed', 'true')

    // The shell-global admin flyout is suppressed during preview (so it can
    // never render above the preview stage), and the evaluator's surface tools
    // are gone with the swapped-out work area.
    expect(screen.queryByTestId('toolstrip-tool-participant-admin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('toolstrip-tool-annotations')).not.toBeInTheDocument()

    // Exit preview → the work area (and its tools) come back.
    await user.click(screen.getByTestId('preview-exit'))
    await waitFor(() => {
      expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('toolstrip-tool-participant-admin')).toBeInTheDocument()
    expect(screen.getByTestId('toolstrip-tool-annotations')).toBeInTheDocument()
  })

  it('opens the shell-global participant-admin flyout from the toolstrip (within the staff frame)', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByTestId('staff-header')

    // Flyout closed initially.
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('toolstrip-tool-participant-admin'))

    const flyout = await screen.findByTestId('participant-admin-flyout')
    expect(flyout).toBeInTheDocument()
    // Login-triage rows render (the mock roster) — proves the flyout is live,
    // not an empty shell.
    expect(within(flyout).getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})
