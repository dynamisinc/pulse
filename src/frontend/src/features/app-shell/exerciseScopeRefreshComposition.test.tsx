/**
 * features/app-shell/exerciseScopeRefreshComposition.test.tsx
 * ---------------------------------------------------------------------------
 * THE COMPOSITION-LEVEL GUARD for the exercise-scope refresh (staff-navigation/04
 * AC1, COR-073) — CR-001's regression test.
 *
 * ## Why this file exists (and why a single-provider fixture is not enough)
 * `useExerciseScopeRefresh()` resolves through REACT CONTEXT, so which provider
 * it reaches is decided ENTIRELY by the shipped nesting — not by anything either
 * the hook or the switcher can see. The shipped nesting is:
 *
 *     ExerciseContextProvider            (routes.tsx — the ONE provider)
 *       > SessionProvider > RoleAwareEntry
 *         > StaffWorldHandoff
 *           ├─ ExerciseSwitcherSlot      ← calls the refresh, a SIBLING…
 *           └─ StaffRouteTree            ← …of the tree the surfaces live in
 *                > <surface>             ← StaffHeader's exercise badge is HERE
 *
 * The switcher and the badge are therefore in DIFFERENT subtrees, sharing only
 * the hoisted provider. Every earlier test of this AC mounted ONE provider with
 * both the refresher and the consumer directly under it, which is true of no
 * shipped surface — and so passed happily while the real console was broken:
 * each staff route composition mounted its OWN inner `ExerciseContextProvider`,
 * the refresh committed into the OUTER one, and because a refresh deliberately
 * never remounts ("atomic commit, no remount"), the inner provider served the
 * PRE-switch scope forever. Meanwhile `useSetActiveExercise`'s step 3
 * (`resetQueries()`) refetched every surface under the NEW server scope: the
 * console rendered new-exercise data beneath the old exercise's header badge —
 * exactly failure mode (a) that hook's header claims to forbid.
 *
 * So the assertions below mount the REAL `StaffRouteTree` with a real registry
 * entry whose element consumes `useExerciseContext()`, and trigger the refresh
 * from a SIBLING of the tree. Nothing here is a fixture wrapper standing in for
 * the composition; the sibling relationship IS the thing under test.
 *
 * ## Non-vacuity (verified by neutering)
 * Wrapping the registry entry's element in its own `<ExerciseContextProvider>` —
 * i.e. restoring exactly what the three `*Route.tsx` compositions used to do —
 * makes the first case FAIL (`badge` stays on "Alpha Exercise"). The last
 * describe closes the loop mechanically: it scans the real source of every
 * `features/<x>/<Y>Route.tsx` and fails if any of them mounts a provider again,
 * with `routes.tsx` as the positive control that proves the scanner bites.
 *
 * World: staff routing glue. No COBRA and no participant skin is mounted here —
 * `StaffRouteTree` itself imports neither (the hand-off above it owns the theme).
 */
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { faFlask } from '@fortawesome/free-solid-svg-icons'
import {
  ExerciseContextProvider,
  useExerciseContext,
  useExerciseScopeRefresh,
} from '@/core/exerciseContext'
import { resolveExerciseContext } from '@/core/exerciseContext/exerciseContextResolver'
import type { ExerciseScope } from '@/core/exerciseContext'
import { StaffRouteTree } from './StaffRouteTree'
import type { StaffRouteRegistry } from './staffRouting'

