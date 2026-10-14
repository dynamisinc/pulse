/**
 * core/auth/ReconnectingState.tsx
 * ---------------------------------------------------------------------------
 * The "Reconnecting..." screen `SessionProvider` shows when the session could
 * not be resolved but the person is STILL SIGNED IN (easy-login Gate-2 W-5, the
 * long-tracked M-4). It replaces what used to happen: any failed
 * `resolveSession()` at page load redirected to `/login`, so a participant on a
 * phone whose request was merely dropped (a lift, a tunnel, a flaky venue network)
 * was bounced to the sign-in page although their pair was intact in storage.
 *
 * ## When it shows, and when it does not
 * `SessionProvider` shows this only while `getAccessToken() !== null` and the
 * failure was not a 403 (see `session.tsx`, "Why not always /login"): a stored pair
 * means a refresh that got NO ANSWER, which kept it by design (`core/services/api.ts`).
 * A refusal clears the store first, so it still goes to `/login`.
 *
 * ## What it offers
 *  - the state, in words and an icon (never colour alone): "Reconnecting...", then a
 *    sentence saying what is going on and that the person is still signed in;
 *  - a real `<button>` "Try again" (a user-initiated retry, which also ends the
 *    refresh cool-down: see `endRefreshCooldown`), kept FOCUSED while a retry runs
 *    (`aria-disabled`, not `disabled`, so keyboard and switch users do not lose their
 *    place);
 *  - a real `<a>` "Sign in again" to `/login`: an exit, so nobody is stranded on a
 *    server that keeps failing the same way.
 *
 * ## Accessibility (NFR-001)
 * One `<main>`, one `<h1>`. The message box is `role="status"` / `aria-live="polite"`
 * and takes focus when the screen first appears (so it is read out), and its text
 * changes as the retry runs and fails, which a live region announces once. Text is at
 * least 16 px, the controls at least 44 px tall (`ReconnectingState.styles.test.ts`
 * reads the stylesheet and computes the contrast).
 *
 * ## Two worlds (D0 section 2): deliberately NEUTRAL
 * `SessionProvider` sits ABOVE both worlds, outside any brand or COBRA theme, and a
 * participant route must never show COBRA while a staff one has no business showing a
 * brand. So this is plain semantic HTML with its own small CSS Module in a quiet,
 * brand-neutral palette: no `@mui/*`, no `@/theme/*`, no COBRA, FontAwesome icons only.
 * `ReconnectingState.test.tsx` source-scans for exactly that. It shows no time, so the
 * scenario-time rule (COR-053) has nothing to say here.
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch, faWifi } from '@fortawesome/free-solid-svg-icons'
import styles from './ReconnectingState.module.css'

export interface ReconnectingStateProps {
  /** `true` while a user-initiated retry is in flight. */
  readonly retrying: boolean
  /** How many retries have already failed (0 on the first appearance). */
  readonly failedRetries: number
  /** Called when the person presses "Try again". Ignored while `retrying`. */
  readonly onRetry: () => void
  /** Where "Sign in again" goes (the login entry). */
  readonly signInPath: string
}

/** The sentence in the live region for each phase. */
function messageFor(retrying: boolean, failedRetries: number): string {
  if (retrying) return 'Trying to reach Pulse…'
  if (failedRetries > 0) {
    return "Still can't reach Pulse. You're still signed in. Check your connection and try again."
  }
  return "Pulse couldn't be reached just now. You're still signed in, so there is no need to sign in again."
}

export function ReconnectingState({
  retrying,
  failedRetries,
  onRetry,
  signInPath,
}: ReconnectingStateProps) {
  const regionRef = useRef<HTMLDivElement>(null)

  // Read the screen out when it first appears: focus the live region (it is
  // programmatically focusable only). Later text changes are announced by the live
  // region itself, and the button keeps focus through a retry.
  useEffect(() => {
    regionRef.current?.focus()
  }, [])

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Reconnecting…</h1>

        <div
          ref={regionRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className={styles.region}
          data-testid="session-reconnecting-status"
        >
          <FontAwesomeIcon
            icon={retrying ? faCircleNotch : faWifi}
            aria-hidden
            className={`${styles.regionIcon} ${retrying ? styles.spinner : ''}`}
          />
          <p className={styles.message}>{messageFor(retrying, failedRetries)}</p>
        </div>

        <button
          type="button"
          className={styles.action}
          aria-disabled={retrying}
          onClick={() => {
            if (!retrying) onRetry()
          }}
        >
          Try again
        </button>

        <Link to={signInPath} className={styles.secondary}>
          Sign in again
        </Link>
      </div>
    </main>
  )
}
