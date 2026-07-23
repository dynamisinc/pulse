/**
 * core/auth/session.tsx
 * ---------------------------------------------------------------------------
 * The session provider + hook (COR-012; feature: identity-auth-roles, story
 * 03; the failure-branch redirect below is feature: login, story 01 —
 * "Frontend session & token wiring", split from `identity-auth-roles/03`'s
 * deferred AC). Mirrors `core/exerciseContext/exerciseContext.tsx`:
 *
 *   - `SessionProvider` resolves the single bound session via
 *     `resolveSession()` (`./sessionResolver.ts` — now token-attaching + a
 *     one-shot silent-refresh, via the shared axios client) and renders
 *     `children` only once it succeeds. It renders nothing while resolving,
 *     so a descendant can never observe a default, unscoped, or expired
 *     session (fail-closed; COR-012, COR-001).
 *   - On resolution FAILURE (a 401 with no usable refresh, or any other
 *     resolution failure) it renders a redirect to the login entry
 *     (`LOGIN_PATH`, `/login`) — still fail-closed for CONTENT (no descendant
 *     ever mounts), now VISIBLE instead of a blank screen. This adds
 *     `react-router-dom` and `features/app-shell/constants.ts`'s `LOGIN_PATH`
 *     as imports to a `core/` module; that is an accepted, deliberate
 *     coupling — it mirrors `RoleAwareEntry.tsx`'s own use of `<Navigate>` for
 *     the same constant, not a layering smell.
 *   - `useSession()` returns the bound session, and THROWS when called outside
 *     a provider (fail-closed — there is no default session).
 *
 * The session is the anchor the exercise-isolation guarantee relies on: it
 * binds the browser to exactly one exercise + one account. `exerciseId` on the
 * session is a display/attribution field, NOT a client query-scoping param
 * (query isolation is enforced server-side — same precedent as `ExerciseScope`).
 *
 * Refresh (COR-012): a session is short-lived. `resolveSession()` itself now
 * rides the shared axios client's one-shot silent-refresh (`core/services/
 * api.ts`) on a 401 before this provider ever sees a rejection; re-calling
 * `resolveSession()` yields a freshly-stamped session on success. An expired
 * session (or a refresh that itself fails) still fails closed (throws) here,
 * which this provider now turns into a visible redirect rather than a blank
 * render.
 *
 * World: platform/foundation. No COBRA, no participant skin. The
 * `react-router-dom` import is the one documented exception (see above).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Navigate } from 'react-router-dom'
import { resolveSession, type Session } from './sessionResolver'
import { LOGIN_PATH } from '@/features/app-shell/constants'

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
 * after resolution succeeds; renders nothing while resolving (no descendant
 * can observe a default/expired session, COR-012, COR-001); redirects to the
 * login entry on failure (still fail-closed for content — visible, not blank).
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

  if (state.kind === 'loading') return null
  if (state.kind === 'error') return <Navigate to={LOGIN_PATH} replace />

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
