/**
 * features/controller/hooks/usePauseState.scopeSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * #856: the live one-shot pause-tier resync is keyed on the EXERCISE, not a boolean. A staff
 * switch changes `exerciseId` under a console that stays mounted: exercise B's tier must be read
 * from the server (and adopted), whether or not the exercise-scope reset ran before the render.
 * Live path only (the mock flag is off); the GET is mocked.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runExerciseScopeResets } from '@/core/auth/sessionReset'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { fetchPauseTier } from '../services/livePauseTierActions'
import { resetPauseStateForTest, usePauseState } from './usePauseState'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/core/services/api', () => ({ api: { post: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../services/livePauseTierActions', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/livePauseTierActions')>()),
  fetchPauseTier: vi.fn(),
}))

const mockedScope = vi.mocked(useExerciseContext)
const mockedIdentity = vi.mocked(useControllerIdentity)
const mockedFetch = vi.mocked(fetchPauseTier)

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: exerciseId, timeZone: 'UTC', status: 'active' }
}

beforeEach(() => {
  resetPauseStateForTest()
  engineControlStore.resetForTests()
  mockedFetch.mockReset()
  mockedFetch.mockResolvedValue({ tier: 'running', clockFrozen: false })
  mockedScope.mockReturnValue(scopeFor('ex-a'))
  mockedIdentity.mockReturnValue({
    actingHumanId: 'human-1',
    callSign: 'SIMCELL-1',
    role: 'controller',
  })
})

afterEach(() => {
  resetPauseStateForTest()
  engineControlStore.resetForTests()
})

describe('usePauseState - the resync across an exercise switch', () => {
  it('reads the server tier once per exercise: a mounted console re-reads for B (reset first)', async () => {
    const hook = renderHook(() => usePauseState())
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))
    hook.rerender() // same exercise: no second read
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    // The switch commits: the scope reset runs, then the console renders under exercise B.
    runExerciseScopeResets()
    mockedFetch.mockResolvedValue({ tier: 'injects', clockFrozen: false })
    mockedScope.mockReturnValue(scopeFor('ex-b'))
    hook.rerender()

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(hook.result.current.tier).toBe('injects'))
  })

  it('still reads for B when the render happens BEFORE any reset (keyed on the exercise)', async () => {
    const hook = renderHook(() => usePauseState())
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))

    mockedScope.mockReturnValue(scopeFor('ex-b'))
    hook.rerender()

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2))
  })
})
