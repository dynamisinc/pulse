/**
 * features/controller/lifecycle/ExerciseLifecycleControl.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6 (docs/features/demo-polish/23-preview-and-startex.md), AC "StartEx / EndEx
 * control", under MOCK DATA -- the simulated machine, which is what `npm run dev` and the
 * backend-less UAT run. The live endpoints (shapes, errors, the 409 re-read) are
 * `ExerciseLifecycleControl.live.test.tsx` and `lifecycleService.test.ts`.
 *
 * Real providers throughout (see `lifecycle.testUtils`): the real exercise context, the real
 * `StaffHeader`, the real dialog. Nothing about the control is mocked, so "the header state pill
 * reflects the new state" is observed on the pill itself.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'
import {
  pillLabel,
  renderControl,
  resetLifecycleMock,
  scopeResolved,
} from './lifecycle.testUtils'

// The control gates on the signed-in session's role; the mock resolver's session is a
// participant, so the harness swaps in a staff session whose role each case picks.
vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle.sessionKit')).resolveSession,
}))

afterEach(() => {
  resetLifecycleMock()
})

describe('ExerciseLifecycleControl -- offers only what the state machine allows (gating)', () => {
  it('STAGED offers Start exercise and not End exercise', async () => {
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()

    expect(screen.getByRole('button', { name: /start exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /end exercise/i })).not.toBeInTheDocument()
  })

  it('LIVE offers End exercise and not Start exercise', async () => {
    renderControl({ status: 'live', withHeader: true })
    await scopeResolved()

    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
  })

  it('W-1: PAUSED offers End only -- its way back to live is a RESUME, never a second "Start exercise"', async () => {
    renderControl({ status: 'paused', withHeader: true })
    await scopeResolved()

    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
  })

  it.each(['build', 'completed', 'archived'] as const)(
    '%s allows neither live nor completed: no button, and no empty group left behind',
    async status => {
      renderControl({ status, withHeader: true })
      await scopeResolved()

      expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
    },
  )

  it('reads a legacy stored status through the COR-032 mapping (active = live, scheduled = build)', async () => {
    const view = renderControl({ status: 'active', withHeader: true })
    await scopeResolved()
    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
    view.unmount()

    renderControl({ status: 'scheduled', withHeader: true })
    await scopeResolved()
    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
  })

  it('is a labelled group whose buttons say what they do in text, not just an icon', async () => {
    const view = renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()
    const startGroup = screen.getByRole('group', { name: 'Exercise lifecycle' })
    expect(within(startGroup).getByRole('button', { name: 'Start exercise' }))
      .toHaveTextContent('Start exercise')
    view.unmount()

    renderControl({ status: 'live', withHeader: true })
    await scopeResolved()
    const endGroup = screen.getByRole('group', { name: 'Exercise lifecycle' })
    expect(within(endGroup).getByRole('button', { name: 'End exercise' }))
      .toHaveTextContent('End exercise')
  })
})

describe('ExerciseLifecycleControl -- Start exercise', () => {
  it('starts a STAGED exercise: the header pill moves STAGED -> LIVE and the result is announced in text', async () => {
    const user = userEvent.setup()
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()
    expect(pillLabel()).toBe('STAGED')

    await user.click(screen.getByRole('button', { name: /start exercise/i }))

    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    expect(screen.getByTestId('lifecycle-status')).toHaveTextContent('Exercise started. The state is now LIVE.')
    // The state machine moved on: Start is gone, End is now offered.
    expect(screen.queryByRole('button', { name: /start exercise/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
  })

  it('needs no confirmation: one press starts it', async () => {
    const user = userEvent.setup()
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()

    await user.click(screen.getByRole('button', { name: /start exercise/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
  })

  it('keeps keyboard focus inside the control after the Start button it was on is gone', async () => {
    const user = userEvent.setup()
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()

    screen.getByRole('button', { name: /start exercise/i }).focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Exercise lifecycle' })).toHaveFocus())
  })

  it('is operable from the keyboard alone: Tab reaches Start, Enter activates it', async () => {
    const user = userEvent.setup()
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()

    const start = screen.getByRole('button', { name: /start exercise/i })
    let presses = 0
    while (document.activeElement !== start && presses < 30) {
      await user.tab()
      presses += 1
    }
    expect(start).toHaveFocus()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(pillLabel()).toBe('LIVE'))
  })
})

describe('ExerciseLifecycleControl -- End exercise needs a typed END', () => {
  async function openEndDialog() {
    const user = userEvent.setup()
    renderControl({ status: 'live', withHeader: true })
    await scopeResolved()
    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    const dialog = await screen.findByRole('dialog', { name: /end the exercise/i })
    return { user, dialog }
  }

  it('opens a labelled modal dialog first: pressing End exercise does not end anything yet', async () => {
    const { dialog } = await openEndDialog()

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/moves the exercise to ENDEX/i)
    expect(pillLabel()).toBe('LIVE')
  })

  it('keeps the confirm button disabled until the field reads exactly END', async () => {
    const { user, dialog } = await openEndDialog()
    const confirm = within(dialog).getByTestId('end-exercise-confirm')
    const field = within(dialog).getByLabelText('Type END to confirm')

    expect(confirm).toBeDisabled()
    await user.type(field, 'end')
    expect(confirm).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'EN')
    expect(confirm).toBeDisabled()
    await user.type(field, 'D')
    expect(confirm).toBeEnabled()
    // The hint says it in words as well, so the enabled state is not a colour change alone.
    expect(dialog).toHaveTextContent('Ready: choose End exercise.')
  })

  it('puts focus in the field on open, so the controller types straight away', async () => {
    const { dialog } = await openEndDialog()

    await waitFor(() => expect(within(dialog).getByLabelText('Type END to confirm')).toHaveFocus())
  })

  it('ends the exercise once END is typed: the pill moves LIVE -> ENDEX, the dialog closes, the result is announced', async () => {
    const { user, dialog } = await openEndDialog()

    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('lifecycle-status')).toHaveTextContent('Exercise ended. The state is now ENDEX.')
    // Nothing left to press at EndEx.
    expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
  })

  it('moves focus to the control group when the End button it came from is gone', async () => {
    const { user, dialog } = await openEndDialog()

    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByTestId('end-exercise-confirm'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('group', { name: 'Exercise lifecycle' })).toHaveFocus())
  })

  it('Enter in the field confirms, but only once it reads END', async () => {
    const { user, dialog } = await openEndDialog()
    const field = within(dialog).getByLabelText('Type END to confirm')

    await user.type(field, 'EN{Enter}')
    expect(pillLabel()).toBe('LIVE')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.type(field, 'D{Enter}')
    await waitFor(() => expect(pillLabel()).toBe('ENDEX'))
  })

  it('Cancel closes the dialog without ending anything, and so does Esc', async () => {
    const { user, dialog } = await openEndDialog()
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pillLabel()).toBe('LIVE')

    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pillLabel()).toBe('LIVE')
  })

  it('starts each opening of the dialog with an empty field (a typed END is not remembered)', async () => {
    const { user, dialog } = await openEndDialog()
    await user.type(within(dialog).getByLabelText('Type END to confirm'), 'END')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /end exercise/i }))
    const again = await screen.findByRole('dialog')

    expect(within(again).getByLabelText('Type END to confirm')).toHaveValue('')
    expect(within(again).getByTestId('end-exercise-confirm')).toBeDisabled()
  })

  it('keeps the console palette (Ctrl/Cmd+K) inert while the dialog is open: it is an aria-modal layer', async () => {
    const { dialog } = await openEndDialog()

    // The console gates its chord on `hasOtherModalMounted(consoleRoot)` (core/a11y/modalPriority).
    // Any element outside the dialog stands in for the console root.
    const consoleRoot = document.createElement('div')
    document.body.appendChild(consoleRoot)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(hasOtherModalMounted(consoleRoot)).toBe(true)
    consoleRoot.remove()
  })
})

describe('ExerciseLifecycleControl -- absent for non-controller roles (W-2: gated on the SESSION)', () => {
  it.each(['evaluator', 'planner', 'participant', 'pio', 'orgAdmin'] as const)(
    'renders nothing for a %s SESSION, even when the exercise could be ended',
    async sessionRole => {
      renderControl({ status: 'live', sessionRole, withHeader: true })
      await scopeResolved()

      expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /start exercise|end exercise/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Exercise lifecycle' })).not.toBeInTheDocument()
    },
  )

  it('renders for a controller SESSION', async () => {
    renderControl({ status: 'live', sessionRole: 'controller', withHeader: true })
    await scopeResolved()

    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
  })

  it('FAILS CLOSED with no session at all: nothing rendered, and the surrounding tree is not taken down', async () => {
    renderControl({ status: 'live', sessionRole: 'none', withHeader: true })
    await scopeResolved()

    expect(screen.getByTestId('staff-header')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
  })

  it('the `role` prop overrides the session (a test seam): an evaluator prop hides it for a controller session', async () => {
    renderControl({ status: 'live', sessionRole: 'controller', role: 'evaluator', withHeader: true })
    await scopeResolved()

    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
  })

  it('...and a controller prop shows it for a non-controller session', async () => {
    renderControl({ status: 'live', sessionRole: 'evaluator', role: 'controller', withHeader: true })
    await scopeResolved()

    expect(screen.getByRole('button', { name: /end exercise/i })).toBeInTheDocument()
  })
})
