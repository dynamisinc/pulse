/**
 * features/login/pages/ParticipantSignInPage.tsx
 * ---------------------------------------------------------------------------
 * The participant sign-in page (feature: login, story 02 — "Participant
 * sign-in"; GitHub #305). PARTICIPANT world — a brand-neutral consumer-app
 * skin via `./ParticipantSignInPage.module.css`. NO COBRA, NO
 * `@/theme/styledComponents`, NO themed/default MUI (D0 §2 two-worlds rule) —
 * plain semantic HTML + a CSS Module, FontAwesome icons only.
 *
 * ONE page, TWO sign-in kinds, toggled by a real, keyboard-operable button
 * pair (never a `div onClick`):
 *   - "Account sign-in" (primary/default) — handle + password ->
 *     `signInWithPassword()` -> `POST /auth/login`.
 *   - "Exercise code" — a single shared-password field ->
 *     `signInWithSharedCode()` -> `POST /auth/shared`.
 * Both endpoints return the SAME success envelope
 * (`../services/participantSignInService.ts`'s `LoginEnvelope`); on success
 * this page calls `setTokens()` (`@/core/auth`) and navigates to `/` — the
 * role-aware entry (mounted elsewhere, story 04) decides the participant's
 * actual landing surface. This page never re-decides that routing itself,
 * and never special-cases the shared/read-only path beyond what the backend
 * already encodes in the envelope.
 *
 * ANTI-ENUMERATION (NFR-009): a 401 from EITHER endpoint renders exactly one
 * generic, form-specific message ("That handle or password wasn't
 * recognized." / "That exercise code wasn't recognized.") — this page never
 * distinguishes "no such handle" from "wrong password" (it only branches on
 * HTTP status via `isUnauthorizedSignInError()`, never on server-supplied
 * reason text). Only the PASSWORD field of the form that was submitted is
 * cleared; the handle field is left untouched so the participant doesn't have
 * to retype it.
 *
 * AC5 (exercise-name branding, non-blocking) — CHOSEN APPROACH: the
 * ACCEPTABLE ALTERNATIVE from the story spec, NOT the fail-closed
 * `<ExerciseContextProvider>`. `useResolvedExerciseName()` below resolves
 * `resolveExerciseContext()` (`@/core/exerciseContext`) directly through
 * React Query (`retry: false`, no `ExerciseContextProvider` ancestor
 * required). This is deliberate: `ExerciseContextProvider` renders `null`
 * while loading AND on error (see its own module header) — mounting it
 * around the forms would HIDE the entire sign-in page on an unknown host,
 * which is exactly what this AC forbids. React Query's `data` stays
 * `undefined` while loading/erroring and the heading falls back to a plain
 * "Sign in" — the forms below are rendered UNCONDITIONALLY, independent of
 * this lookup's outcome.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - Both forms use real `<label htmlFor>` associations — never
 *    placeholder-as-label.
 *  - The sign-in-kind toggle is a real `<button type="button">` pair
 *    (`aria-pressed` reflects the active one) — reachable by Tab, activatable
 *    with Enter/Space, never a `div onClick`.
 *  - The 401/failure message is `role="alert"` and PAIRS a FontAwesome icon
 *    with text — never color alone (mirrors
 *    `features/staff/components/ExerciseSwitcher.tsx`'s `SwitcherAlert`
 *    idiom).
 *  - The submit-in-flight state is a `role="status"` / `aria-live="polite"`
 *    region (same idiom), mounted only while a request is outstanding.
 *
 * CONTENT SECURITY (NFR-004): the resolved exercise name renders as a plain
 * React text node inside the heading (`{...}`), which React escapes by
 * construction — no `dangerouslySetInnerHTML` anywhere in this file. Field
 * values are sent to the backend as-is; sanitization/hashing of credentials
 * is the backend's concern.
 *
 * SCENARIO TIME (COR-053): not applicable — no participant-visible
 * timestamps on this page.
 *
 * STAFF LINK (feature: login, story 04, AC2): a single, clearly-separated,
 * visually SUBORDINATE link to `STAFF_LOGIN_PATH` ("Staff or controller? Sign
 * in here.") — the one place the two worlds are allowed to reference each
 * other, and only as a real react-router `<Link>` (never a styled `div`/
 * `onClick`), styled entirely by this page's own CSS Module (brand-neutral,
 * COBRA-free). `STAFF_LOGIN_PATH` is a world-neutral path constant from
 * `@/features/app-shell/constants` — `core/auth/session.tsx` already imports
 * its sibling `LOGIN_PATH` from the same module, so this coupling is an
 * established precedent, not a new layering smell.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTowerBroadcast, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { STAFF_LOGIN_PATH } from '@/features/app-shell/constants'
import {
  signInWithPassword,
  signInWithSharedCode,
  isUnauthorizedSignInError,
  type LoginEnvelope,
} from '../services/participantSignInService'
import styles from './ParticipantSignInPage.module.css'

type SignInMode = 'named' | 'shared'

const NAMED_UNAUTHORIZED_MESSAGE = "That handle or password wasn't recognized."
const SHARED_UNAUTHORIZED_MESSAGE = "That exercise code wasn't recognized."
const GENERIC_FAILURE_MESSAGE = 'Could not sign in. Please try again.'

interface SignInFormError {
  readonly mode: SignInMode
  readonly message: string
}

/**
 * Softly resolves the current host's exercise name for the heading (AC5).
 * See module header for why this bypasses `<ExerciseContextProvider>`: `data`
 * stays `undefined` while loading or on error, and the caller falls back to
 * a generic heading — this hook NEVER throws and NEVER blocks a render.
 */
