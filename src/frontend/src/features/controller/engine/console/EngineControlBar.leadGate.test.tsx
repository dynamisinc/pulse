/**
 * features/controller/engine/console/EngineControlBar.leadGate.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573), lead-controller gate, raise-only (Option A).
 * The kill switch cycles Live -> Suggest-only -> STOP -> Live. The first two steps LOWER the
 * engine and are open to every controller; the step back to Live (and the degraded banner's
 * Restore) call `POST /api/engine/autonomy/restore`, which only the lead controller may do. For a
 * non-lead controller those two are DISABLED with the visible text "Only the lead controller can
 * raise this" (icon + words, tied by aria-describedby).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { engineControlStore } from '../hooks/useEngineControl'
import { engineSettingsStore } from '../hooks/useEngineSettings'
import { EngineControlBar } from './EngineControlBar'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

const REASON = 'Only the lead controller can raise this'

beforeEach(() => {
  resetStubSession()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
})
afterEach(() => engineSettingsStore.resetForTests())

async function renderBar() {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EngineControlBar />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  await screen.findByTestId('engine-control-bar')
}

describe('kill switch', () => {
  it('a non-lead controller can lower (Live -> Suggest-only -> STOP) but not step back to Live', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const user = userEvent.setup()
    await renderBar()
    const killSwitch = screen.getByTestId('engine-kill-switch')

    expect(killSwitch).toBeEnabled()
    await user.click(killSwitch) // Live -> Suggest-only
    expect(killSwitch).toHaveAttribute('data-mode', 'suggest-only')
    expect(killSwitch).toBeEnabled()
    await user.click(killSwitch) // Suggest-only -> STOP
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')

    // The next step is the restore (a raise).
    expect(killSwitch).toBeDisabled()
    expect(killSwitch).toHaveAttribute('aria-describedby', 'engine-lead-only-reason')
    const reason = screen.getByTestId('engine-lead-only-reason')
    expect(reason).toHaveTextContent(REASON)
    expect(reason.querySelector('svg')).not.toBeNull()
  })

  it('the lead controller can complete the whole cycle, with no reason shown', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const user = userEvent.setup()
    await renderBar()
    const killSwitch = screen.getByTestId('engine-kill-switch')

    await user.click(killSwitch)
    await user.click(killSwitch)
    expect(killSwitch).toHaveAttribute('data-mode', 'stop')
    expect(killSwitch).toBeEnabled()
    expect(screen.queryByTestId('engine-lead-only-reason')).not.toBeInTheDocument()
    await user.click(killSwitch)
    expect(killSwitch).toHaveAttribute('data-mode', 'live')
  })
})

describe('degraded banner Restore', () => {
  it('is disabled with the reason for a non-lead controller', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const user = userEvent.setup()
    await renderBar()
    await user.click(screen.getByTestId('engine-degraded-simulate'))

    const restore = screen.getByTestId('engine-degraded-restore')
    expect(restore).toBeDisabled()
    expect(restore).toHaveAttribute('aria-describedby', 'engine-lead-only-reason')
    expect(screen.getByTestId('engine-lead-only-reason')).toHaveTextContent(REASON)
  })

  it('is enabled for the lead and clears the degraded state', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const user = userEvent.setup()
    await renderBar()
    await user.click(screen.getByTestId('engine-degraded-simulate'))

    expect(screen.getByTestId('engine-degraded-restore')).toBeEnabled()
    await user.click(screen.getByTestId('engine-degraded-restore'))
    expect(screen.queryByTestId('engine-degraded-indicator')).not.toBeInTheDocument()
  })
})
