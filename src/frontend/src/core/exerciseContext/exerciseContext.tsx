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
 *   - Resolution fails / empty scope -> the provider renders nothing; no
 *                                        default, unscoped, or aggregate
 *                                        scope is ever produced.
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
  useContext,
  useEffect,
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

const ExerciseContextInternal = createContext<ExerciseScope | undefined>(undefined)

export interface ExerciseContextProviderProps {
  children: ReactNode;
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

  useEffect(() => {
    let cancelled = false

    resolveExerciseContext()
      .then(scope => {
        if (cancelled) return
        setState({ kind: 'ready', scope })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Wave-0 has no UI/telemetry surface to report this through; a
        // console signal beats silence.
        console.error('[exerciseContext] resolveExerciseContext failed; failing closed', error)
        setState({ kind: 'error', error })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind !== 'ready') return null

  return (
    <ExerciseContextInternal.Provider value={state.scope}>
      {children}
    </ExerciseContextInternal.Provider>
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