vi.mock('@/core/exerciseContext/exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockResolve = vi.mocked(resolveExerciseContext)

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

/** The fake server's session scope — what the switcher moves and the resolver reads. */
let serverActiveExercise: ExerciseKey = 'alpha'

/** How many times the in-surface consumer MOUNTED (a remount would bump it). */
let badgeMounts = 0

/**
 * Stands in for `StaffHeader`'s exercise identity badge: a `useExerciseContext()`
 * consumer rendered INSIDE a staff surface, i.e. inside `StaffRouteTree`.
 */
function SurfaceScopeBadge() {
  const scope = useExerciseContext()
  useEffect(() => {
    badgeMounts += 1
  }, [])
  return <span data-testid="surface-scope-badge">{scope.exerciseName}</span>
}

/**
 * Stands in for `ExerciseSwitcherSlot`: staff chrome that is a SIBLING of the
 * route tree and triggers the server-authoritative refresh, exactly as
 * `useSetActiveExercise`'s step 2 does after a successful POST.
 */
function SwitcherSibling() {
  const refresh = useExerciseScopeRefresh()
  return (
    <button
      type="button"
      data-testid="switcher"
      onClick={() => {
        // The POST has already moved the server's session scope; the client only
        // asks the server what its scope now is (COR-001).
        serverActiveExercise = 'bravo'
        void refresh().catch(() => {})
      }}
    >
      switch
    </button>
  )
}

/**
 * The registry entry's `element` — what a real `*Route.tsx` composition supplies.
 * `wrapInOwnProvider` reproduces the CR-001 defect on demand, so the neuter is a
 * flag rather than a hand edit (and the "…and this test can detect it" case below
 * keeps that neuter permanently exercised).
 */
function surfaceElement(wrapInOwnProvider: boolean) {
  const surface = <SurfaceScopeBadge />
  return wrapInOwnProvider
    ? <ExerciseContextProvider>{surface}</ExerciseContextProvider>
    : surface
}

function registryFor(wrapInOwnProvider: boolean): StaffRouteRegistry {
  return [
    {
      id: 'probe-surface',
      path: '/staff/probe',
      label: 'Probe Surface',
      icon: faFlask,
      element: surfaceElement(wrapInOwnProvider),
      allowedRoles: ['planner'],
      isDefaultFor: ['planner'],
      group: 'plan',
    },
  ]
}

/**
 * Mounts the SHIPPED shape: one hoisted provider, with the switcher and the staff
 * route tree as siblings beneath it.
 */
function renderStaffWorld({ nestedProvider = false } = {}) {
  return render(
    <MemoryRouter initialEntries={['/staff/probe']}>
      <ExerciseContextProvider>
        <SwitcherSibling />
        <StaffRouteTree
          routes={registryFor(nestedProvider)}
          role="planner"
          defaultPath="/staff/probe"
        />
      </ExerciseContextProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  serverActiveExercise = 'alpha'
  badgeMounts = 0
  mockResolve.mockReset()
  // A real macrotask, not `Promise.resolve()`: it puts a genuine render boundary
  // between the request and the commit, so "the badge followed" cannot be an
  // artefact of everything collapsing into one microtask chain.
  mockResolve.mockImplementation(
    () =>
      new Promise<ExerciseScope>(resolve =>
        setTimeout(() => resolve(SCOPES[serverActiveExercise]), 5),
      ),
  )
})

describe('exercise-scope refresh, in the SHIPPED composition (staff-navigation/04 AC1, COR-073)', () => {
  it('a refresh from a SIBLING of StaffRouteTree re-scopes a consumer INSIDE a staff surface', async () => {
    const user = userEvent.setup()
    renderStaffWorld()

    expect(await screen.findByTestId('surface-scope-badge')).toHaveTextContent('Alpha Exercise')
    expect(badgeMounts).toBe(1)

    await user.click(screen.getByTestId('switcher'))

    // CR-001: with a per-surface `ExerciseContextProvider` this stayed on
    // "Alpha Exercise" indefinitely, while the surface's own queries were being
    // reset and refetched under Bravo.
    await waitFor(() =>
      expect(screen.getByTestId('surface-scope-badge')).toHaveTextContent('Bravo Exercise'),
    )
    // ...and it got there by re-rendering, never by being torn down (an open
    // flyout / in-progress form must survive a switch).
    expect(badgeMounts).toBe(1)
  })

  it('resolves the scope exactly ONCE per switch — no second provider re-resolving alongside', async () => {
    const user = userEvent.setup()
    renderStaffWorld()

    await screen.findByTestId('surface-scope-badge')
    expect(mockResolve).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('switcher'))
    await waitFor(() =>
      expect(screen.getByTestId('surface-scope-badge')).toHaveTextContent('Bravo Exercise'),
    )

    // One mount resolve + one refresh resolve. A duplicated provider would show
    // up here as an extra mount-time read even before it broke the badge.
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('...and this test can actually detect the defect: a per-surface provider strands the badge', async () => {
    const user = userEvent.setup()
    // THE NEUTER, kept permanently green-side-up: restore what the three
    // `*Route.tsx` compositions used to do and the badge stops following.
    renderStaffWorld({ nestedProvider: true })

    expect(await screen.findByTestId('surface-scope-badge')).toHaveTextContent('Alpha Exercise')

    await user.click(screen.getByTestId('switcher'))
    // The outer provider HAS re-resolved (Bravo) — the refresh itself works…
    await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(3))

    // …but the surface, served by its own provider, never hears about it. This
    // is the shipped-console symptom the first case above forbids.
    expect(screen.getByTestId('surface-scope-badge')).toHaveTextContent('Alpha Exercise')
  })
})

/**
 * Strips comments so a file that merely DOCUMENTS the ban does not trip it —
 * the three route compositions each explain at length why they no longer mount
 * a provider.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every staff route composition, by convention `features/<x>/<Y>Route.tsx`. */
const routeCompositionSources: Record<string, string> = import.meta.glob(
  '../*/*Route.tsx',
  { eager: true, query: '?raw', import: 'default' },
)

/** The positive control: the ONE file that is SUPPOSED to mount the provider. */
const hoistedProviderSource: Record<string, string> = import.meta.glob(
  './routes.tsx',
  { eager: true, query: '?raw', import: 'default' },
)

const MOUNTS_PROVIDER = /<ExerciseContextProvider\b/

describe('exactly one ExerciseContextProvider is mounted (CR-001, mechanical)', () => {
  it('scans the real source of every staff route composition (cannot vacuously pass)', () => {
    // Three today; a fourth staff surface is covered automatically by the glob.
    expect(Object.keys(routeCompositionSources).length).toBeGreaterThanOrEqual(3)
  })

  it('the scanner bites: it FINDS the provider mount in routes.tsx, where it belongs', () => {
    const sources = Object.values(hoistedProviderSource)
    expect(sources).toHaveLength(1)
    for (const source of sources) {
      expect(MOUNTS_PROVIDER.test(stripComments(source))).toBe(true)
    }
  })

  it('no staff route composition mounts an ExerciseContextProvider of its own', () => {
    const offenders = Object.entries(routeCompositionSources)
      .filter(([, source]) => MOUNTS_PROVIDER.test(stripComments(source)))
      .map(([file]) => file)

    if (offenders.length > 0) {
      throw new Error(
        'A staff route composition mounts its own <ExerciseContextProvider>. The cross-exercise '
        + 'switcher is a SIBLING of StaffRouteTree, so it refreshes the HOISTED provider '
        + '(routes.tsx) and that commit never reaches a nested one — the surface would render '
        + `post-switch data under the pre-switch exercise name (CR-001):\n  ${offenders.join('\n  ')}`,
      )
    }
    expect(offenders).toEqual([])
  })
})
