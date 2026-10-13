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
 *   - On resolution FAILURE it fails closed for CONTENT either way (no descendant
 *     ever mounts), but VISIBLY, and in one of two ways (see "Why not always
 *     /login" below):
 *       - the person is signed out, or the server refused them: a redirect to
 *         the login entry (`LOGIN_PATH`, `/login`);
 *       - the person is STILL signed in (a stored pair) and the failure was only
 *         a missing answer: a neutral "Reconnecting..." screen with a Try again
 *         button (`ReconnectingState`).
 *     This adds `react-router-dom` and `features/app-shell/constants.ts`'s
 *     `LOGIN_PATH` as imports to a `core/` module; that is an accepted, deliberate
 *     coupling — it mirrors `RoleAwareEntry.tsx`'s own use of `<Navigate>` for
 *     the same constant, not a layering smell.
 *
 * ## Why not always /login (easy-login Gate-2 W-5, the long-tracked M-4)
 * Every failed resolution used to redirect to `/login`. With day-long participant
 * sessions that is wrong for a dropped request: the shared axios client
 * (`core/services/api.ts`) deliberately KEEPS the stored pair when a silent refresh
 * gets NO ANSWER (offline, timeout, 5xx, 429), and rejects the original request with
 * its own error, so a participant whose phone lost signal during page load was sent
 * to sign in again although their pair was intact. The store is the source of truth
 * for which case this is:
 *   - `getAccessToken() === null`  -> redirect to `/login`. Never signed in, signed
 *     out, or the server REFUSED the refresh (401/403), which clears this page's
 *     store before the error reaches here. (Since W-6 the answer stays null for a
 *     staff tab even when a participant's pair sits in `localStorage`.)
 *   - the server answered 403 to the session request itself -> `/login`: a real
 *     refusal of this account that retrying cannot fix.
 *   - anything else, with a pair still stored -> "Reconnecting...", because nothing
 *     says the sign-in is bad, only that the server was not reached. Try again re-runs
 *     the resolution and ends the refresh cool-down first (a deliberate press is not the
 *     automatic hammering the cool-down exists to stop). If that retry then finds the
 *     pair refused, the store is cleared and the same rule sends the person to
 *     `/login`. "Sign in again" on that screen is the exit for a failure that never
 *     clears up.
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
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Navigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { endRefreshCooldown } from '../services/api'
import { ReconnectingState } from './ReconnectingState'
import { resolveSession, type Session } from './sessionResolver'
import { getAccessToken } from './tokenStore'
import { LOGIN_PATH } from '@/features/app-shell/constants'

type SessionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly session: Session }
  /** Signed out or refused: fail closed to the login entry. */
  | { readonly kind: 'error'; readonly error: unknown }
  /** Still signed in, server not reached: the "Reconnecting..." screen. */
  | {
    readonly kind: 'reconnecting'
    readonly retrying: boolean
    readonly failedRetries: number
  }

const SessionContext = createContext<Session | undefined>(undefined)

export interface SessionProviderProps {
  children: ReactNode
}

/**
 * Whether a failed resolution should keep the person on a "Reconnecting..." screen
 * rather than send them to the login entry. See "Why not always /login" in the module
 * header. Reads the token store at the moment of the failure, which is exactly when the
 * shared axios client has already decided whether to clear it.
 */
function shouldStayConnected(error: unknown): boolean {
  // No token left: signed out, never signed in, or the refresh was REFUSED and cleared it.
  if (getAccessToken() === null) return false
  // The server answered the session request itself with a refusal retrying cannot fix.
  if (isAxiosError(error) && error.response?.status === 403) return false
  return true
}

/** The state a failed resolution leads to, given the state it failed from. */
function afterFailure(error: unknown, previous: SessionState): SessionState {
  if (!shouldStayConnected(error)) return { kind: 'error', error }
  return {
    kind: 'reconnecting',
    retrying: false,
    // A failure that ends a retry counts; the first appearance is zero.
    failedRetries:
      previous.kind === 'reconnecting' && previous.retrying ? previous.failedRetries + 1 : 0,
  }
}

/**
 * Resolves and binds the browser to a single session. Renders `children` only
 * after resolution succeeds; renders nothing while resolving (no descendant
 * can observe a default/expired session, COR-012, COR-001); redirects to the
 * login entry when the person is signed out or refused, and shows the neutral
 * "Reconnecting..." screen when they are still signed in but the server was not
 * reached (still fail-closed for content — visible, not blank).
 */
export function SessionProvider({ children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ kind: 'loading' })
  // Only the latest attempt may write state: a superseded attempt (a retry, an unmount,
  // StrictMode's simulated remount) is ignored when it settles.
  const attemptRef = useRef(0)

  const attempt = useCallback(() => {
    attemptRef.current += 1
    const mine = attemptRef.current

    resolveSession()
      .then(session => {
        if (attemptRef.current !== mine) return
        setState({ kind: 'ready', session })
      })
      .catch((error: unknown) => {
        if (attemptRef.current !== mine) return
        // No UI/telemetry surface at this layer; a console signal beats
        // silence. NEVER log the raw error object: once the shared axios
        // client attaches a stored token (core/services/api.ts), a failed
        // silent refresh propagates an AxiosError whose `config.headers`
        // carries `Authorization: Bearer <token>` — and `AxiosError` is
        // console-inspectable (some reporters call `.toJSON()`, which
        // includes `config`). Log only a redacted message (AC6).
        console.error(
          shouldStayConnected(error)
            ? '[session] resolveSession failed; signed in, offering a retry'
            : '[session] resolveSession failed; failing closed',
          error instanceof Error ? error.message : error,
        )
        setState(previous => afterFailure(error, previous))
      })
  }, [])

  useEffect(() => {
    attempt()
    return () => {
      attemptRef.current += 1
    }
  }, [attempt])

  const retry = useCallback(() => {
    // A deliberate press may call the refresh again even inside the cool-down that a
    // no-answer refresh started: the cool-down stops AUTOMATIC per-401 hammering.
    endRefreshCooldown()
    setState(previous =>
      previous.kind === 'reconnecting' ? { ...previous, retrying: true } : previous,
    )
    attempt()
  }, [attempt])

  if (state.kind === 'loading') return null
  if (state.kind === 'error') return <Navigate to={LOGIN_PATH} replace />
  if (state.kind === 'reconnecting') {
    return (
      <ReconnectingState
        retrying={state.retrying}
        failedRetries={state.failedRetries}
        onRetry={retry}
        signInPath={LOGIN_PATH}
      />
    )
  }

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
