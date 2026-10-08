/**
 * features/social/layout/NavRail.tsx
 * ---------------------------------------------------------------------------
 * The left rail of the three-column frame (demo-polish F1; D1-013 "240px nav
 * rail"): the Pulse logomark, the pill links **Home - Explore - Profile**, the
 * **Post** button, and the account card. It is the `nav[aria-label="Primary"]`
 * landmark -- the whole rail, so the logo, the links, Post and the account card
 * are one navigation region, as on the platforms this mimics.
 *
 * LINKS ARE REAL ANCHORS (`<a href>`), not buttons: you can see the URL, copy it,
 * open it in a new tab. A plain left-click is intercepted and routed through the
 * navigation adapter (so it is a push in-app, and a memory-only move under the
 * preview's memory provider); a modified click (ctrl/cmd/shift/alt/middle) falls
 * through to the browser in the browser kind, and is swallowed in the memory
 * kind, which has no URL of its own to open.
 *
 * ACTIVE STATE is `aria-current="page"` on exactly one pill -- never color alone:
 * the active pill is also heavier and carries an inset accent bar (NFR-001).
 *   - Home    -> `/home`
 *   - Explore -> `/explore`
 *   - Profile -> the viewer's own single-segment profile path (`/:handle`)
 *
 * ABSENT, NOT DISABLED (D1-011 / COR-015):
 *   - **Profile** appears only for a persona-bound session whose persona has
 *     resolved (it needs the persona's handle for its URL).
 *   - **Post** appears only when the mount may compose AND the session can post --
 *     `onCompose` is simply not passed otherwise, and no button renders.
 *   - Notifications and Messages are NOT here: out of scope for this story (F7 may
 *     add Notifications), and a dangling door is worse than none.
 *
 * ICON RAIL. Below 840px the rail collapses to icons: every label stays in the DOM
 * (visually hidden), so each control keeps its accessible name at every width.
 *
 * The logo/links/Post group is `sticky` below the shell's compliance banner and any
 * active alert (`--pulse-chrome-top` + `--pulse-alert-height`); the account card is
 * `sticky` above the bottom banner (`--pulse-chrome-bottom`) -- so neither can slide
 * under an EXERCISE banner or the alert, and the card (with Sign out) is on screen
 * at scroll 0 whatever the shell stacks above the channel. See `NavRail.module.css`.
 *
 * World: participant. CSS Module + FontAwesome only -- no COBRA, no MUI.
 */

import type { MouseEvent, Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faFeatherPointed, faHashtag, faHouse, faUser } from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import { AccountCard } from './AccountCard'
import { PulseLogo } from './PulseLogo'
import {
  EXPLORE_PATH,
  HOME_PATH,
  socialPaths,
  useSocialNavigation,
} from './socialNavigation'
import styles from './NavRail.module.css'

export interface NavRailProps {
  /**
   * Opens the compose modal. Omit it and the **Post** button is ABSENT (a
   * read-only / observer / persona-less session -- D1-011).
   */
  onCompose?: () => void
  /** Ref to the Post button, so the host can return focus to it when the modal closes. */
  postButtonRef?: Ref<HTMLButtonElement>
  /** The viewer's persona; drives the Profile pill and the account card. */
  self: Persona | undefined
  /**
   * Whether to render the account card (and its Sign out). Off for a `preview` /
   * `kiosk` mount: a staff preview must never be able to sign the staff user out.
   */
  showAccount: boolean
}

interface NavItemSpec {
  readonly id: 'home' | 'explore' | 'profile'
  readonly label: string
  readonly path: string
  readonly icon: IconDefinition
}

/** The single path segment of `pathname`, lower-cased, or `undefined` if it has more/none. */
function soleSegment(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(segment => segment !== '')
  const [only] = segments
  return segments.length === 1 && only !== undefined ? only.toLowerCase() : undefined
}

export function NavRail({ onCompose, postButtonRef, self, showAccount }: NavRailProps) {
  const { location, navigate, kind } = useSocialNavigation()
  const current = soleSegment(location.pathname)

  const items: NavItemSpec[] = [
    { id: 'home', label: 'Home', path: HOME_PATH, icon: faHouse },
    { id: 'explore', label: 'Explore', path: EXPLORE_PATH, icon: faHashtag },
  ]
  if (self !== undefined) {
    items.push({
      id: 'profile',
      label: 'Profile',
      path: socialPaths.profile(self.handle),
      icon: faUser,
    })
  }

  const isActive = (item: NavItemSpec): boolean => {
    if (current === undefined) return false
    if (item.id === 'home') return current === 'home'
    if (item.id === 'explore') return current === 'explore'
    return self !== undefined && current === self.handle.toLowerCase()
  }

  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    // Browser kind: let the browser own new-tab / download style clicks. Memory kind
    // has no URL of its own to open, so it always handles the click in-memory.
    if (kind === 'browser' && (modified || event.button !== 0)) return
    event.preventDefault()
    navigate(path)
  }

  return (
    <nav className={styles.rail} aria-label="Primary" data-testid="nav-rail">
      <div className={styles.top}>
        <a
          className={styles.logo}
          href={HOME_PATH}
          aria-label="Pulse home"
          onClick={event => handleLinkClick(event, HOME_PATH)}
        >
          <PulseLogo size={32} />
        </a>

        <ul className={styles.list}>
          {items.map(item => {
            const active = isActive(item)
            return (
              <li key={item.id}>
                <a
                  className={active ? `${styles.link} ${styles.linkActive}` : styles.link}
                  href={item.path}
                  aria-current={active ? 'page' : undefined}
                  onClick={event => handleLinkClick(event, item.path)}
                >
                  <FontAwesomeIcon icon={item.icon} aria-hidden="true" className={styles.icon} />
                  <span className={styles.label}>{item.label}</span>
                </a>
              </li>
            )
          })}
        </ul>

        {onCompose !== undefined && (
          <button
            ref={postButtonRef}
            type="button"
            className={styles.post}
            data-testid="nav-post-button"
            onClick={onCompose}
          >
            <FontAwesomeIcon icon={faFeatherPointed} aria-hidden="true" className={styles.postIcon} />
            <span className={styles.postLabel}>Post</span>
          </button>
        )}
      </div>

      {showAccount && (
        <div className={styles.bottom}>
          <AccountCard persona={self} />
        </div>
      )}
    </nav>
  )
}
