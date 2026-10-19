/**
 * features/controller/components/ControllerConsole.swampedSeam.test.tsx
 * ---------------------------------------------------------------------------
 * The seam between the engine settings and the draft-timer drivers (WR-001/WR-002):
 * `DraftTimerDriver` (-> `useDraftTimer`) receives `swampedMode === true` ONLY when the
 * server says swamped mode is on AND `timeoutAutoSendAuthorized === true`, across
 * swamped {false,true} x flag {undefined,false,true}. The driver is replaced by a recorder so
 * the console is otherwise the real one. (The poll itself is covered by
 * `useSwampedSettingsPoll.test.tsx`.)
 */
import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider, useExerciseContext } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import {
  MOCK_ENGINE_SETTINGS,
  engineSettingsStore,
} from '../engine/hooks/useEngineSettings'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import { ControllerConsole } from './ControllerConsole'

const seen = vi.hoisted(() => ({ swamped: [] as boolean[] }))

vi.mock('../engine/console/DraftTimerDriver', () => ({
  DraftTimerDriver: ({ swampedMode }: { swampedMode: boolean }) => {
    seen.swamped.push(swampedMode)
    return null
  },
}))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

vi.setConfig({ testTimeout: 30_000 })

const probed = { exerciseId: '' }
function Probe() {
  const { exerciseId } = useExerciseContext()
  useEffect(() => {
    probed.exerciseId = exerciseId
  }, [exerciseId])
  return null
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  seen.swamped = []
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
})

describe('ControllerConsole -> DraftTimerDriver swampedMode input', () => {
  const cases: ReadonlyArray<[boolean, boolean | undefined, boolean]> = [
    [false, undefined, false],
    [false, false, false],
    [false, true, false],
    [true, undefined, false],
    [true, false, false],
    [true, true, true],
  ]

  it.each(cases)('server swamped=%s, flag=%s -> driver gets %s', async (swamped, flag, expected) => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <ToolstripProvider>
            <ActivePersonaProvider>
              <Probe />
              <ControllerConsole />
            </ActivePersonaProvider>
          </ToolstripProvider>
        </ExerciseContextProvider>
      </ThemeProvider>,
    )
    await screen.findByTestId('review-queue')

    act(() => {
      engineSettingsStore.setForTests(probed.exerciseId, {
        ...MOCK_ENGINE_SETTINGS,
        autonomy: { ...MOCK_ENGINE_SETTINGS.autonomy, swampedMode: swamped },
        timeoutAutoSendAuthorized: flag,
      })
    })

    expect(seen.swamped.length).toBeGreaterThan(0)
    expect(seen.swamped[seen.swamped.length - 1]).toBe(expected)
  })
})
