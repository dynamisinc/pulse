/**
 * features/participant-shell/components/ParticipantSignOutControl.tsx
 * ---------------------------------------------------------------------------
 * The participant world's minimal sign-out affordance (feature: login, story
 * 04 — "Wire real login routes + logout"; COR-012). There is no existing
 * account/settings surface anywhere in the participant shell for this to slot
 * into, so this adds ONE small, self-contained control rather than folding it
 * into an existing shell-chrome file:
 *
 *  - `ChannelNav.tsx` is a heavily-specified, config-driven channel switcher
 *    with its own suite asserting exact per-nav button counts and a "renders
 *    NOTHING (neither strip nor tab bar) when there are no enabled channels /
 *    hideWhenSingleChannel" contract (AC2, D2-005). Signing out is orthogonal
 *    to that channel-switching contract — folding it in would either grow
 *    that suite's asserted button counts (churning a lot of tightly-pinned
 *    assertions) or, worse, tie sign-out's availability to the channel set
 *    (a participant with a disabled/empty channel config would then have no
 *    way to sign out either). Keeping this a separate, always-rendered
 *    sibling avoids both.
 *  - `ShellLayout.tsx` mounts this as a plain sibling of `<ChannelNav>` (see
 *    its own module header) — this component owns only the control itself,
 *    not the shell's assembly.
 *
 * Self-contained (mirrors `ComplianceChrome`/`AlertBar`/`ChannelNav`'s "own
 * mock/data seam, zero prop-threading" pattern) — `ShellLayout` mounts it with
 * no props.
 *
 * World: participant. Deliberately BRAND-NEUTRAL plain CSS (quiet grays,
 * matching `ChannelNav`'s own shell-chrome palette) rather than
 * `useBrand()`/`--pulse-brand-*`: this is the shell's OWN utility action, not
 * part of the exercise fiction, so it does not theme to the per-exercise
 * brand — the same reasoning `ComplianceChrome`/`ChannelNav` already follow for
 * never pulling in brand tokens. No COBRA, no MUI, no default MUI look (D0 §2).
 *
 * Calls the shared `endSession()` helper (`@/core/auth`) — which clears the
 * React Query cache AND logs out (token clear + best-effort server notify) —
 * then navigates to `LOGIN_PATH` (`@/features/app-shell/constants`), the same
 * contract `StaffHeader`'s sign-out control follows in the staff world.
 * `endSession()` never throws (its `logout()` swallows any network failure and
 * leaves the browser logged out locally), so no error handling is needed here.
 *
 * ACCESSIBILITY (NFR-001): a real `<button>` (keyboard-operable by default,
 * no custom key handling needed). Its accessible name is its own visible text
 * ("Sign out"), so no separate `aria-label` is needed. The FontAwesome icon is
 * decorative and (per that library's default) not exposed to the
 * accessibility tree.
 */
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { endSession } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'

/** Quiet, shell-chrome row — mirrors `ChannelNav.tsx`'s own palette/typography. */
const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  boxSizing: 'border-box',
  padding: '4px 16px',
  background: '#fafafa',
  borderBottom: '1px solid #e3e3e3',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  background: 'none',
  border: 'none',
  padding: '4px 6px',
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  color: '#5a6470',
  cursor: 'pointer',
}

export function ParticipantSignOutControl() {
  const navigate = useNavigate()

  const handleSignOut = () => {
    // endSession() clears the token store AND the React Query cache
    // SYNCHRONOUSLY before it awaits the best-effort POST /auth/logout (see
    // core/auth/endSession.ts), so navigate IMMEDIATELY — the redirect must
    // never block on a slow/hung request, and no prior-user cached data can
    // survive into the next session on this tab.
    void endSession()
    navigate(LOGIN_PATH)
  }

  return (
    <div style={rowStyle}>
      <button type="button" style={buttonStyle} onClick={handleSignOut}>
        <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  )
}
