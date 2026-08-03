/**
 * core/exerciseContext.tsx
 * ---------------------------------------------------------------------------
 * Wave-0 foundation seam: the single-exercise scope every participant-facing
 * module needs before it can render anything (COR-001, COR-004; see
 * docs/features/exercise-isolation/10-exercise-context-provider-mock.md).
 *
 * `ExerciseContextProvider` resolves exactly ONE exercise's scope via the
 * mock `resolveExerciseContext()` (`./exerciseContextResolver.ts`, itself
 * routed through the shared axios client) and exposes it through
 * `useExerciseContext()`.
 *
 * Fail-closed, by construction:
 *   - No provider mounted            -> useExerciseContext() THROWS.
 *   - Resolution in flight           -> the provider renders nothing (no
 *                                        children are mounted, so nothing can
 *                                        call the hook) until a scope
 *                                        resolves.
 *   - Resolution fails / empty scope -> NO CHILD IS MOUNTED and no default,
 *                                        unscoped, or aggregate scope is ever
 *                                        produced. The provider renders only
 *                                        the recovery notice below (WR-007) —
 *                                        which carries no scope at all.
 *
 * ## WHY THE ERROR STATE IS NOT A BLANK PAGE (WR-007, NFR-001)
 * Failing closed is right; failing closed SILENTLY is not. This provider sits
 * above the whole app (`features/app-shell/routes.tsx`), so `error` -> `null`
 * unmounted every surface AND every control that could have reacted — including
 * the switcher mutation's own caller. `RootFailClosedBoundary` (a React error
 * boundary, inside these children) only catches THROWS, so nothing redirected
 * and nothing rendered: a white screen the user had to guess their way out of.
 * The `error` branch therefore renders `ExerciseScopeUnavailable` — a minimal,
 * WORLD-NEUTRAL `role="alert"` panel with a real Reload control. It is
 * deliberately plain HTML: no COBRA (this must never leak the staff look onto a
 * participant path) and no brand skin (this module cannot know the brand), and
 * it states the situation in TEXT, never by color. It exposes NO exercise
 * identity — a scope we could not confirm must not be presented as current.
 *
 * There is no exercise list, no picker, and no simulation-status/admin
 * surface here (COR-004, XC-002) - `useExerciseContext()` returns exactly one
 * bound scope, never a collection. Story 04 later EXTENDS this same module
 * with host/auth-resolved scope and a participant route guard; it does not
 * replace it.
 *
 * PRECEDENT - this session-scope gate is DELIBERATELY hand-rolled
 * (useState/useEffect), not React Query, even though React Query is the default
 * server-state pattern elsewhere. React Query's cache / staleTime / background
 * refetch / retry fight fail-closed semantics (a failed refetch would keep
 * serving the last scope instead of failing closed). React Query stays the
 * default for ordinary cacheable data; the isolation gate is the exception.
 * `status` is not a render-safety signal (see ExerciseScope) - lifecycle gating
 * is story 04/06.
 *
 * ## RE-RESOLUTION (`useExerciseScopeRefresh`, staff-navigation/04, COR-073)
 * The scope is resolved on mount AND re-resolvable on demand. The staff
 * cross-exercise switcher changes the session's active exercise SERVER-SIDE
 * (`POST /api/staff/active-exercise`); before this hook existed the provider had
 * no way to learn about that, so every `useExerciseContext()` consumer (the
 * staff header's exercise badge above all) kept displaying the PRE-switch
 * exercise until something remounted the tree.
 *
 * `useExerciseScopeRefresh()` returns a zero-argument function that re-runs the
 * SAME server resolution the mount path runs. Three properties make it safe on
 * the isolation seam:
 *
 *  1. SERVER-AUTHORITATIVE. It takes NO arguments - a caller cannot tell this
 *     provider which exercise it is now in, not even the switcher that just
 *     POSTed the id. The server decides; the client only asks again (COR-001).
 *  2. ATOMIC COMMIT, NO REMOUNT. A refresh never returns the provider to
 *     `loading`, so children are NOT unmounted while it is in flight (a
 *     transient `null` would blow away the whole staff console: open flyouts,
 *     in-progress forms, focus). The previously-resolved scope keeps rendering
 *     until the new one lands, then swaps in a SINGLE state commit. It is the
 *     caller's job to order the surrounding cache work around that commit -
 *     see `features/staff/hooks/useSetActiveExercise.ts`, which cancels every
 *     in-flight query BEFORE the refresh and resets the query cache AFTER it,
 *     so no consumer can ever paint new-exercise data under the old scope or
 *     old-exercise data under the new one.
 *  3. STILL FAIL-CLOSED. A refresh that fails does NOT keep serving the old
 *     scope as if nothing had happened - the provider transitions to `error`
 *     and unmounts every child, exactly like a failed first resolution, and the
 *     returned promise rejects so the caller can react. Serving a scope the
 *     server has already moved away from is the failure mode this seam exists
 *     to prevent; a closed door beats a confident lie. The door is a door and
 *     not a void: the closed state renders the recovery notice described above,
 *     so the human is told and given a way out (WR-007).
 *
 * Only the LATEST attempt may commit (a monotonic attempt token), so overlapping
 * refreshes - or a refresh that settles after unmount - can never resurrect an
 * older answer.
 *
 * This does NOT reintroduce React Query semantics: there is no cache, no
 * staleTime, no background refetch, no retry, and no stale-while-revalidate. A
 * refresh happens only when a caller explicitly asks for one.
 *
 * PARTICIPANT WORLD (COR-004): participants mount this same provider, where the
 * scope is host/session-derived and there is no switcher, so nothing on a
 * participant path ever calls the refresh. Even if something did, the refresh
 * takes no arguments and re-reads the same server-resolved scope - it is not,
 * and cannot become, an exercise-selection capability.
 *
 * Deliberately decoupled at v0: this module does not import the
 * scenario-time clock (`core/clock/`) or the telemetry emitter
 * (`core/telemetry/`). `exerciseId` / `timeZone` are exposed on the resolved
 * scope precisely so those seams - and every other consumer - can read them
 * from their own call sites later; this module has no knowledge of either.
 *
 * World: platform/foundation. Pure `core/` module - no UI chrome, no COBRA,
 * no participant skin.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { resolveExerciseContext } from './exerciseContextResolver'
import type { ExerciseScope } from './exerciseContextResolver'

export type { ExerciseScope, ExerciseStatus } from './exerciseContextResolver'

/**
 * Internal resolution state machine. Only the 'ready' case is ever surfaced
 * to consumers via `useExerciseContext()` - see the fail-closed contract in
 * the module header.
 */
