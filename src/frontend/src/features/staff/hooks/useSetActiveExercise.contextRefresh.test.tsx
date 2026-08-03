/**
 * features/staff/hooks/useSetActiveExercise.contextRefresh.test.tsx
 * ---------------------------------------------------------------------------
 * staff-navigation/04 (COR-073) — the switch→re-scope transition, tested
 * end-to-end against the REAL `ExerciseContextProvider` and a REAL
 * `QueryClient`. Only the two network seams are faked, and they are faked as
 * ONE COHERENT FAKE SERVER (a single `serverActiveExercise` variable that
 * `setActiveExercise` moves and BOTH `resolveExerciseContext` and a scoped
 * query read from). That shared state is the point: a fake server whose halves
 * disagree cannot prove anything about ordering, and mock/live divergence is
 * this codebase's most productive bug class.
 *
 * The three properties under test:
 *  1. THE BUG. After a successful switch, a `useExerciseContext()` consumer —
 *     the staff header's exercise badge, modelled here — shows the NEW exercise
 *     name, without a page reload and without being remounted.
 *  2. THE ORDERING GUARANTEE. No painted frame ever mixes the two exercises:
 *     not new-exercise DATA under the old scope LABEL, not old-exercise data
 *     under the new label. Every render is recorded and every recorded frame is
 *     checked, so this cannot pass by only inspecting the final state.
 *  3. FAIL CLOSED. If the post-switch re-resolve fails, the console does not
 *     keep serving the pre-switch exercise as if the switch never happened —
 *     and it says so, rather than blanking (WR-007).
 *
 * ## NESTING (CR-001) — the switch control is a SIBLING of the surface subtree
 * `renderConsole()` deliberately does NOT put the switch control and the scoped
 * console next to each other under the provider. In the shipped app the switcher
 * (`ExerciseSwitcherSlot`) renders as a sibling of `StaffRouteTree`, and the
 * scope consumer (`StaffHeader`'s badge) lives several levels inside it, so the
 * two share ONLY the hoisted provider. The earlier flat fixture matched no
 * shipped surface and is exactly what hid CR-001 — the three staff route
 * compositions each mounted their own inner provider, the refresh committed into
 * the outer one, and this suite stayed green while the console showed
 * new-exercise data under the old exercise's name. The full composition guard
 * (the real `StaffRouteTree`) is
 * `features/app-shell/exerciseScopeRefreshComposition.test.tsx`; this file owns
 * the ORDERING contract.
 */
import { useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider, useExerciseContext } from '@/core/exerciseContext'
import { resolveExerciseContext } from '@/core/exerciseContext/exerciseContextResolver'
import type { ExerciseScope } from '@/core/exerciseContext'
import { setActiveExercise } from '../services/staffAssignmentsService'
import { StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'
import { useSetActiveExercise } from './useSetActiveExercise'

vi.mock('@/core/exerciseContext/exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

vi.mock('../services/staffAssignmentsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/staffAssignmentsService')>()
  return { ...actual, setActiveExercise: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)
const mockSetActiveExercise = vi.mocked(setActiveExercise)

type ExerciseKey = 'alpha' | 'bravo'

const SCOPES: Record<ExerciseKey, ExerciseScope> = {
  alpha: {
    exerciseId: 'ex-alpha',
    exerciseName: 'Alpha Exercise',
    timeZone: 'UTC',
    status: 'live',
  },
  bravo: {
    exerciseId: 'ex-bravo',
    exerciseName: 'Bravo Exercise',
    timeZone: 'UTC',
    status: 'live',
  },
}

const ASSIGNMENTS: Record<ExerciseKey, StaffAssignment> = {
  alpha: { exerciseId: 'ex-alpha', exerciseName: 'Alpha Exercise', role: 'controller' },
  bravo: { exerciseId: 'ex-bravo', exerciseName: 'Bravo Exercise', role: 'controller' },
}

/**
 * FAKE NETWORK LATENCY — a real macrotask, not `Promise.resolve()`.
 *
 * This is load-bearing, not decoration. With instantly-resolving fakes the
 * entire switch transition collapses into one uninterrupted microtask chain,
 * React never gets a chance to render mid-transition, and the "no mixed frame"
 * assertion below passes for ANY ordering — a vacuous test. A timer-backed
 * delay puts a real render boundary between each step, which is exactly where
 * a mixed frame would be painted in a browser. (Verified by neutering: with
 * instant fakes, moving the cache reset before the scope commit still passed;
 * with this delay it fails, as it must.)
 */
function afterNetwork<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => setTimeout(() => resolve(value), 5))
}

/** THE FAKE SERVER'S SESSION STATE — the one thing both seams read. */
let serverActiveExercise: ExerciseKey = 'alpha'
/** Fails the NEXT `/exercise-context` read, to exercise the fail-closed path. */
let failNextResolve = false

