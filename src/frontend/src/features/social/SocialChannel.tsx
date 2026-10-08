/**
 * features/social/SocialChannel.tsx
 * ---------------------------------------------------------------------------
 * The Pulse "Social" channel -- the composition mounted as the participant
 * shell's DEFAULT channel (`App.tsx`'s `ParticipantShellRoute` renders it in the
 * shell's channel mount point). Rebuilt by demo-polish F1 (issue #429) from a
 * single 600px column with local `useState` navigation into a real
 * three-column app frame with working URLs.
 *
 * THE FRAME (D1-013, left-anchored; `layout/frameMetrics.ts`)
 *
 *     240px nav rail   |   600px main column   |   344px right rail
 *     `NavRail`            `SocialRoutes`          `RightRailContent`
 *     nav[Primary]         main                    aside[Sidebar]
 *
 * Below 1184px the right rail hides; below 840px the nav rail collapses to an icon
 * rail; the page never scrolls horizontally from 390 to 1440px. Both rails are
 * sticky and clear the shell's two EXERCISE banners via `--pulse-chrome-top` /
 * `--pulse-chrome-bottom`.
 *
 * WHAT LIVES WHERE
 *  - `layout/NavRail.tsx`, `AccountCard.tsx`, `PulseLogo.tsx`  the left rail.
 *  - `layout/RightRail.tsx` + `RightRailContent.tsx`           the right rail and its
 *    slots (`searchSlot` / `trendingSlot`, filled by the orchestrator once F6 lands).
 *  - `layout/SocialRoutes.tsx` + `layout/routes/*`             the route table.
 *  - `layout/ComposeModal.tsx`                                 the Post button's modal.
 *  - `layout/socialNavigation.ts` + `SocialNavigationProvider.tsx`  the navigation
 *    adapter (below).
 *
 * NAVIGATION ADAPTER. Every in-channel move and every route match goes through
 * `useSocialNavigation()`. The default provider wraps React Router (real URLs,
 * Back, reload-on-any-route); `MemorySocialNavigationProvider` keeps the location in
 * memory and never touches browser history, so C6's staff "preview as participant"
 * can mount this same channel inside a staff route without moving the staff app's
 * address bar. `SocialChannel` mounts the default provider itself UNLESS a provider
 * is already above it -- so the preview just wraps `<SocialChannel />` in the memory
 * one. The router is HERE, inside the app's `*` catch-all, not in `RoleAwareEntry`,
 * so the participant entry stays location-blind (COR-004).
 *
 * ACCESSIBILITY (NFR-001)
 *  - Landmarks: `nav[aria-label=Primary]`, `main`, `aside[aria-label=Sidebar]`.
 *  - A "Skip to main content" link is the first focusable control in the channel.
 *  - On every route change focus moves to the main region's heading
 *    (`useRouteFocus`) -- this replaces the old feed<->detail focus effect.
 *  - While the compose modal is open, the frame behind it is `inert`.
 *
 * ONE SIGN OUT. The shell renders a generic `ParticipantSignOutControl` row above
 * every channel. This channel has its own (the account card), so while the card is
 * on screen it CLAIMS the shell's account control (`useClaimShellAccountControl`)
 * and the shell drops its row: one Sign out on the social channel, and the channel
 * no longer starts a strip lower than it has to. Other channels make no claim and
 * keep the shell's row. A `preview` / `kiosk` mount shows no account card, so it
 * makes no claim either.
 *
 * ABSENT, NOT DISABLED (COR-015 / D1-011). The **Post** button exists only when the
 * shell variant grants interactive affordances AND the session can post; the account
 * card exists only in a `full` / `readOnly` mount (never a staff `preview`); the
 * Profile pill only for a persona-bound session.
 *
 * SCENARIO TIME: nothing in this file renders time. Every post still renders its own
 * scenario-time stamp (COR-053).
 *
 * World: participant (Pulse skin) -- CSS Modules reading the `--pc-*` / `--pulse-*`
 * tokens, FontAwesome icons, no COBRA, no MUI.
 */

