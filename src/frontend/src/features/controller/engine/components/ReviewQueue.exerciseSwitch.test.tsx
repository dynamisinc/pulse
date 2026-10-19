/**
 * features/controller/engine/components/ReviewQueue.exerciseSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * The docked review queue across an in-place exercise switch (demo-feedback 24
 * Gate-1 M-1; COR-001 — no cross-exercise bleed in the UI).
 *
 * The queue is docked in the console and does not remount on a switch. It maps
 * each draft's lead handle to a persona record from `usePersonas()`; before
 * that read was keyed by exercise, after A -> B a draft shown under B was
 * attributed to exercise A's persona record with the same handle. Asserted:
 * after the switch the draft shows B's persona, never A's.
 *
 * Renders through the REAL `ExerciseContextProvider` with
 * `resolveExerciseContext` mocked at its module boundary (same technique as
 * `ControllerConsole.exerciseSwitch.test.tsx`); `api.get('/personas')` answers
 * with the cast of the exercise the "server" is in, every other request passes
 * through to the real client.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { ExerciseContextProvider, useExerciseScopeRefresh } from '@/core/exerciseContext'
import {
  resolveExerciseContext,
  type ExerciseScope,
} from '@/core/exerciseContext/exerciseContextResolver'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import type { Persona } from '@/features/personas'
import { reviewStore } from '../services/reviewStore'
import { ReviewQueue } from './ReviewQueue'

vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

vi.mock('@/core/exerciseContext/exerciseContextResolver', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext/exerciseContextResolver')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)

const EX_A: ExerciseScope = {
  exerciseId: 'ex-a-0001',
  exerciseName: 'Exercise A',
  timeZone: 'UTC',
  status: 'live',
}
const EX_B: ExerciseScope = { ...EX_A, exerciseId: 'ex-b-0002', exerciseName: 'Exercise B' }

/** The seeded draft whose lead persona handle both casts share. */
const DRAFT_ID = 'draft-fulco-reassure'
const SHARED_HANDLE = 'FulcoEM'

function persona(id: string, exerciseId: string, displayName: string): Persona {
  return {
    id,
    exerciseId,
    templateId: `tmpl-${id}`,
    displayName,
    handle: SHARED_HANDLE,
    kind: 'org',
    verified: true,
    avatarColor: '#334455',
    initials: 'FE',
    audienceBand: 'micro',
    followerCount: 1,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

const CASTS: Record<string, Persona[]> = {
  [EX_A.exerciseId]: [persona('persona-a-fulco', EX_A.exerciseId, 'Alpha County EM')],
  [EX_B.exerciseId]: [persona('persona-b-fulco', EX_B.exerciseId, 'Bravo County EM')],
}

/** The exercise the "server" session is in — what `/personas` answers for. */
let serverExerciseId = EX_A.exerciseId

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  resetTelemetryBuffer()
  mockResolve.mockReset()
  serverExerciseId = EX_A.exerciseId

  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation(((url: string, config?: Parameters<typeof api.get>[1]) =>
    url === '/personas'
      ? Promise.resolve({ data: CASTS[serverExerciseId] ?? [] })
      : realGet(url, config)) as typeof api.get)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetExerciseClock()
})

/** Stands in for the exercise switcher: the server moves, then the scope is re-asked. */
function Switcher() {
  const refresh = useExerciseScopeRefresh()
  return (
    <button
      type="button"
      onClick={() => {
        serverExerciseId = EX_B.exerciseId
        void refresh()
      }}
    >
      Switch exercise
    </button>
  )
}

function card(): HTMLElement {
  const element = document.querySelector(`[data-draft-id="${DRAFT_ID}"]`)
  if (!element) throw new Error(`card ${DRAFT_ID} not found`)
  return element as HTMLElement
}

describe('ReviewQueue — persona attribution across an exercise switch (Gate-1 M-1)', () => {
  it('after A -> B the draft shows B\'s persona, not A\'s', async () => {
    const user = userEvent.setup()
    mockResolve.mockResolvedValueOnce(EX_A)
    render(
      <ThemeProvider theme={cobraTheme}>
        <ExerciseContextProvider>
          <Switcher />
          <ReviewQueue />
        </ExerciseContextProvider>
      </ThemeProvider>,
    )
    await waitFor(() => expect(card()).toHaveTextContent('Alpha County EM'), { timeout: 5000 })

    mockResolve.mockResolvedValueOnce(EX_B)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Switch exercise' }))
    })
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(2))

    await waitFor(() => expect(card()).toHaveTextContent('Bravo County EM'), { timeout: 5000 })
    expect(card()).not.toHaveTextContent('Alpha County EM')
  }, 20000)
})
