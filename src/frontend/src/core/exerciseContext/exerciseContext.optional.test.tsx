/**
 * core/exerciseContext/exerciseContext.optional.test.tsx
 * ---------------------------------------------------------------------------
 * `useOptionalExerciseContext()` (demo-feedback 24 Gate-1 S-1): the non-throwing
 * read of the bound scope, used only as a client-side cache key (the persona
 * reads). Asserted:
 *  - outside a provider it returns `undefined` and does NOT throw (unlike
 *    `useExerciseContext()`, which still does — fail-closed is unchanged);
 *  - inside a provider it returns the same scope `useExerciseContext()` does,
 *    and follows an in-place refresh to the new exercise;
 *  - the barrel exports it.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Barrel from '.'
import {
  ExerciseContextProvider,
  useExerciseContext,
  useExerciseScopeRefresh,
  useOptionalExerciseContext,
} from './exerciseContext'
import { resolveExerciseContext, type ExerciseScope } from './exerciseContextResolver'

vi.mock('./exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockResolve = vi.mocked(resolveExerciseContext)

const ALPHA: ExerciseScope = {
  exerciseId: 'ex-alpha-0001',
  exerciseName: 'Alpha',
  timeZone: 'UTC',
  status: 'live',
}
const BRAVO: ExerciseScope = { ...ALPHA, exerciseId: 'ex-bravo-0002', exerciseName: 'Bravo' }

beforeEach(() => {
  mockResolve.mockReset()
})

/** Renders both reads side by side, plus a refresh trigger. */
function Probe() {
  const optional = useOptionalExerciseContext()
  const required = useExerciseContext()
  const refresh = useExerciseScopeRefresh()
  return (
    <>
      <span data-testid="optional">{optional?.exerciseId ?? 'none'}</span>
      <span data-testid="required">{required.exerciseId}</span>
      <button type="button" onClick={() => void refresh()}>refresh</button>
    </>
  )
}

describe('useOptionalExerciseContext', () => {
  it('returns undefined outside a provider, without throwing', () => {
    const { result } = renderHook(() => useOptionalExerciseContext())
    expect(result.current).toBeUndefined()
    // The fail-closed hook is unchanged.
    expect(() => renderHook(() => useExerciseContext())).toThrow(/ExerciseContextProvider/)
  })

  it('returns the bound scope inside a provider and follows an in-place refresh', async () => {
    mockResolve.mockResolvedValueOnce(ALPHA)
    render(
      <ExerciseContextProvider>
        <Probe />
      </ExerciseContextProvider>,
    )
    expect(await screen.findByTestId('optional')).toHaveTextContent(ALPHA.exerciseId)
    expect(screen.getByTestId('required')).toHaveTextContent(ALPHA.exerciseId)

    mockResolve.mockResolvedValueOnce(BRAVO)
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('optional')).toHaveTextContent(BRAVO.exerciseId))
    expect(screen.getByTestId('required')).toHaveTextContent(BRAVO.exerciseId)
  })

  it('is exported from the core/exerciseContext barrel', () => {
    expect(Barrel.useOptionalExerciseContext).toBe(useOptionalExerciseContext)
  })
})
