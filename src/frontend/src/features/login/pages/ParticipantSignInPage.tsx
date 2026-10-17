/**
 * features/login/pages/ParticipantSignInPage.tsx
 * ---------------------------------------------------------------------------
 * The participant sign-in page (feature: login, story 02 — "Participant
 * sign-in"; GitHub #305). PARTICIPANT world — a brand-neutral consumer-app
 * skin via `./ParticipantSignInPage.module.css`. NO COBRA, NO
 * `@/theme/styledComponents`, NO themed/default MUI (D0 §2 two-worlds rule) —
 * plain semantic HTML + a CSS Module, FontAwesome icons only.
 *
 * ONE page, THREE sign-in methods, chosen with a real, keyboard-operable
 * button group (never a `div onClick`) — easy-login story 09 added the first
 * and renamed the other two so they cannot be confused:
 *   - "Today's word" (the DEFAULT) — sign-in name + the word staff read out
 *     today -> `signInWithDayWord()` -> `POST /auth/word`. Signs in AS YOURSELF
 *     (a named participant); typed on a phone, so both fields are plain
 *     `type="text"` (a masked field only causes typos), 16 px, with
 *     autocapitalize/autocorrect/spellcheck off.
 *   - "Password" (was "Account sign-in") — handle + password ->
 *     `signInWithPassword()` -> `POST /auth/login`.
 *   - "View-only code" (was "Exercise code") — a single shared-password field ->
 *     `signInWithSharedCode()` -> `POST /auth/shared`. A SHARED, read-only
 *     session, which is why it is named for what it gives you and never
 *     sounds like "Today's word". ONE CREDENTIAL, ONE NAME (Gate-1 W-1): the
 *     toggle, the field label ("View-only code"), the form's accessible name
 *     ("Sign in with a view-only code") and its 401 message all say
 *     "view-only code"; the old "Exercise code" wording survives nowhere on
 *     the page.
 * Each form keeps its OWN typed values (they live in page state, so switching
 * methods and coming back loses nothing) and switching clears any error. All
 * three endpoints return the SAME success envelope
 * (`../services/participantSignInService.ts`'s `LoginEnvelope`); on success
 * this page calls the shared `completeSignIn` (`../completeSignIn`), which stores the
 * pair with `setTokens(pair, { persist: true })`, runs `resetClientSession()` so the
 * previous identity's cached data and composer state do not survive into this one
 * (Gate-2 W-2, as the join page does), and navigates to `/` with `replace` — the
 * role-aware entry (mounted elsewhere, story 04)
 * decides the participant's actual landing surface. This page never
 * re-decides that routing itself, and never special-cases the shared/read-only
 * path beyond what the backend already encodes in the envelope.
 *
 * PERSISTENCE (easy-login EL-10): EVERY participant method stores its tokens
 * with `{ persist: true }` (`localStorage`), so a participant stays signed in
 * for the exercise day however they got in — including the view-only shared
 * code (story 09 AC "existing forms ... now store the pair with persist").
 * The STAFF sign-in page never opts in (`StaffSignInPage`).
 *
 * ANTI-ENUMERATION (NFR-009): a 401 from ANY endpoint renders exactly one
 * generic, form-specific message ("That handle or password wasn't
 * recognized." / "That view-only code wasn't recognized." / "That name or word
 * wasn't recognized. Check today's word with your controller.") — this page
 * never distinguishes "no such handle" from "wrong password", or a wrong name
 * from a wrong word (it only branches on HTTP status via
 * `isUnauthorizedSignInError()`, never on server-supplied reason text). Only
 * the SECRET field of the form that was submitted is cleared (password / code
 * / word); the handle or sign-in name is left untouched so the participant
 * doesn't have to retype it.
 *
 * TODAY'S-WORD FORM SPECIFICS (story 09):
 *   - The page TRIMS surrounding whitespace from the name and the word (a
 *     phone keyboard's autocomplete likes to append a space) and does nothing
 *     else: day-word normalisation (case, accents, punctuation — EL-9) is the
 *     server's job, so no case-folding or stripping happens here. The word is
 *     never logged, never put in a URL and never echoed back into the DOM.
 *   - A `429` ("Too many tries. Wait a minute and try again.") and any other
 *     failure (network, 5xx, 400, malformed body: "Could not sign in. Please
 *     try again.") are distinct from the 401 copy. The other two forms keep
 *     their existing generic copy for non-401 failures.
 *   - FOCUS after a failed attempt: the submit button is disabled while the
 *     request is in flight, and a browser drops focus from a control that is
 *     disabled under it, so focus is put back deliberately once the request
 *     settles — on the (just-cleared) WORD field after a 401, ready to retype,
 *     and on the SIGN IN button after a 429 / other failure (nothing was
 *     cleared; the participant simply tries again). The error itself is
 *     announced by its own `role="alert"`, so focus never has to move to it.
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
 *  - The sign-in-method toggle is a real group of three `<button
 *    type="button">`s (`aria-pressed` reflects the active one; the active one
 *    also differs by weight and an underline bar, not colour alone) —
 *    reachable by Tab, activatable with Enter/Space, never a `div onClick`.
 *    Touch targets are at least 44 px (see the CSS Module).
 *  - The 401/failure message is `role="alert"` and PAIRS a FontAwesome icon
 *    with text — never color alone (mirrors
 *    `features/staff/components/ExerciseSwitcher.tsx`'s `SwitcherAlert`
 *    idiom).
 *  - The submit-in-flight state is a `role="status"` / `aria-live="polite"`
 *    region (same idiom). It is mounted ALL THE TIME and empty when idle, and
 *    only its text swaps to "Signing in…" while a request is outstanding: a
 *    live region that is inserted already holding its text is not reliably
 *    announced, one that already exists and then changes is (Gate-1 S-4). The
 *    CSS Module reserves its height so the swap never shifts the layout.
 *  - Every form carries `method="post"`: if a form is ever submitted natively
 *    (script failed to load, or fired before React attached) the credentials
 *    go in a POST body, never in the URL query string of a GET (NFR-004).
 *
 * CONTENT SECURITY (NFR-004): the resolved exercise name renders as a plain
 * React text node inside the heading (`{...}`), which React escapes by
 * construction — no `dangerouslySetInnerHTML` anywhere in this file. Field
 * values are sent to the backend as typed (the day-word form additionally
 * trims surrounding whitespace); sanitization/hashing of credentials is the
 * backend's concern. Nothing from a request is ever echoed into the page, and
 * the page has no console output.
 *
 * TWO-WORLDS GUARD: `ParticipantSignInPage.boundary.test.ts` source-scans this
 * file, its service and its CSS Module for any `@mui/*`, `@/theme/*` or COBRA
 * import and for the mobile-first numbers (16 px inputs, 44 px targets).
 *
 * HOME-SCREEN APP (#606, option A): an app added to the iOS home screen has its own
 * storage, apart from Safari's, so it always opens signed out. Tapping the
 * personal link in Mail or Messages opens Safari, not the app. So when the page
 * runs standalone (`isStandalone()`, read once on mount) it adds a FOURTH method,
 * "Sign-in link", placed FIRST and selected by default, with Today's word next to it:
 *   - The participant pastes their personal link (the full URL, a bare token, or the
 *     whole invitation message). `extractJoinToken` (`../linkToken`) finds the token
 *     and `signInWithLink` (`../services/joinService`) exchanges it through the
 *     EXISTING `POST /auth/join`: the same credential and the same body-only
 *     transport the join page uses (EL-7). Nothing new is exposed.
 *   - Input that holds no token-shaped value is refused HERE, before any request
 *     ("That doesn't look like a sign-in link."), so a stray word is never posted.
 *   - Failures use `classifyJoinFailure`. A refused link (401/400) gets ONE generic
 *     message that never says wrong vs revoked vs another exercise (NFR-009); the
 *     field is cleared and focused. A 429 reuses the "Too many tries" copy, and
 *     anything else the generic copy. In both cases the value is kept and focus
 *     returns to Sign in.
 *   - The field is plain `type="text"`, not `url`: a bare token or a whole message
 *     is not a URL, and a URL field would reject them. Autocomplete, autocorrect,
 *     capitalisation and spell-check are off. The value is never logged or echoed.
 *   - The "Pulse" product label is HIDDEN in standalone mode, so the installed app
 *     shows only the resolved exercise name. Outside standalone, nothing on this
 *     page changes.
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

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTowerBroadcast, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { STAFF_LOGIN_PATH } from '@/features/app-shell/constants'
import { isStandalone } from '@/features/pwa/install/installEnv'
import { completeSignIn } from '../completeSignIn'
import { extractJoinToken } from '../linkToken'
import { classifyJoinFailure, signInWithLink } from '../services/joinService'
import {
  signInWithDayWord,
  signInWithPassword,
  signInWithSharedCode,
  isRateLimitedSignInError,
  isUnauthorizedSignInError,
  type LoginEnvelope,
} from '../services/participantSignInService'
import { useKeepSubmitVisible } from '../hooks/useKeepSubmitVisible'
import styles from './ParticipantSignInPage.module.css'

type SignInMode = 'link' | 'word' | 'named' | 'shared'

interface SignInMethod {
  readonly mode: SignInMode
  readonly label: string
}

/** The three methods, in display order. `word` is the default (first). */
const SIGN_IN_METHODS: readonly SignInMethod[] = [
  { mode: 'word', label: "Today's word" },
  { mode: 'named', label: 'Password' },
  { mode: 'shared', label: 'View-only code' },
]

