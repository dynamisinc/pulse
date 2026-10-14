/**
 * features/social/notifications/unreadBadge.ts
 * ---------------------------------------------------------------------------
 * How the nav rail's bell talks about the unread count (demo-polish F7, story 16
 * "Bell and badge"; NFR-001, SOC-071). Two pure strings, kept together so what is SEEN and
 * what is HEARD can never drift apart. Participant world -- no UI.
 *
 *   formatUnreadBadge(n)       the visible badge TEXT: "3", capped at "99+" so a burst never
 *                              draws an illegibly wide number (the new-posts pill caps the
 *                              same way). Never a colour-only dot: the count is characters.
 *   notificationsLinkName(n)   the link's accessible name: "Notifications, 3 unread" (the
 *                              same capped text, so the name matches what is on screen --
 *                              WCAG 2.5.3 Label in Name), or just "Notifications" when
 *                              nothing is unread (then no badge is drawn either, so the
 *                              visible label and the name are the same words).
 */

import { BADGE_DISPLAY_CAP } from './notificationTypes'

/** The visible badge text for `unread` rows: the number, or `99+` above the cap. */
export function formatUnreadBadge(unread: number): string {
  return unread > BADGE_DISPLAY_CAP ? `${BADGE_DISPLAY_CAP}+` : String(unread)
}

/** The bell link's accessible name for `unread` rows. */
export function notificationsLinkName(unread: number): string {
  return unread > 0 ? `Notifications, ${formatUnreadBadge(unread)} unread` : 'Notifications'
}
