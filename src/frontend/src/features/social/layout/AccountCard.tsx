/**
 * features/social/layout/AccountCard.tsx
 * ---------------------------------------------------------------------------
 * The nav rail's account card: the signed-in persona's avatar, display name and
 * `@handle`, with a **Sign out** control (demo-polish F1; D1 "Footer: ... account
 * card"). The D1 mock's overflow menu (dark mode, settings) is out of scope -- the
 * card carries just the one action the AC names.
 *
 * SIGN OUT mirrors the shell's own `ParticipantSignOutControl` exactly:
 * `void endSession()` (which clears the React Query cache and the tokens
 * SYNCHRONOUSLY before its best-effort server notify) and then a navigate to
 * `LOGIN_PATH`. The redirect goes through React Router's own `useNavigate`, NOT
 * the channel's navigation adapter, on purpose: signing out leaves the channel
 * (and the whole participant world), it is not an in-channel move, and under the
 * memory provider an adapter navigate would merely wander inside the preview.
 * (For the same reason the card is never rendered in a `preview` / `kiosk` mount
 * -- see `SocialChannel`: a staff preview must not be able to sign the STAFF user
 * out.)
 *
 * Persona-bound session -> the full card. A session with no persona (an observer /
 * shared terminal) has no identity to show, so it gets the Sign out button alone,
 * still labelled, so the rail never strands a read-only participant without a way
 * out once the shell's duplicate sign-out row is retired.
 *
 * In the icon rail (narrow viewports) the name/handle/label text becomes visually
 * hidden but stays in the accessibility tree: the accessible names do not change
 * with the viewport.
 *
 * NFR-001: both controls are real `<button>`s; the avatar is decorative (the
 * name beside it carries the identity).
 *
 * World: participant. CSS Module + FontAwesome only -- no COBRA, no MUI.
 */

import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'
import type { Persona } from '@/features/personas'
import { Avatar } from '../components/Avatar'
import styles from './AccountCard.module.css'

export interface AccountCardProps {
  /** The signed-in persona, or `undefined` for a persona-less session. */
  persona: Persona | undefined
}

const AVATAR_SIZE = 40

export function AccountCard({ persona }: AccountCardProps) {
  const navigate = useNavigate()

  const handleSignOut = () => {
    // endSession() clears the token store AND the query cache synchronously
    // before it awaits the server notify, so navigate IMMEDIATELY -- the redirect
    // must never block on a slow request (same contract as the shell's control).
    void endSession()
    navigate(LOGIN_PATH)
  }

  const signOut = (
    <button type="button" className={styles.signOut} onClick={handleSignOut}>
      <FontAwesomeIcon
        icon={faRightFromBracket}
        aria-hidden="true"
        className={styles.signOutIcon}
      />
      <span className={styles.signOutLabel}>Sign out</span>
    </button>
  )

  if (persona === undefined) {
    return (
      <div className={styles.card} data-testid="account-card" data-has-persona="false">
        {signOut}
      </div>
    )
  }

  return (
    <div className={styles.card} data-testid="account-card" data-has-persona="true">
      <Avatar persona={persona} size={AVATAR_SIZE} />
      <div className={styles.identity}>
        <span className={styles.name}>{persona.displayName}</span>
        <span className={styles.handle}>{`@${persona.handle}`}</span>
      </div>
      {signOut}
    </div>
  )
}