type ExerciseContextState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly scope: ExerciseScope }
  | { readonly kind: 'error'; readonly error: unknown }

/**
 * Re-resolves the session's exercise scope FROM THE SERVER and commits the
 * answer atomically.
 *
 * Deliberately takes NO arguments: the caller may ask "what is my scope now?",
 * never assert "my scope is now X" - see the module header's RE-RESOLUTION
 * section. Resolves with the newly-committed scope; REJECTS (after failing the
 * provider closed) when re-resolution fails.
 */
export type ExerciseScopeRefresh = () => Promise<ExerciseScope>

const ExerciseContextInternal = createContext<ExerciseScope | undefined>(undefined)
const ExerciseScopeRefreshContext = createContext<ExerciseScopeRefresh | undefined>(undefined)

/**
 * Field-wise scope equality. A refresh that re-resolves to the SAME exercise
 * keeps the previous scope OBJECT so the context value identity does not
 * change - otherwise every one of the (eventually ~40) consuming surfaces would
 * re-render for a no-op refresh.
 */
function isSameScope(a: ExerciseScope, b: ExerciseScope): boolean {
  return (
    a.exerciseId === b.exerciseId &&
    a.exerciseName === b.exerciseName &&
    a.timeZone === b.timeZone &&
    a.status === b.status
  )
}

export interface ExerciseContextProviderProps {
  children: ReactNode;
}

/**
 * The closed-door notice (WR-007, NFR-001). Rendered INSTEAD OF the children
 * whenever scope resolution has failed — first resolution or post-switch
 * re-resolve alike.
 *
 * Contract, in order of importance:
 *  - it carries NO exercise identity. A scope we could not confirm must never
 *    be shown as if it were current, so there is nothing here to mistake for one;
 *  - it is WORLD-NEUTRAL. Plain HTML with a handful of inline styles: no COBRA
 *    (this seam sits above the participant path — the staff look must not leak
 *    down it) and no brand theme (this module cannot know the brand). Neutral
 *    enough to appear in front of either audience without asserting a world;
 *  - it is ANNOUNCED and RECOVERABLE. `role="alert"` so a screen reader hears
 *    the tree being taken away, and a real, keyboard-reachable `<button>` to
 *    reload — previously the user got a white screen with no stated cause and
 *    no offered action;
 *  - the state is conveyed in TEXT, never by color alone.
 */
function ExerciseScopeUnavailable() {
  return (
    <div
      role="alert"
      data-testid="exercise-scope-unavailable"
      style={{
        maxWidth: '32rem',
        margin: '15vh auto 0',
        padding: '1.5rem',
        border: '1px solid #b0b4bb',
        borderRadius: '8px',
        font: '400 15px/1.5 ui-sans-serif, system-ui, sans-serif',
        color: '#1c1f23',
        background: '#ffffff',
        textAlign: 'left',
      }}
    >
      <p style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Session unavailable</p>
      <p style={{ margin: '0 0 1rem' }}>
        We could not confirm which exercise this session belongs to, so nothing is being
        shown. Reload to try again; if it keeps happening, sign in again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          font: 'inherit',
          fontWeight: 600,
          padding: '0.5rem 1.25rem',
          borderRadius: '6px',
          border: '1px solid #1c1f23',
          background: '#ffffff',
          color: '#1c1f23',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  )
}