import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useSession } from '@/core/auth'
import {
  useClaimShellAccountControl,
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { ComposeModal } from './layout/ComposeModal'
import { NavRail } from './layout/NavRail'
import { RightRailContent } from './layout/RightRailContent'
import { SocialDirectoryProvider } from './layout/SocialDirectoryProvider'
import { SocialNavigationProvider } from './layout/SocialNavigationProvider'
import { SocialRoutes } from './layout/SocialRoutes'
import { useSocialDirectory } from './layout/socialDirectory'
import {
  matchSocialRoute,
  useHasSocialNavigation,
  useSocialNavigation,
} from './layout/socialNavigation'
import { useRouteFocus } from './layout/useRouteFocus'
import { useScrollRestoration } from './layout/useScrollRestoration'
import styles from './SocialChannel.module.css'

/** The `id` the skip link targets. */
const MAIN_ID = 'social-main'

/**
 * The channel. Supplies the default (React Router) navigation provider unless one
 * is already mounted above it (C6's memory provider).
 */
export function SocialChannel() {
  const hasNavigation = useHasSocialNavigation()
  const frame = (
    <SocialDirectoryProvider>
      <SocialFrame />
    </SocialDirectoryProvider>
  )
  return hasNavigation ? frame : <SocialNavigationProvider>{frame}</SocialNavigationProvider>
}

/** The three-column frame. Everything here sits under a navigation provider. */
function SocialFrame() {
  const { variant } = useShellContext()
  const session = useSession()
  const { self, loading: directoryLoading } = useSocialDirectory()
  const { location, kind } = useSocialNavigation()

  const mainRef = useRef<HTMLElement>(null)
  const postButtonRef = useRef<HTMLButtonElement>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  useRouteFocus(mainRef, location.pathname)
  useScrollRestoration(location.key, kind === 'browser')

  // The Post button is absent -- not disabled -- unless this mount may compose AND
  // the session can post (a persona-less session would only open a modal that says
  // "posting isn't available"). The composer self-guards on `isReadOnly` too.
  const canCompose =
    affordancesAvailable(variant) && !session.isReadOnly && session.personaId !== undefined
  // A staff `preview` / `kiosk` mount must never expose a sign-out (it would sign
  // the STAFF user out); only a real participant mount gets the account card.
  const showAccount = variant === 'full' || variant === 'readOnly'
  // The account card IS this channel's sign-out: tell the shell not to add its own.
  useClaimShellAccountControl(showAccount)
  // A persona-bound session whose cast has not loaded yet has no name/avatar to show;
  // drawing the bare Sign-out-only card for those few frames and then swapping it for
  // the full one would flash and shift the rail (and remount the button under a
  // pointer). Hold the card back until the persona resolves. If the cast FAILS to
  // load (`loading` false, `self` still unknown) the bare card is the right fallback.
  const awaitingSelf = session.personaId !== undefined && self === undefined && directoryLoading

  // The dialog belongs to the page it was opened on: if the route changes under it
  // (browser Back / Forward are the only way, the frame behind it being inert) it
  // closes in the SAME render -- adjusted during render, not in an effect, so it
  // never commits on the new page (where it would make the frame inert and swallow
  // the focus the route-change rule is about to move onto the new heading).
  const [composePathname, setComposePathname] = useState(location.pathname)
  if (composePathname !== location.pathname) {
    setComposePathname(location.pathname)
    if (composeOpen) setComposeOpen(false)
  }

  const openCompose = useCallback(() => setComposeOpen(true), [])
  const closeCompose = useCallback(() => setComposeOpen(false), [])

  const handleSkip = (event: MouseEvent<HTMLAnchorElement>) => {
    // A real hash navigation would push `#social-main` onto history; move focus instead.
    event.preventDefault()
    mainRef.current?.focus()
  }

  return (
    <div className={styles.channel} data-testid="social-channel">
      <a className={styles.skipLink} href={`#${MAIN_ID}`} onClick={handleSkip}>
        Skip to main content
      </a>

      {/* `inert` while the compose modal is open: nothing behind it can take focus
          or be read by assistive tech (the modal also traps Tab itself). */}
      <div className={styles.frame} inert={composeOpen}>
        <NavRail
          {...(canCompose ? { onCompose: openCompose } : {})}
          postButtonRef={postButtonRef}
          self={self}
          showAccount={showAccount && !awaitingSelf}
        />

        <main
          id={MAIN_ID}
          ref={mainRef}
          tabIndex={-1}
          className={styles.main}
          data-testid="social-main"
          data-route={matchSocialRoute(location.pathname)}
        >
          <SocialRoutes />
        </main>

        <RightRailContent />
      </div>

      {composeOpen && <ComposeModal onClose={closeCompose} returnFocusRef={postButtonRef} />}
    </div>
  )
}
