/**
 * features/controller/components/confirm/confirmRoles.test.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 15: the guarded controls are unreachable for non-controllers ON A TABLET
 * too (coarse pointer mocked). Role gating is unchanged and the server stays the authority:
 *   - Take down renders nothing;
 *   - the Pause pill is a read-only readout (no button, so no Freeze);
 *   - the kill switch is a read-only readout (no button, so no re-arm);
 *   - End exercise / Start exercise render nothing for an evaluator session.
 */
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider, useExerciseContext } from '@/core/exerciseContext'
import { PausePill } from '../steering/PausePill'
import { TakedownAction } from '../../liveWorld/TakedownAction'
import { EngineControlBar } from '../../engine/console/EngineControlBar'
import {
  renderControl,
  resetLifecycleMock,
  scopeResolved,
} from '../../lifecycle/lifecycle.testUtils'
import { mockPointer, restoreMatchMedia } from './coarsePointer.testUtils'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => false }))
vi.mock('../../access/useCanControl', () => ({ useCanControl: () => false }))
vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('../../lifecycle/lifecycle.sessionKit.testUtils')).resolveSession,
}))

function ScopeSentinel() {
  useExerciseContext()
  return <span data-testid="scope-sentinel" />
}

afterEach(() => {
  restoreMatchMedia()
  resetLifecycleMock()
})

describe('guarded controls on a tablet, as a non-controller', () => {
  it('Take down is absent', async () => {
    mockPointer(true)
    render(
      <ThemeProvider theme={cobraTheme}><ExerciseContextProvider>
        <ScopeSentinel />
        <TakedownAction
          post={{
            id: 'post-seed-fwupd-rumor',
            authorPersonaId: 'p',
            authorHandle: 'h',
            authorDisplayName: 'Someone',
            authorVerified: false,
            text: 't',
            scenarioTime: '2033-09-04T13:45:00Z',
            counts: { reply: 0, repost: 0, like: 0 },
          }}
        />
      </ExerciseContextProvider></ThemeProvider>,
    )
    // The sentinel only renders once the scope has resolved, i.e. once Take down COULD mount.
    await screen.findByTestId('scope-sentinel')
    expect(screen.queryByTestId('takedown-trigger')).not.toBeInTheDocument()
  })

  it('the pause control is a readout, not a button', async () => {
    mockPointer(true)
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider><PausePill /></ExerciseContextProvider>
      </ThemeProvider>,
    )
    expect(await screen.findByTestId('pause-readout')).toBeInTheDocument()
    expect(screen.queryByTestId('pause-pill')).not.toBeInTheDocument()
  })

  it('the kill switch is a readout, not a button', async () => {
    mockPointer(true)
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider><EngineControlBar /></ExerciseContextProvider>
      </ThemeProvider>,
    )
    expect(screen.queryByTestId('engine-kill-switch')).not.toBeInTheDocument()
    expect(await screen.findByTestId('engine-mode-readout')).toBeInTheDocument()
  })

  it('End exercise is absent for an evaluator session', async () => {
    mockPointer(true)
    renderControl({ status: 'live', sessionRole: 'evaluator', withHeader: true })
    await scopeResolved()
    expect(screen.queryByTestId('lifecycle-end')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exercise-lifecycle-control')).not.toBeInTheDocument()
  })
})