/** Home-screen app (#606): "Sign-in link" leads, and is the default. */
const STANDALONE_SIGN_IN_METHODS: readonly SignInMethod[] = [
  { mode: 'link', label: 'Sign-in link' },
  ...SIGN_IN_METHODS,
]

const WORD_UNAUTHORIZED_MESSAGE =
  "That name or word wasn't recognized. Check today's word with your controller."
const WORD_RATE_LIMITED_MESSAGE = 'Too many tries. Wait a minute and try again.'
const NAMED_UNAUTHORIZED_MESSAGE = "That handle or password wasn't recognized."
const SHARED_UNAUTHORIZED_MESSAGE = "That view-only code wasn't recognized."
const GENERIC_FAILURE_MESSAGE = 'Could not sign in. Please try again.'
const LINK_NOT_A_LINK_MESSAGE =
  "That doesn't look like a sign-in link. Paste the whole link from your invitation."
const LINK_UNAUTHORIZED_MESSAGE =
  "That link wasn't recognized. Check you copied all of it, or sign in with today's word."

/** Where focus goes once a request settles (see the module header's FOCUS note). */
type FocusTarget = 'word' | 'word-submit' | 'link' | 'link-submit'

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
  const queryClient = useQueryClient()
  const exerciseName = useResolvedExerciseName()
  // Read once: a page does not switch between browser tab and home-screen app.
  const [standalone] = useState(() => isStandalone())
  const methods = standalone ? STANDALONE_SIGN_IN_METHODS : SIGN_IN_METHODS

  const [mode, setMode] = useState<SignInMode>(standalone ? 'link' : 'word')
  const [pastedLink, setPastedLink] = useState('')
  const [signInName, setSignInName] = useState('')
  const [word, setWord] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<SignInFormError | null>(null)

  const activeError = error && error.mode === mode ? error : null

  // Where focus should land once the in-flight day-word request settles (see
  // the module header's FOCUS note). A ref, not state: it is read once by the
  // effect below and never drives a render itself.
  const cardRef = useRef<HTMLDivElement>(null)
  useKeepSubmitVisible(cardRef)
  const wordInputRef = useRef<HTMLInputElement>(null)
  const wordSubmitRef = useRef<HTMLButtonElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkSubmitRef = useRef<HTMLButtonElement>(null)
  const focusAfterSubmitRef = useRef<FocusTarget | null>(null)

  useEffect(() => {
    if (isSubmitting) return
    const target = focusAfterSubmitRef.current
    if (target === null) return
    focusAfterSubmitRef.current = null
    // The controls are enabled again by now; a ref is null if its form was
    // switched away from while the request was in flight.
    const targets: Record<FocusTarget, HTMLElement | null> = {
      'word': wordInputRef.current,
      'word-submit': wordSubmitRef.current,
      'link': linkInputRef.current,
      'link-submit': linkSubmitRef.current,
    }
    targets[target]?.focus()
  }, [isSubmitting])

  function selectMode(nextMode: SignInMode) {
    setMode(nextMode)
    setError(null)
  }

  /**
   * Common completion for every sign-in method: store the tokens in the
   * PERSISTENT store (EL-10 — all participant methods persist), forget the previous
   * identity's client state, then hand off with `navigate('/', { replace: true })`.
   * The shared `completeSignIn` does all three in order (Gate-2 W-2); this page, the
   * join page and the staff page cannot drift apart.
   */
  function finishSignIn(envelope: LoginEnvelope) {
    completeSignIn(
      { token: envelope.token, refreshToken: envelope.refreshToken },
      { persist: true, navigate, queryClient },
    )
  }

  async function handleWordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      // Trim only: day-word normalisation is the server's job (EL-9).
      const envelope = await signInWithDayWord({
        signInName: signInName.trim(),
        word: word.trim(),
      })
      finishSignIn(envelope)
    } catch (caught) {
      if (isUnauthorizedSignInError(caught)) {
        setError({ mode: 'word', message: WORD_UNAUTHORIZED_MESSAGE })
        setWord('')
        focusAfterSubmitRef.current = 'word'
      } else if (isRateLimitedSignInError(caught)) {
        setError({ mode: 'word', message: WORD_RATE_LIMITED_MESSAGE })
        focusAfterSubmitRef.current = 'word-submit'
      } else {
        setError({ mode: 'word', message: GENERIC_FAILURE_MESSAGE })
        focusAfterSubmitRef.current = 'word-submit'
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const token = extractJoinToken(pastedLink)
    if (token === null) {
      // Refused before any request: nothing token-shaped is ever posted.
      setError({ mode: 'link', message: LINK_NOT_A_LINK_MESSAGE })
      linkInputRef.current?.focus()
      return
    }
    setIsSubmitting(true)
    try {
      finishSignIn(await signInWithLink(token))
    } catch (caught) {
      const failure = classifyJoinFailure(caught)
      if (failure === 'link-invalid') {
        setError({ mode: 'link', message: LINK_UNAUTHORIZED_MESSAGE })
        setPastedLink('')
        focusAfterSubmitRef.current = 'link'
      } else {
        const message =
          failure === 'rate-limited' ? WORD_RATE_LIMITED_MESSAGE : GENERIC_FAILURE_MESSAGE
        setError({ mode: 'link', message })
        focusAfterSubmitRef.current = 'link-submit'
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleNamedSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const envelope = await signInWithPassword({ username, password })
      finishSignIn(envelope)
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
      finishSignIn(envelope)
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
      <div ref={cardRef} className={styles.card}>
        {/* Hidden in the home-screen app (#606): only the exercise name shows there. */}
        {standalone ? null : (
          <div className={styles.brandRow}>
            <FontAwesomeIcon icon={faTowerBroadcast} aria-hidden className={styles.brandIcon} />
            <span className={styles.brandLabel}>Pulse</span>
          </div>
        )}

        <h1 className={styles.heading}>
          {exerciseName ? `Sign in to ${exerciseName}` : 'Sign in'}
        </h1>

        <div
          className={standalone ? `${styles.toggleGroup} ${styles.toggleGroupFour}` : styles.toggleGroup}
          role="group"
          aria-label="Sign-in method"
        >
          {methods.map(method => (
            <button
              key={method.mode}
              type="button"
              className={styles.toggleButton}
              aria-pressed={mode === method.mode}
              onClick={() => selectMode(method.mode)}
            >
              {method.label}
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <form
            className={styles.form}
            aria-label="Sign in with your link"
            method="post"
            onSubmit={handleLinkSubmit}
          >
            <div className={styles.field}>
              <label htmlFor="participant-signin-link" className={styles.label}>
                Paste your sign-in link
              </label>
              <input
                id="participant-signin-link"
                ref={linkInputRef}
                name="link"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                aria-describedby="participant-signin-link-hint"
                className={styles.input}
                value={pastedLink}
                onChange={event => setPastedLink(event.target.value)}
                required
              />
              <p id="participant-signin-link-hint" className={styles.hint}>
                Copy it from your invitation email or text message.
              </p>
            </div>
            <button
              ref={linkSubmitRef}
              type="submit"
              className={styles.submitButton}
              disabled={isSubmitting}
            >
              Sign in
            </button>
          </form>
        ) : mode === 'word' ? (
          <form
            className={styles.form}
            aria-label="Sign in with today's word"
            method="post"
            onSubmit={handleWordSubmit}
          >
            <div className={styles.field}>
              <label htmlFor="participant-signin-word-name" className={styles.label}>
                Sign-in name
              </label>
              <input
                id="participant-signin-word-name"
                name="signInName"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="next"
                className={styles.input}
                value={signInName}
                onChange={event => setSignInName(event.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="participant-signin-word" className={styles.label}>
                Today&apos;s word
              </label>
              {/* type="text", NOT "password": the word is read off a screen and
                  typed on a phone, where a masked field only causes typos. */}
              <input
                id="participant-signin-word"
                ref={wordInputRef}
                name="word"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                className={styles.input}
                value={word}
                onChange={event => setWord(event.target.value)}
                required
              />
            </div>
            <button
              ref={wordSubmitRef}
              type="submit"
              className={styles.submitButton}
              disabled={isSubmitting}
            >
              Sign in
            </button>
          </form>
        ) : mode === 'named' ? (
          <form
            className={styles.form}
            aria-label="Sign in with your account"
            method="post"
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
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="next"
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
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
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
            aria-label="Sign in with a view-only code"
            method="post"
            onSubmit={handleSharedSubmit}
          >
            <div className={styles.field}>
              <label htmlFor="participant-signin-shared-password" className={styles.label}>
                View-only code
              </label>
              <input
                id="participant-signin-shared-password"
                name="password"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
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

        {/* Always mounted, empty when idle: only the text swaps, so a screen
            reader announces "Signing in…" (S-4 — see module header). */}
        <p role="status" aria-live="polite" className={styles.status}>
          {isSubmitting ? 'Signing in…' : ''}
        </p>

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