function useResolvedExerciseName(): string | undefined {
  const { data } = useQuery({
    queryKey: ['login', 'exercise-context'],
    queryFn: resolveExerciseContext,
    retry: false,
  })
  return data?.exerciseName
}

/**
 * The participant sign-in page. See module header for the full contract.
 */
export function ParticipantSignInPage() {
  const navigate = useNavigate()
  const exerciseName = useResolvedExerciseName()

  const [mode, setMode] = useState<SignInMode>('named')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<SignInFormError | null>(null)

  const activeError = error && error.mode === mode ? error : null

  function selectMode(nextMode: SignInMode) {
    setMode(nextMode)
    setError(null)
  }

  /** Common completion for either sign-in kind: store tokens, then hand off. */
  function completeSignIn(envelope: LoginEnvelope) {
    setTokens({ token: envelope.token, refreshToken: envelope.refreshToken })
    navigate('/')
  }

  async function handleNamedSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const envelope = await signInWithPassword({ username, password })
      completeSignIn(envelope)
    } catch (caught) {
      if (isUnauthorizedSignInError(caught)) {
        setError({ mode: 'named', message: NAMED_UNAUTHORIZED_MESSAGE })
        setPassword('')
      } else {
        setError({ mode: 'named', message: GENERIC_FAILURE_MESSAGE })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSharedSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const envelope = await signInWithSharedCode({ password: sharedPassword })
      completeSignIn(envelope)
    } catch (caught) {
      if (isUnauthorizedSignInError(caught)) {
        setError({ mode: 'shared', message: SHARED_UNAUTHORIZED_MESSAGE })
        setSharedPassword('')
      } else {
        setError({ mode: 'shared', message: GENERIC_FAILURE_MESSAGE })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <FontAwesomeIcon icon={faTowerBroadcast} aria-hidden className={styles.brandIcon} />
          <span className={styles.brandLabel}>Pulse</span>
        </div>

        <h1 className={styles.heading}>
          {exerciseName ? `Sign in to ${exerciseName}` : 'Sign in'}
        </h1>

        <div className={styles.toggleGroup} role="group" aria-label="Sign-in method">
          <button
            type="button"
            className={styles.toggleButton}
            aria-pressed={mode === 'named'}
            onClick={() => selectMode('named')}
          >
            Account sign-in
          </button>
          <button
            type="button"
            className={styles.toggleButton}
            aria-pressed={mode === 'shared'}
            onClick={() => selectMode('shared')}
          >
            Exercise code
          </button>
        </div>

        {mode === 'named' ? (
          <form
            className={styles.form}
            aria-label="Sign in with your account"
            onSubmit={handleNamedSubmit}
          >
            <div className={styles.field}>
              <label htmlFor="participant-signin-username" className={styles.label}>
                Handle
              </label>
              <input
                id="participant-signin-username"
                name="username"
                type="text"
                autoComplete="username"
                className={styles.input}
                value={username}
                onChange={event => setUsername(event.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="participant-signin-password" className={styles.label}>
                Password
              </label>
              <input
                id="participant-signin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                className={styles.input}
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
              Sign in
            </button>
          </form>
        ) : (
          <form
            className={styles.form}
            aria-label="Sign in with the shared exercise code"
            onSubmit={handleSharedSubmit}
          >
            <div className={styles.field}>
              <label htmlFor="participant-signin-shared-password" className={styles.label}>
                Exercise code
              </label>
              <input
                id="participant-signin-shared-password"
                name="password"
                type="password"
                autoComplete="off"
                className={styles.input}
                value={sharedPassword}
                onChange={event => setSharedPassword(event.target.value)}
                required
              />
            </div>
            <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
              Sign in
            </button>
          </form>
        )}

        {activeError ? (
          <p role="alert" className={styles.alert}>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            <span>{activeError.message}</span>
          </p>
        ) : null}

        {isSubmitting ? (
          <p role="status" aria-live="polite" className={styles.status}>
            Signing in…
          </p>
        ) : null}

        {/* The one cross-world reference (AC2 — see module header). Visually
            subordinate to the forms above (small, muted, separated by a
            rule) — a real, labelled <a> via react-router's <Link>. */}
        <p className={styles.staffLinkRow}>
          Staff or controller?{' '}
          <Link to={STAFF_LOGIN_PATH} className={styles.staffLink}>
            Sign in here.
          </Link>
        </p>
      </div>
    </main>
  )
}
