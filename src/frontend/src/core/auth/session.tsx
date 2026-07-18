/**
 * core/auth/session.tsx
 * ---------------------------------------------------------------------------
 * The session provider + hook (COR-012; feature: identity-auth-roles, story
 * 03). Mirrors `core/exerciseContext/exerciseContext.tsx` exactly:
 *
 *   - `SessionProvider` resolves the single bound session via the mock
 *     `resolveSession()` (`./sessionResolver.ts`) and renders `children` only
 *     once it succeeds. It renders nothing while resolving and nothing if
 *     resolution fails — so a descendant can never observe a default, unscoped,
 *     or expired session (fail-closed; COR-012, COR-001).
 *   - `useSession()` returns the bound session, and THROWS when called outside
 *     a provider (fail-closed — there is no default session).
 *
 * The session is the anchor the exercise-isolation guarantee relies on: it
 * binds the browser to exactly one exercise + one account. `exerciseId` on the
 * session is a display/attribution field, NOT a client query-scoping param
 * (query isolation is enforced server-side — same precedent as `ExerciseScope`).
 *
 * Refresh (COR-012): a session is short-lived. `resolveSession()` is itself the
 * refresh path — re-calling it yields a freshly-stamped session; an expired
 * session fails closed (throws) and forces re-auth. A future real provider adds
 * a timer/token-refresh loop on top of this same seam; the mock does not need
 * one, so this provider resolves once.
 *
 * World: platform/foundation. No UI chrome, no COBRA, no participant skin.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { resolveSession, type Session } from './sessionResolver'

type SessionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly session: Session }
  | { readonly kind: 'error'; readonly error: unknown }

const SessionContext = createContext<Session | undefined>(undefined)

export interface SessionProviderProps {
  children: ReactNode
}

/**
 * Resolves and binds the browser to a single session. Renders `children` only
 * after resolution succeeds; renders nothing while resolving or on failure, so
 * no descendant can observe a default/expired session (COR-012, COR-001).
 */
export function SessionProvider({ children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    resolveSession()
      .then(session => {
        if (cancelled) return
        setState({ kind: 'ready', session })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // No UI/telemetry surface at this layer; a console signal beats silence.
        console.error('[session] resolveSession failed; failing closed', error)
        setState({ kind: 'error', error })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind !== 'ready') return null

  return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>
}

/**
 * Returns the current bound session. Throws outside a `SessionProvider`
 * (fail-closed — there is no default session, COR-012).
 */
// Provider + hook intentionally colocated (mirrors exerciseContext.tsx); same
// rationale as the `**/contexts/**` override in eslint.config.js.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === undefined) {
    throw new Error(
      'useSession() must be called within a <SessionProvider>. ' +
      'There is no default session (fail-closed, COR-012).',
    )
  }
  return session
}
