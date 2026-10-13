/**
 * features/login/pages/JoinPage.tsx
 * ---------------------------------------------------------------------------
 * The join page (feature: easy-login, story 08 — "tap the link, you are in";
 * COR-011, COR-012, NFR-001, NFR-004; decisions EL-6, EL-7, C-2). A participant
 * taps their personal link (or scans the QR on their card) on a phone and lands
 * here at `/join/<token>`. The page exchanges the token for a session and drops
 * them on the participant surface as themselves. There is NOTHING TO TYPE: it has
 * to work first time, on a phone, on a bad network, in front of a room.
 *
 * WORLD: PARTICIPANT, PRE-AUTH. A brand-neutral consumer skin from this page's
 * own CSS Module (`./JoinPage.module.css`, the sign-in page's palette copied). NO
 * `@mui/*`, NO `@/theme/*`, NO COBRA, no `sx` — plain semantic HTML, FontAwesome
 * icons only. The exercise brand cannot be applied here (brand tokens are behind
 * the session gate, C-2), so the page names the exercise instead. A source-scan
 * test (`JoinPage.boundary.test.ts`) fails on any forbidden import. Mounted as a
 * sibling of `/login`, OUTSIDE `SessionProvider` / `ExerciseContextProvider`
 * (`app-shell/routes.tsx`), because it runs before a session exists; it resolves
 * the exercise name itself, softly, exactly as `ParticipantSignInPage` does.
 *
 * THE TOKEN IS A BEARER CREDENTIAL, SO IT IS HANDLED LIKE ONE (EL-7):
 *   1. It is read ONCE, from the route param, into a ref (`tokenRef`) — memory
 *      only, never state that renders, never a log, never an error string.
 *   2. BEFORE the network call starts, `history.replaceState` rewrites the address
 *      bar to `/join`, so the token is not in the URL, the history entry, a
 *      bookmark or a share sheet while (or after) the request is in flight. The
 *      router's own location is untouched (it does not watch `replaceState`), so
 *      the page keeps working; the entry's `history.state` is preserved so the
 *      router's bookkeeping stays coherent.
 *   3. It is sent in a POST BODY (`signInWithLink`, never in an API URL).
 *   4. `public/staticwebapp.config.json` answers `/join/*` (and the bare `/join`)
 *      with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Each
 *      rule also carries its own `rewrite` to `/index.html`, because Azure Static
 *      Web Apps does not apply route rules to requests served via
 *      `navigationFallback` (see `staticWebAppConfig.test.ts`).
 *   5. After a success the ref is emptied. After a failure it is KEPT, so "Try
 *      again" can repeat the exchange without the URL it no longer has.
 *
 * EXACTLY ONE EXCHANGE (React 19 StrictMode, gotcha 11). StrictMode runs every
 * effect twice in development. The exchange starts behind a `startedRef` guard,
 * and the effect's cleanup does NOT cancel it: it only clears `mountedRef`,
 * which the in-flight request checks when it settles. StrictMode's simulated
 * unmount/remount sets that flag back to true before any network answer can
 * arrive; a REAL unmount (the participant left the page mid-request) leaves it
 * false, and the late result is dropped rather than signing someone in behind
 * their back. A concurrent-click guard (`inFlightRef`) also stops a double-tap on
 * "Try again" from posting twice.
 *
 * ON SUCCESS (in this order, all synchronous after the response):
 *   - `setTokens(pair, { persist: true })` — the pair goes to `localStorage`, so a
 *     phone stays signed in through a closed tab, and any STAFF `sessionStorage`
 *     pair in this browser is removed (documented consequence: opening a
 *     participant link in a staff tab signs that staff user out). A DIFFERENT
 *     participant's persisted pair is simply replaced. Both are `tokenStore`
 *     behaviour (story 07); this page just passes the flag.
 *   - `queryClient.clear()` — nothing the previous identity fetched may be shown
 *     to the new one (COR-001). Done AFTER the new tokens are stored, so no
 *     refetch can go out under the old token.
 *   - `navigate('/', { replace: true })` — the role-aware entry then lands the
 *     participant on their feed. `replace`, so Back never returns here.
 * One browser, one identity (story 07, S-1): a second join link opened in another
 * tab replaces this identity and reloads the other tabs. A sign-in still in
 * progress in a reloaded tab is lost with its already-scrubbed link and must be
 * started again from the link. That is intended; this page does not defend
 * against it (it belongs in the tester notes, not the UI).
 *
 * THE FIVE VIEWS (one `view` state; each is a region that takes FOCUS when it
 * appears, so a screen-reader or keyboard user is told, not left on a stale page):
 *   - `signing-in`   `role="status"` / `aria-live="polite"`, "Signing you in…".
 *   - `link-invalid` `role="alert"` + icon. 401 (and 400): ONE generic message
 *                    that never says whether the link was wrong, revoked or
 *                    replaced (NFR-009), and a link to `/login`.
 *   - `rate-limited` `role="alert"` + icon. 429: wait a minute and tap the link
 *                    again.
 *   - `unreachable`  `role="alert"` + icon. Network error or 5xx: "Couldn't reach
 *                    the exercise" and a "Try again" button that repeats the
 *                    exchange.
 *   - `no-link`      `role="status"` + icon. A bare `/join` with no token: the
 *                    address bar was scrubbed and the page was then reloaded
 *                    (a pull-to-refresh during "Signing you in…" is the common
 *                    way), or the scrubbed URL was bookmarked, so there is
 *                    nothing left to exchange. It does NOT say the link is spent
 *                    (the participant's link may be perfectly good, and the
 *                    exchange may even have succeeded on the server with its
 *                    answer lost to the reload): it says
 *                    "To sign in, tap your link again or scan your card. You can
 *                    also sign in with today's word." and offers "Continue",
 *                    a link to `/`. The role-aware entry then decides, because
 *                    this page cannot know whether a session exists: with one,
 *                    the participant lands on their feed; without one, the entry
 *                    fails closed to `/login`.
 * Error is NEVER colour-only: every region pairs its colour with an icon and
 * text. The sign-in link is a real `<a>` (react-router `<Link>`) and Try again a
 * real `<button>`, both reachable by keyboard.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA): one `<h1>`, a `<main>`, focus moves to the
 * live region when the view changes, text is at least 16px and the action is at
 * least 44px tall (pinned by `JoinPage.styles.test.ts`), the spinner stops under
 * `prefers-reduced-motion`. No input, so the on-screen keyboard never appears.
 *
 * CONTENT SECURITY (NFR-004): the exercise name renders as a React text node (no
 * `dangerouslySetInnerHTML`), and this file has no `console` call at all.
 *
 * EXERCISE NAME (non-blocking): `resolveExerciseContext()` through React Query
 * (`retry: false`, same key as the sign-in page so the two share a cache entry).
 * `data` stays `undefined` while loading or on failure; the heading falls back to
 * a generic line and the exchange neither waits for nor depends on it.
 *
 * SCENARIO TIME (COR-053): not applicable — the page shows no time.
 * TELEMETRY (XC-004): none from the client; the server records the sign-in
 * (`login`, `method: link`, backend story 03).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleInfo,
  faCircleNotch,
  faTowerBroadcast,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { JOIN_PATH, LOGIN_PATH } from '@/features/app-shell/constants'
import {
  classifyJoinFailure,
  signInWithLink,
  type JoinFailure,
} from '../services/joinService'
import type { LoginEnvelope } from '../services/participantSignInService'
import styles from './JoinPage.module.css'

/**
 * Where a successful exchange hands off, and where "Continue" goes from a bare
 * `/join`: the role-aware entry (story 04 of login). `JOIN_PATH` (the route base:
 * `JOIN_PATH/:token` for a personal link, bare `JOIN_PATH` for the scrubbed address)
 * lives beside `LOGIN_PATH` in `app-shell/constants`.
 */