/**
 * Ordered log of the transition's steps ('cancel' | 'resolve' | 'reset'), so
 * the documented cancel → re-resolve → reset order is pinned directly and not
 * only through its (latency-dependent) visible symptoms.
 */
let stepLog: string[] = []

/** Frames recorded during render: [exercise label, scoped data] per paint. */
let frames: Array<{ label: string; data: string }> = []
/** How many times the badge consumer MOUNTED (a reload/remount would bump it). */
let badgeMounts = 0

/**
 * A staff-header-style consumer plus one exercise-scoped React Query read,
 * rendered TOGETHER so a mixed frame is observable. Records every render.
 */
function ScopedConsole() {
  const scope = useExerciseContext()
  const scopedQuery = useQuery({
    queryKey: ['scoped-console-data'],
    // Server-scoped read: the server answers for whichever exercise the
    // SESSION is currently bound to, exactly as an exercise-scoped API does.
    queryFn: () => afterNetwork(`${serverActiveExercise}-data`),
  })

  const data = scopedQuery.data ?? '(no data)'
  frames.push({ label: scope.exerciseName, data })

  useEffect(() => {
    badgeMounts += 1
  }, [])

  return (
    <div>
      <span data-testid="scope-label">{scope.exerciseName}</span>
      <span data-testid="scoped-data">{data}</span>
    </div>
  )
}

/**
 * Stands in for `StaffRouteTree`: it puts the staff surface a few levels down a
 * SIBLING subtree of the switch control, which is the shipped relationship (see
 * the module header). It neither reads nor re-provides the scope — the depth and
 * the sibling split are the whole point.
 */
function SurfaceSubtree({ children }: { children: ReactNode }) {
  return (
    <div data-testid="surface-subtree">
      <div>
        <div>{children}</div>
      </div>
    </div>
  )
}

/**
 * Captured `mutateAsync`. Needed because a fail-closed refresh UNMOUNTS the
 * whole provider subtree — including this control — so `mutate(…, {onError})`
 * observer callbacks are not a reliable way to observe the outcome. The
 * mutation's own promise settles regardless of who is still mounted.
 */
let switchToBravo: (() => Promise<StaffAssignment>) | undefined

/** The switch control, driving the real `useSetActiveExercise`. */
function SwitchControl() {
  const mutation = useSetActiveExercise()
  const { mutateAsync } = mutation
  useEffect(() => {
    switchToBravo = () => mutateAsync('ex-bravo')
  }, [mutateAsync])
  return (
    <button
      type="button"
      data-testid="switch"
      onClick={() => {
        void mutation.mutateAsync('ex-bravo').catch(() => {})
      }}
    >
      switch
    </button>
  )
}

function renderConsole() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  // Log-and-call-through, so the real cache behaviour is unchanged while the
  // step ORDER becomes assertable.
  const cancelQueries = queryClient.cancelQueries.bind(queryClient)
  vi.spyOn(queryClient, 'cancelQueries').mockImplementation((filters, options) => {
    stepLog.push('cancel')
    return cancelQueries(filters, options)
  })
  const resetQueries = queryClient.resetQueries.bind(queryClient)
  vi.spyOn(queryClient, 'resetQueries').mockImplementation((filters, options) => {
    stepLog.push('reset')
    return resetQueries(filters, options)
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    )
  }
  return render(
    // The SHIPPED shape: switcher first, then the surface subtree — siblings
    // sharing only the hoisted provider (see the module header).
    <>
      <SwitchControl />
      <SurfaceSubtree>
        <ScopedConsole />
      </SurfaceSubtree>
    </>,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  serverActiveExercise = 'alpha'
  failNextResolve = false
  frames = []
  stepLog = []
  badgeMounts = 0
  switchToBravo = undefined
  mockResolve.mockReset()
  mockSetActiveExercise.mockReset()

  // GET /exercise-context — answers for the session's CURRENT server-side scope.
  mockResolve.mockImplementation(async () => {
    stepLog.push('resolve')
    const shouldFail = failNextResolve
    failNextResolve = false
    const scope = await afterNetwork(SCOPES[serverActiveExercise])
    if (shouldFail) throw new Error('exercise-context read failed')
    return scope
  })

  // POST /staff/active-exercise — MOVES the fake server's session scope.
  mockSetActiveExercise.mockImplementation((exerciseId: string) => {
    const key: ExerciseKey | undefined = (Object.keys(SCOPES) as ExerciseKey[]).find(
      candidate => SCOPES[candidate].exerciseId === exerciseId,
    )
    if (key === undefined) {
      return Promise.reject(new StaffAssignmentError('not assigned', { status: 403 }))
    }
    serverActiveExercise = key
    return afterNetwork(ASSIGNMENTS[key])
  })
})

