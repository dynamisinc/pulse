/**
 * core/exerciseContext/exerciseContextRefresh.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the RE-RESOLUTION seam added by staff-navigation/04 (COR-073):
 * `useExerciseScopeRefresh()` — the provider's server-authoritative refresh
 * path. The sibling `exerciseContext.test.tsx` pins the ORIGINAL mount-once
 * contract and is deliberately left untouched: nothing here may weaken it.
 *
 * What is asserted (each one is a property a broken refresh would violate):
 *  - a refresh re-renders every consumer under the NEW scope WITHOUT remounting
 *    them (the whole point — a remount is indistinguishable from a reload for
 *    the staff console's open flyouts / in-progress work);
 *  - the refresh is SERVER-AUTHORITATIVE: it takes no arguments, so a caller
 *    cannot assert which exercise it is now in (COR-001), and it commits
 *    whatever the server returned even when that disagrees with the caller;
 *  - a FAILED refresh fails closed (children unmount, no stale scope served)
 *    rather than silently continuing to serve the pre-refresh exercise — and
 *    fails closed VISIBLY: a world-neutral, announced recovery notice with a
 *    real Reload control, not the white screen it used to be (WR-007);
 *  - only the LATEST attempt may commit (an overlapping/stale refresh cannot
 *    resurrect an older scope);
 *  - PARTICIPANT PATHS ARE UNAFFECTED (COR-004): mounting the provider on a
 *    participant surface resolves exactly once, gains no exercise-selection
 *    capability, and the refresh cannot be steered to another exercise.
 *
 * `resolveExerciseContext()` is mocked at the module boundary (same technique
 * as `exerciseContext.test.tsx`) so each test drives the "server" directly.
 *
 * ## NESTING (CR-001) — the refresher and the consumer are SIBLING SUBTREES
 * Every case below renders the refresher and the scope consumer in SEPARATE
 * subtrees under ONE provider, because that is the shipped shape: the switcher
 * (`ExerciseSwitcherSlot`) is a sibling of `StaffRouteTree`, and the consumer
 * (`StaffHeader`'s badge) is several levels down inside it. The original version
 * of this file put both directly under the provider as flat siblings, which is
 * true of nothing that ships — and that fixture is precisely what let CR-001
 * through: three route compositions each mounted their OWN inner provider, so
 * the refresh committed somewhere the badge could not see, and every test here
 * still passed. `<Distant>` below re-creates the depth. The COMPOSITION-level
 * guard (the real `StaffRouteTree`, the real sibling relationship) lives in
 * `features/app-shell/exerciseScopeRefreshComposition.test.tsx`; this file keeps
 * owning the provider's own semantics.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ExerciseContextProvider,
  useExerciseContext,
  useExerciseScopeRefresh,
} from './exerciseContext'
import { resolveExerciseContext } from './exerciseContextResolver'
import type { ExerciseScope } from './exerciseContextResolver'
import * as ExerciseContextModule from './exerciseContext'

vi.mock('./exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockResolve = vi.mocked(resolveExerciseContext)

const ALPHA: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'America/Chicago',
  status: 'live',
}

const BRAVO: ExerciseScope = {
  exerciseId: 'ex-bravo',
  exerciseName: 'Bravo Exercise',
  timeZone: 'America/Denver',
  status: 'live',
}

/**
 * A staff-header-style consumer: renders the scope's exercise NAME and counts
 * its OWN mounts, so a test can tell "re-rendered under the new scope" apart
 * from "was torn down and rebuilt" (which a reload/remount would also satisfy).
 */
