/**
 * core/exerciseContext.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the story-10 acceptance criteria for the Wave-0 mock
 * ExerciseContextProvider seam (COR-001, COR-004 / XC-001, XC-002):
 *
 *   - useExerciseContext() outside a provider throws (fail-closed).
 *   - Inside a provider it returns exactly one scope object with
 *     exerciseId/exerciseName/timeZone/status.
 *   - A failed or pending mock resolution never renders a default, unscoped,
 *     or aggregate scope - the provider renders nothing until (and unless) it
 *     resolves.
 *   - No exercise list, picker, or admin surface is exposed from the module.
 *
 * `resolveExerciseContext()` is mocked at the module boundary so these tests
 * exercise the provider's state machine directly, independent of the
 * resolver's own validation logic (covered in exerciseContextResolver.test.ts).
 */
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExerciseContextProvider, useExerciseContext } from './exerciseContext'
import { resolveExerciseContext } from './exerciseContextResolver'
import type { ExerciseScope } from './exerciseContextResolver'
import * as ExerciseContextModule from './exerciseContext'

vi.mock('./exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockResolve = vi.mocked(resolveExerciseContext)

const FIXTURE: ExerciseScope = {
  exerciseId: 'ex-test-0001',
  exerciseName: 'Test Exercise',
  timeZone: 'America/Chicago',
  status: 'active',
}

/** Renders whatever scope the current provider exposes, for assertion. */
function Probe() {
  const scope = useExerciseContext()
  return (
    <div data-testid="probe">
      <span data-testid="exerciseId">{scope.exerciseId}</span>
      <span data-testid="exerciseName">{scope.exerciseName}</span>
      <span data-testid="timeZone">{scope.timeZone}</span>
      <span data-testid="status">{scope.status}</span>
    </div>
  )
}

describe('useExerciseContext outside a provider', () => {
  it('throws rather than returning undefined, a default, or an aggregate scope', () => {
    // React logs a caught render error to console.error; expected here since
    // there is no error boundary in the test - suppress the noise.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow(/ExerciseContextProvider/)

    consoleSpy.mockRestore()
  })
})

describe('ExerciseContextProvider', () => {
  beforeEach(() => {
    mockResolve.mockReset()
  })

  it('resolves and exposes exactly one scope with exerciseId/exerciseName/timeZone/status', async () => {
    mockResolve.mockResolvedValue(FIXTURE)

    render(
      <ExerciseContextProvider>
        <Probe />
      </ExerciseContextProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    expect(screen.getByTestId('exerciseId')).toHaveTextContent(FIXTURE.exerciseId)
    expect(screen.getByTestId('exerciseName')).toHaveTextContent(FIXTURE.exerciseName)
    expect(screen.getByTestId('timeZone')).toHaveTextContent(FIXTURE.timeZone)
    expect(screen.getByTestId('status')).toHaveTextContent(FIXTURE.status)
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while resolution is pending (no default/unscoped scope in the interim)', () => {
    // A promise that never settles within this test - only the synchronous,
    // pre-resolution render state is under test here.
    mockResolve.mockReturnValue(new Promise<ExerciseScope>(() => {}))

    const { container } = render(
      <ExerciseContextProvider>
        <Probe />
      </ExerciseContextProvider>,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it('fails closed - renders nothing - when the mock resolution rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve.mockRejectedValue(new Error('mock resolution failed'))

    const { container } = render(
      <ExerciseContextProvider>
        <Probe />
      </ExerciseContextProvider>,
    )

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('never falls back to a default/aggregate scope when resolution yields no scope', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Simulates the resolver's own "empty scope" failure mode reaching the
    // provider as a rejection - the provider has no fallback path of its own.
    mockResolve.mockRejectedValue(new Error('empty or malformed scope'))

    render(
      <ExerciseContextProvider>
        <Probe />
      </ExerciseContextProvider>,
    )

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})

describe('module surface', () => {
  it('exposes only the single-scope provider + hook - no list, picker, or admin export', () => {
    expect(Object.keys(ExerciseContextModule).sort()).toEqual(
      ['ExerciseContextProvider', 'useExerciseContext'].sort(),
    )
  })

  it('returns a single bound scope object, never a collection', async () => {
    mockResolve.mockResolvedValue(FIXTURE)
    let observed: ExerciseScope | undefined

    function Capture() {
      const scope = useExerciseContext()
      useEffect(() => {
        observed = scope
      }, [scope])
      return null
    }

    render(
      <ExerciseContextProvider>
        <Capture />
      </ExerciseContextProvider>,
    )

    await waitFor(() => expect(observed).toBeDefined())
    expect(Array.isArray(observed)).toBe(false)
    expect(observed).toEqual(FIXTURE)
  })
})