const ENTRY_PATH = '/'

/** What the page is showing. See the module header. */
type JoinView = 'signing-in' | 'no-link' | JoinFailure

/** The copy, icon and ARIA role of each view's region. */
interface RegionSpec {
  readonly role: 'status' | 'alert'
  readonly icon: IconDefinition
  readonly text: string
  readonly tone: 'status' | 'notice' | 'alert'
  readonly spin?: boolean
}

const REGIONS: Record<JoinView, RegionSpec> = {
  'signing-in': {
    role: 'status',
    icon: faCircleNotch,
    text: 'Signing you in…',
    tone: 'status',
    spin: true,
  },
  'no-link': {
    role: 'status',
    icon: faCircleInfo,
    text: 'To sign in, tap your link again or scan your card. '
      + "You can also sign in with today's word.",
    tone: 'notice',
  },
  // ONE generic message for a refused link: never wrong vs revoked vs replaced.
  'link-invalid': {
    role: 'alert',
    icon: faTriangleExclamation,
    text: "This link isn't working any more. Ask your controller for a new one, "
      + "or sign in with today's word.",
    tone: 'alert',
  },
  'rate-limited': {
    role: 'alert',
    icon: faTriangleExclamation,
    text: 'Too many tries, wait a minute and tap the link again.',
    tone: 'alert',
  },
  unreachable: {
    role: 'alert',
    icon: faTriangleExclamation,
    text: "Couldn't reach the exercise. Check your connection and try again.",
    tone: 'alert',
  },
}

