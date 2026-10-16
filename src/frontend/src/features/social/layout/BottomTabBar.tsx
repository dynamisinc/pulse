/**
 * features/social/layout/BottomTabBar.tsx
 * ---------------------------------------------------------------------------
 * The PHONE primary navigation (mobile-tablet story 02, decision MT-D2). Below the phone
 * breakpoint (`PHONE_QUERY`, 600px) it replaces the left `NavRail`: a fixed bar along the
 * bottom edge with **Home - Explore - Post - Notifications - Profile**. Tablet and desktop
 * keep the rail, untouched.
 *
 * It mirrors the rail's rules so the two are interchangeable:
 *  - REAL ANCHORS (`<a href>`), routed through the navigation adapter on a plain click;
 *    modified clicks fall through to the browser (browser kind only), like the rail.
 *  - ACTIVE TAB = `aria-current="page"` on exactly one link, and never colour alone: the
 *    active tab is also bolder and carries an accent bar along its top edge (NFR-001).
 *  - ABSENT, NOT DISABLED (D1-011): Profile only for a persona-bound session; Post only when
 *    the host passes `onCompose`; Notifications only when `showNotifications` AND the
 *    notifications engine runs for this viewer (so a flagged-off / read-only / observer
 *    session never gets a dead tab; `/notifications` itself redirects Home for them).
 *  - THE BADGE is the unread count as TEXT ("3", "99+"), and the link's accessible name
 *    carries it ("Notifications, 3 unread"); the visible badge is hidden from AT so it is
 *    not read twice. Same helpers as the rail (`notifications/unreadBadge`).
 *
 * TARGETS. Each tab is a full-height flex cell (>= 44px in both axes: 56px tall, at least
 * 72px wide at 360px with five cells); the Post button is a 48px accent disc.
 *
 * SAFE AREA. The bar is `position: fixed` to the bottom (above the shell's bottom EXERCISE
 * banner, `--pulse-chrome-bottom`) and pads itself by `env(safe-area-inset-bottom)` so the
 * home indicator never overlaps a tab. The frame reserves the same space
 * (`SocialChannel.module.css`) so the last post and the composer are never covered.
 *
 * World: participant. CSS Module reading the channel's `--pc-*` tokens + FontAwesome only;
 * no COBRA, no MUI.
 */

import type { Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBell,
  faFeatherPointed,
  faHashtag,
  faHouse,
  faUser,
} from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import { formatUnreadBadge, notificationsLinkName } from '../notifications/unreadBadge'
import { useNotificationsSummary } from '../notifications/useNotifications'
import {
  EXPLORE_PATH,
  HOME_PATH,
  NOTIFICATIONS_PATH,
  soleSegment,
  socialPaths,
  useSocialLinkClick,
  useSocialNavigation,
} from './socialNavigation'
import styles from './BottomTabBar.module.css'

export interface BottomTabBarProps {
  /** Opens the compose modal. Omit it and the Post button is ABSENT (D1-011). */
  onCompose?: () => void
  /** Ref to the Post button, so the host can return focus to it when the modal closes. */
  postButtonRef?: Ref<HTMLButtonElement>
  /** The viewer's persona; drives the Profile tab. */
  self: Persona | undefined
  /** Whether this mount may show the Notifications tab (shell grants affordances). */
  showNotifications?: boolean
}

interface TabSpec {
  readonly id: 'home' | 'explore' | 'notifications' | 'profile'
  readonly label: string
  readonly path: string
  readonly icon: IconDefinition
}

export function BottomTabBar({
  onCompose,
  postButtonRef,
  self,
  showNotifications = false,
}: BottomTabBarProps) {
  const { location } = useSocialNavigation()
  const handleLinkClick = useSocialLinkClick()
  const { available: notificationsAvailable, unread } = useNotificationsSummary()
  const current = soleSegment(location.pathname)

  const home: TabSpec = { id: 'home', label: 'Home', path: HOME_PATH, icon: faHouse }
  const explore: TabSpec = { id: 'explore', label: 'Explore', path: EXPLORE_PATH, icon: faHashtag }
  const bell: TabSpec | undefined = showNotifications && notificationsAvailable
    ? { id: 'notifications', label: 'Notifications', path: NOTIFICATIONS_PATH, icon: faBell }
    : undefined
  const profile: TabSpec | undefined = self !== undefined
    ? { id: 'profile', label: 'Profile', path: socialPaths.profile(self.handle), icon: faUser }
    : undefined

  const isActive = (tab: TabSpec): boolean => {
    // Derived from the tab's own path (not its id), so the two can never drift apart.
    return current !== undefined && current === soleSegment(tab.path)
  }

  const renderTab = (tab: TabSpec) => {
    const active = isActive(tab)
    const isBell = tab.id === 'notifications'
    return (
      <li key={tab.id} className={styles.cell}>
        <a
          className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          href={tab.path}
          aria-current={active ? 'page' : undefined}
          aria-label={isBell ? notificationsLinkName(unread) : undefined}
          data-testid={`tab-${tab.id}`}
          onClick={event => handleLinkClick(event, tab.path)}
        >
          <span className={styles.iconWrap}>
            <FontAwesomeIcon icon={tab.icon} aria-hidden="true" className={styles.icon} />
            {isBell && unread > 0 && (
              <span className={styles.badge} aria-hidden="true" data-testid="tab-notifications-badge">
                {formatUnreadBadge(unread)}
              </span>
            )}
          </span>
          <span className={styles.label}>{tab.label}</span>
        </a>
      </li>
    )
  }

  return (
    <nav className={styles.bar} aria-label="Primary" data-testid="bottom-tab-bar">
      <ul className={styles.list}>
        {renderTab(home)}
        {renderTab(explore)}
        {onCompose !== undefined && (
          <li className={styles.cell}>
            <button
              ref={postButtonRef}
              type="button"
              className={styles.post}
              aria-label="Post"
              data-testid="tab-post"
              onClick={onCompose}
            >
              <FontAwesomeIcon icon={faFeatherPointed} aria-hidden="true" className={styles.postIcon} />
            </button>
          </li>
        )}
        {bell !== undefined && renderTab(bell)}
        {profile !== undefined && renderTab(profile)}
      </ul>
    </nav>
  )
}