function ScopeBadge({ onMount }: { onMount?: () => void }) {
  const scope = useExerciseContext()
  useEffect(() => {
    onMount?.()
    // Mount-only on purpose: this counts MOUNTS, not renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <span data-testid="scope-badge">{scope.exerciseName}</span>
}

/**
 * Puts its children a few levels DOWN a sibling subtree, the way a staff surface
 * sits inside `StaffRouteTree` rather than directly under the provider. Nothing
 * here reads or re-provides the scope — the depth itself is the point: a
 * consumer must follow a refresh triggered from outside its own subtree.
 */
function Distant({ children }: { children: ReactNode }) {
  return (
    <div data-testid="surface-subtree">
      <div>
        <div>{children}</div>
      </div>
    </div>
  )
}

/** A control that triggers the provider's refresh, as the staff switcher does. */
function RefreshButton({ onSettled }: { onSettled?: (error?: unknown) => void }) {
  const refresh = useExerciseScopeRefresh()
  return (
    <button
      type="button"
      data-testid="refresh"
      onClick={() => {
        void refresh().then(
          () => onSettled?.(),
          (error: unknown) => onSettled?.(error),
        )
      }}
    >
      refresh
    </button>
  )
}

beforeEach(() => {
  mockResolve.mockReset()
})

describe('useExerciseScopeRefresh — the switch actually re-scopes the UI (COR-073)', () => {
  it('re-renders a useExerciseContext() consumer under the NEW exercise, with no remount', async () => {
    const onMount = vi.fn()
    mockResolve.mockResolvedValueOnce(ALPHA).mockResolvedValueOnce(BRAVO)
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <RefreshButton />
        <Distant><ScopeBadge onMount={onMount} /></Distant>
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('scope-badge')).toHaveTextContent('Alpha Exercise')
    expect(onMount).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('refresh'))

    // THE BUG THIS STORY FIXES: before the refresh path existed this stayed
    // 'Alpha Exercise' forever, because the provider resolved once on mount.
    await waitFor(() =>
      expect(screen.getByTestId('scope-badge')).toHaveTextContent('Bravo Exercise'),
    )
    // ...and it got there by RE-RENDERING, not by being torn down and rebuilt.
    expect(onMount).toHaveBeenCalledTimes(1)
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('never unmounts children mid-refresh (no window with the tree gone)', async () => {
    let releaseSecondResolve: ((scope: ExerciseScope) => void) | undefined
    mockResolve.mockResolvedValueOnce(ALPHA).mockReturnValueOnce(
      new Promise<ExerciseScope>(resolve => {
        releaseSecondResolve = resolve
      }),
    )
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <RefreshButton />
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('scope-badge')

    await user.click(screen.getByTestId('refresh'))

    // In flight: the previously-resolved scope keeps rendering. A provider that
    // dropped back to `loading` here would blow away the whole staff console.
    expect(screen.getByTestId('scope-badge')).toHaveTextContent('Alpha Exercise')

    await act(async () => {
      releaseSecondResolve?.(BRAVO)
    })
    expect(screen.getByTestId('scope-badge')).toHaveTextContent('Bravo Exercise')
  })

  it('is SERVER-authoritative: takes no arguments, and commits the server answer', async () => {
    // Arity 0 is structural, not stylistic: a refresh that accepted an
    // exerciseId would let the client assert its own scope — the exact
    // trust inversion COR-001 forbids.
    let captured: (() => Promise<ExerciseScope>) | undefined
    function Capture() {
      const refresh = useExerciseScopeRefresh()
      useEffect(() => {
        captured = refresh
      }, [refresh])
      return null
    }

    // The "server" answers CHARLIE, not whatever a caller might have wanted.
    const CHARLIE: ExerciseScope = { ...BRAVO, exerciseId: 'ex-charlie', exerciseName: 'Charlie' }
    mockResolve.mockResolvedValueOnce(ALPHA).mockResolvedValueOnce(CHARLIE)

    render(
      <ExerciseContextProvider>
        <Capture />
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('scope-badge')

    expect(captured).toBeTypeOf('function')
    expect(captured?.length).toBe(0)

    await act(async () => {
      await captured?.()
    })

    expect(screen.getByTestId('scope-badge')).toHaveTextContent('Charlie')
    // The resolver is called with no client-supplied scope hint either.
    expect(mockResolve).toHaveBeenLastCalledWith()
  })
})

describe('useExerciseScopeRefresh — a failed refresh FAILS CLOSED', () => {
  it('renders nothing rather than continuing to serve the pre-refresh scope', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve
      .mockResolvedValueOnce(ALPHA)
      .mockRejectedValueOnce(new Error('re-resolution failed'))
    const settled = vi.fn()
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <RefreshButton onSettled={settled} />
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('scope-badge')

    await user.click(screen.getByTestId('refresh'))

    await waitFor(() => expect(settled).toHaveBeenCalled())
    // The old exercise is NOT still on screen: we do not know what scope this
    // session is in, so no scope is served and no child is mounted — the whole
    // subtree, refresher included, is gone.
    expect(screen.queryByTestId('scope-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('surface-subtree')).not.toBeInTheDocument()
    expect(screen.queryByTestId('refresh')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha Exercise')).not.toBeInTheDocument()
    // ...and the caller is told, so it can fail closed too.
    expect(settled).toHaveBeenCalledWith(expect.any(Error))
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('does not fail closed SILENTLY: it announces the loss and offers a way back (WR-007, NFR-001)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve
      .mockResolvedValueOnce(ALPHA)
      .mockRejectedValueOnce(new Error('re-resolution failed'))
    const settled = vi.fn()
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <RefreshButton onSettled={settled} />
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('scope-badge')

    await user.click(screen.getByTestId('refresh'))
    await waitFor(() => expect(settled).toHaveBeenCalled())

    // Before WR-007 this was a WHITE SCREEN: the provider returned `null`, which
    // unmounted the app INCLUDING whatever might have reported the failure, and
    // `RootFailClosedBoundary` never fired because nothing threw.
    const notice = screen.getByTestId('exercise-scope-unavailable')
    expect(notice).toHaveAttribute('role', 'alert')
    // Stated in TEXT, not by color (NFR-001) ...
    expect(notice).toHaveTextContent(/session unavailable/i)
    // ... with a real, keyboard-reachable control rather than "guess: reload".
    const reload = screen.getByRole('button', { name: /reload/i })
    expect(reload.tagName).toBe('BUTTON')
    reload.focus()
    expect(reload).toHaveFocus()

    // And it never presents the scope it could not confirm as if it were current.
    expect(notice).not.toHaveTextContent(/Alpha Exercise|Bravo Exercise|ex-alpha/i)

    consoleSpy.mockRestore()
  })

  it('the notice is WORLD-NEUTRAL: no COBRA class, no brand skin on the closed door', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockResolve.mockRejectedValueOnce(new Error('first resolution failed'))

    const { container } = render(
      <ExerciseContextProvider>
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )

    const notice = await screen.findByTestId('exercise-scope-unavailable')
    // `core/` is world-neutral: this panel may be shown to a participant, so it
    // must not carry the staff look (MUI/COBRA emit `Mui*` / `Cobra*` classes)
    // and it cannot carry a brand skin either.
    expect(container.querySelectorAll('[class*="Mui"], [class*="Cobra"]')).toHaveLength(0)
    expect(notice.className).toBe('')

    consoleSpy.mockRestore()
  })
})

describe('useExerciseScopeRefresh — only the latest attempt may commit', () => {
  it('a superseded refresh cannot resurrect the older scope', async () => {
    let releaseFirstRefresh: ((scope: ExerciseScope) => void) | undefined
    mockResolve
      .mockResolvedValueOnce(ALPHA)
      .mockReturnValueOnce(
        new Promise<ExerciseScope>(resolve => {
          releaseFirstRefresh = resolve
        }),
      )
      .mockResolvedValueOnce(BRAVO)
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <RefreshButton />
        <Distant><ScopeBadge /></Distant>
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('scope-badge')

    // Two refreshes overlap; the SECOND one answers first.
    await user.click(screen.getByTestId('refresh'))
    await user.click(screen.getByTestId('refresh'))
    await waitFor(() =>
      expect(screen.getByTestId('scope-badge')).toHaveTextContent('Bravo Exercise'),
    )

    // The stale first refresh now answers with a THIRD exercise; it must be
    // dropped, not committed over the newer answer.
    const STALE: ExerciseScope = { ...ALPHA, exerciseName: 'Stale Exercise' }
    await act(async () => {
      releaseFirstRefresh?.(STALE)
    })

    expect(screen.getByTestId('scope-badge')).toHaveTextContent('Bravo Exercise')
  })
})

describe('participant paths are unaffected (COR-004, XC-002)', () => {
  /**
   * Stands in for a participant surface: it consumes the scope (host/session
   * derived) and re-renders on its own, exactly as a feed would. It has NO
   * switcher, and — critically — nothing gives it one.
   */
  function ParticipantSurface() {
    const scope = useExerciseContext()
    const [tick, setTick] = useState(0)
    return (
      <div data-testid="participant-surface">
        <span data-testid="participant-exercise">{scope.exerciseName}</span>
        <button type="button" data-testid="participant-rerender" onClick={() => setTick(tick + 1)}>
          rerender
        </button>
      </div>
    )
  }

  it('resolves exactly once on a participant mount — the refresh path adds no extra fetches', async () => {
    mockResolve.mockResolvedValue(ALPHA)
    const user = userEvent.setup()

    render(
      <ExerciseContextProvider>
        <ParticipantSurface />
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('participant-exercise')).toHaveTextContent('Alpha Exercise')
    await user.click(screen.getByTestId('participant-rerender'))
    await user.click(screen.getByTestId('participant-rerender'))

    // Mount-once behaviour on the participant path is UNCHANGED: re-resolution
    // happens only when something explicitly asks, and nothing participant-side
    // ever does.
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('participant-exercise')).toHaveTextContent('Alpha Exercise')
  })

  it('grants no exercise-selection capability — the module still exports none (COR-004)', () => {
    const exportNames = Object.keys(ExerciseContextModule).map(name => name.toLowerCase())
    for (const forbidden of ['picker', 'list', 'admin', 'select', 'switch']) {
      expect(exportNames.some(name => name.includes(forbidden))).toBe(false)
    }
  })

  it('cannot be steered: even if a participant surface called it, the server decides', async () => {
    // The scope a participant sees is host/session derived. The refresh re-reads
    // exactly that; it cannot be pointed at another exercise, because there is
    // nowhere to put an exercise id.
    mockResolve.mockResolvedValue(ALPHA)
    let captured: (() => Promise<ExerciseScope>) | undefined
    function ParticipantWithRefresh() {
      const refresh = useExerciseScopeRefresh()
      useEffect(() => {
        captured = refresh
      }, [refresh])
      return <ParticipantSurface />
    }

    render(
      <ExerciseContextProvider>
        <ParticipantWithRefresh />
      </ExerciseContextProvider>,
    )
    await screen.findByTestId('participant-exercise')

    await act(async () => {
      // No argument is even accepted by the type; a runtime attempt is ignored.
      await (captured as ((id?: string) => Promise<ExerciseScope>) | undefined)?.('ex-bravo')
    })

    expect(mockResolve).toHaveBeenLastCalledWith()
    expect(screen.getByTestId('participant-exercise')).toHaveTextContent('Alpha Exercise')
  })
})