/**
 * Resolves and binds the session to a single exercise scope.
 *
 * Renders `children` only once resolution succeeds. Renders nothing while
 * resolving, and nothing if resolution fails - so a descendant can never
 * observe a default, unscoped, or partially-resolved scope (COR-001, XC-001).
 */
export function ExerciseContextProvider({ children }: ExerciseContextProviderProps) {
  const [state, setState] = useState<ExerciseContextState>({ kind: 'loading' })

  // Monotonic attempt token. ONLY the newest attempt may commit, so an
  // overlapping refresh (or one that settles after unmount) can never resurrect
  // an older answer - the classic last-write-wins scope-leak vector.
  const attemptRef = useRef(0)
  const abandonedRef = useRef(false)

  /**
   * Runs ONE server resolution and commits it if (and only if) it is still the
   * newest attempt on a mounted provider. Re-throws so an explicit caller (the
   * refresh) learns the outcome; the failure is already logged + failed closed
   * by the time it re-throws.
   */
  const resolve = useCallback(async (): Promise<ExerciseScope> => {
    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    const mayCommit = () => !abandonedRef.current && attempt === attemptRef.current

    try {
      const scope = await resolveExerciseContext()
      if (mayCommit()) {
        // Atomic swap: one commit, no intervening `loading`, so children are
        // never unmounted by a refresh (see the module header).
        setState(previous =>
          previous.kind === 'ready' && isSameScope(previous.scope, scope)
            ? previous
            : { kind: 'ready', scope },
        )
      }
      return scope
    } catch (error) {
      if (mayCommit()) {
        // Wave-0 has no UI/telemetry surface to report this through; a
        // console signal beats silence. A FAILED REFRESH lands here too: the
        // provider goes closed rather than continuing to serve a scope the
        // server may already have moved away from.
        console.error('[exerciseContext] resolveExerciseContext failed; failing closed', error)
        setState({ kind: 'error', error })
      }
      throw error
    }
  }, [])

  useEffect(() => {
    abandonedRef.current = false

    // The mount resolution's rejection is already handled inside `resolve`
    // (logged + failed closed); swallow it here so it is not ALSO an unhandled
    // rejection. Only an explicit refresh caller awaits the thrown error.
    void resolve().catch(() => {})

    return () => {
      abandonedRef.current = true
    }
  }, [resolve])

  // Still resolving: render NOTHING. No child is mounted, so nothing can read a
  // half-resolved scope, and there is nothing to announce yet either.
  if (state.kind === 'loading') return null

  // Closed: no child is mounted here either — only the recovery notice, which
  // carries no scope. See the module header (WR-007) for why this is not `null`.
  if (state.kind === 'error') return <ExerciseScopeUnavailable />

  return (
    <ExerciseScopeRefreshContext.Provider value={resolve}>
      <ExerciseContextInternal.Provider value={state.scope}>
        {children}
      </ExerciseContextInternal.Provider>
    </ExerciseScopeRefreshContext.Provider>
  )
}

/**
 * Returns the single bound exercise scope for the current session.
 *
 * Throws when called outside an `ExerciseContextProvider` (fail-closed -
 * COR-001, COR-004). Never returns `undefined`, a default scope, or a
 * collection.
 */
// Provider + hook intentionally colocated in one module (story 10); same
// rationale as the `**/contexts/**` override in eslint.config.js.
// eslint-disable-next-line react-refresh/only-export-components
export function useExerciseContext(): ExerciseScope {
  const scope = useContext(ExerciseContextInternal)
  if (scope === undefined) {
    throw new Error(
      'useExerciseContext() must be called within an <ExerciseContextProvider>. ' +
      'There is no default or aggregate exercise scope (COR-001, COR-004).',
    )
  }
  return scope
}

/**
 * Returns the provider's server-authoritative re-resolution function
 * (staff-navigation/04, COR-073).
 *
 * Call it after something has changed the session's active exercise SERVER-SIDE
 * (today: the staff cross-exercise switcher) so every `useExerciseContext()`
 * consumer re-renders under the new scope without a page reload and without a
 * remount. It takes no arguments - the server, not the caller, decides what the
 * session's scope now is.
 *
 * Throws when called outside an `ExerciseContextProvider`, for the same
 * fail-closed reason `useExerciseContext()` does: there is no scope to refresh.
 */
// Colocated with the provider by design - see the eslint note on
// `useExerciseContext` above.
// eslint-disable-next-line react-refresh/only-export-components
export function useExerciseScopeRefresh(): ExerciseScopeRefresh {
  const refresh = useContext(ExerciseScopeRefreshContext)
  if (refresh === undefined) {
    throw new Error(
      'useExerciseScopeRefresh() must be called within an <ExerciseContextProvider>. ' +
      'There is no scope to re-resolve (COR-001, COR-073).',
    )
  }
  return refresh
}