describe('useSetActiveExercise — a switch re-scopes every useExerciseContext() consumer (COR-073)', () => {
  it('shows the NEW exercise name after the switch, with no reload and no remount', async () => {
    const user = userEvent.setup()
    renderConsole()

    expect(await screen.findByTestId('scope-label')).toHaveTextContent('Alpha Exercise')
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('alpha-data'))
    expect(badgeMounts).toBe(1)

    await user.click(screen.getByTestId('switch'))

    // THE BUG: before this story the label stayed 'Alpha Exercise' forever while
    // the data underneath it silently became Bravo's.
    await waitFor(() => expect(screen.getByTestId('scope-label')).toHaveTextContent('Bravo Exercise'))
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('bravo-data'))
    // ...and the consumer was never torn down to get there.
    expect(badgeMounts).toBe(1)
  })

  it('never paints a mixed frame: no new data under the old scope, no old data under the new', async () => {
    const user = userEvent.setup()
    renderConsole()

    await screen.findByTestId('scope-label')
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('alpha-data'))

    await user.click(screen.getByTestId('switch'))
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('bravo-data'))

    const mixed = frames.filter(
      frame =>
        (frame.label === 'Alpha Exercise' && frame.data === 'bravo-data') ||
        (frame.label === 'Bravo Exercise' && frame.data === 'alpha-data'),
    )
    expect(mixed).toEqual([])
    // Sanity: the recorder actually saw the transition (otherwise "no mixed
    // frames" would be vacuously true).
    expect(frames.some(frame => frame.label === 'Alpha Exercise')).toBe(true)
    expect(frames.some(frame => frame.label === 'Bravo Exercise')).toBe(true)
    expect(frames.some(frame => frame.data === 'bravo-data')).toBe(true)
  })

  it('runs the transition in the documented order: cancel → re-resolve → reset', async () => {
    renderConsole()
    await screen.findByTestId('scope-label')
    // Drop the mount-time resolve; only the switch transition is under test.
    stepLog = []

    await act(async () => {
      await switchToBravo?.()
    })

    // `cancel` first (no prior-scope request may still land), `resolve` before
    // `reset` (the new scope must be committed before any refetch can answer
    // under it). Each of the three is a distinct correctness step — dropping
    // any one of them changes this sequence.
    expect(stepLog).toEqual(['cancel', 'resolve', 'reset'])
  })

  it('resolves the mutation only AFTER the new scope is committed (success means re-scoped)', async () => {
    renderConsole()
    await screen.findByTestId('scope-label')

    await act(async () => {
      await switchToBravo?.()
    })

    // The instant the switch mutation resolves, the re-scope has already
    // happened — nobody can act on a "switched!" signal that is not yet true.
    expect(screen.getByTestId('scope-label')).toHaveTextContent('Bravo Exercise')
  })
})

describe('useSetActiveExercise — a failed post-switch re-resolve fails closed', () => {
  it('does not keep serving the pre-switch exercise', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderConsole()

    await screen.findByTestId('scope-label')
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('alpha-data'))

    // The switch itself will succeed; the follow-up scope read will not.
    failNextResolve = true
    let reportedError: unknown
    await act(async () => {
      await switchToBravo?.().catch((error: unknown) => {
        reportedError = error
      })
    })

    // Nothing rendered under an unconfirmed scope — not the old exercise, not
    // a guessed new one. The whole surface subtree is gone.
    expect(screen.queryByTestId('scope-label')).not.toBeInTheDocument()
    expect(screen.queryByTestId('surface-subtree')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha Exercise')).not.toBeInTheDocument()
    expect(screen.queryByText('Bravo Exercise')).not.toBeInTheDocument()
    // The caller is told, with an error that names the situation.
    expect(reportedError).toBeInstanceOf(StaffAssignmentError)
    expect((reportedError as StaffAssignmentError).message).toMatch(/could not be re-resolved/i)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('tells the human, instead of blanking the console (WR-007, NFR-001)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderConsole()

    await screen.findByTestId('scope-label')
    await waitFor(() => expect(screen.getByTestId('scoped-data')).toHaveTextContent('alpha-data'))

    failNextResolve = true
    await act(async () => {
      await switchToBravo?.().catch(() => {})
    })

    // The mutation's own error cannot be the user-facing message: the switch
    // control that called it has been unmounted along with everything else.
    expect(screen.queryByTestId('switch')).not.toBeInTheDocument()
    // So the provider's recovery notice is what the staff member actually gets —
    // previously this was a white screen with nothing to click.
    const notice = screen.getByTestId('exercise-scope-unavailable')
    expect(notice).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    // ...and it never names an exercise it could not confirm.
    expect(notice).not.toHaveTextContent(/Alpha Exercise|Bravo Exercise/i)

    consoleSpy.mockRestore()
  })
})