const GENERIC_HEADING = 'Joining your exercise'

/**
 * Rewrites the address bar to the bare join path so the token is not in the URL,
 * the history entry or a later share/bookmark. Keeps the entry's `history.state`
 * (the router's index and key). Best effort: a browser that refuses (a sandboxed
 * frame) leaves the URL as it was, and the exchange goes ahead regardless.
 */
function scrubTokenFromAddressBar(): void {
  try {
    window.history.replaceState(window.history.state, '', JOIN_PATH)
  } catch {
    // Nothing safe to log (any message could be about the URL), and nothing to do.
  }
}

/**
 * Softly resolves the exercise name for the heading. Never throws, never blocks:
 * `data` is `undefined` while loading and on failure. Same query key as
 * `ParticipantSignInPage`, so the two pre-auth pages share one cache entry.
 */
function useResolvedExerciseName(): string | undefined {
  const { data } = useQuery({
    queryKey: ['login', 'exercise-context'],
    queryFn: resolveExerciseContext,
    retry: false,
  })
  return data?.exerciseName
}

/** The join page. See the module header for the full contract. */
export function JoinPage() {
  const { token: routeToken } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const exerciseName = useResolvedExerciseName()

  // The credential, in memory only. Seeded once from the route; emptied on success.
  const tokenRef = useRef<string | null>(routeToken ? routeToken : null)
  const startedRef = useRef(false)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const regionRef = useRef<HTMLDivElement>(null)

  // No token in the route: nothing to exchange (a reload of the scrubbed address; see header).
  const [view, setView] = useState<JoinView>(routeToken ? 'signing-in' : 'no-link')

  /** Runs one exchange: success hands off, failure picks the view. Never concurrent. */
  const runExchange = useCallback(async () => {
    const token = tokenRef.current
    if (token === null || inFlightRef.current) return

    inFlightRef.current = true
    setView('signing-in')

    let envelope: LoginEnvelope
    try {
      envelope = await signInWithLink(token)
    } catch (caught) {
      inFlightRef.current = false
      if (mountedRef.current) setView(classifyJoinFailure(caught))
      return
    }
    inFlightRef.current = false

    // The participant left while this was in flight: do not sign them in behind
    // their back. (StrictMode's simulated unmount has remounted by now.)
    if (!mountedRef.current) return

    setTokens(
      { token: envelope.token, refreshToken: envelope.refreshToken },
      { persist: true },
    )
    queryClient.clear()
    tokenRef.current = null
    navigate(ENTRY_PATH, { replace: true })
  }, [navigate, queryClient])

  // Start the single exchange. `startedRef` makes the second (StrictMode) run of
  // this effect a no-op; the cleanup deliberately does not cancel anything.
  useEffect(() => {
    mountedRef.current = true
    if (!startedRef.current && tokenRef.current !== null) {
      startedRef.current = true
      scrubTokenFromAddressBar()
      void runExchange()
    }
    return () => {
      mountedRef.current = false
    }
  }, [runExchange])

  // Move focus to the live region whenever the view changes (and on first paint).
  useEffect(() => {
    regionRef.current?.focus()
  }, [view])

  const region = REGIONS[view]

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <FontAwesomeIcon icon={faTowerBroadcast} aria-hidden className={styles.brandIcon} />
          <span className={styles.brandLabel}>Pulse</span>
        </div>

        <h1 className={styles.heading}>{exerciseName ?? GENERIC_HEADING}</h1>

        <div
          key={view}
          ref={regionRef}
          tabIndex={-1}
          role={region.role}
          aria-live={region.role === 'status' ? 'polite' : undefined}
          className={`${styles.region} ${styles[region.tone]}`}
        >
          <FontAwesomeIcon
            icon={region.icon}
            aria-hidden
            className={`${styles.regionIcon} ${region.spin ? styles.spinner : ''}`}
          />
          <p className={styles.message}>{region.text}</p>
        </div>

        {view === 'unreachable' ? (
          <button type="button" className={styles.action} onClick={() => void runExchange()}>
            Try again
          </button>
        ) : null}

        {view === 'link-invalid' ? (
          <Link to={LOGIN_PATH} className={styles.action}>
            Go to sign in
          </Link>
        ) : null}

        {view === 'no-link' ? (
          <Link to={ENTRY_PATH} className={styles.action}>
            Continue
          </Link>
        ) : null}
      </div>
    </main>
  )
}
