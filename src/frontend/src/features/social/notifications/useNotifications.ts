/**
 * features/social/notifications/useNotifications.ts
 * ---------------------------------------------------------------------------
 * The React read side of the notifications store (demo-polish F7, story 16): three
 * `useSyncExternalStore` hooks over the app-wide {@link notificationsStore}. Participant
 * world -- no UI, no COBRA.
 *
 *   useNotificationsSummary()     { available, unread } -- all the nav rail needs. The store
 *                                 hands back the SAME object until `available` or `unread`
 *                                 changes, so the rail re-renders on a badge change and on
 *                                 nothing else (not on every new row).
 *   useNotifications()            the page's snapshot: status, rows, hidden count, unread.
 *   useNotificationsAnnouncement() the latest polite announcement string + its sequence.
 *
 * They read the app-wide singleton on purpose: the rail (every route) and the page
 * (`/notifications`) have no shared ancestor this story owns, and a store is how they share
 * one engine. Tests start/reset that singleton (or drive `createNotificationsStore`
 * directly).
 */

import { useSyncExternalStore } from 'react'
import {
  notificationsStore,
  type NotificationsAnnouncement,
  type NotificationsSnapshot,
  type NotificationsSummary,
} from './notificationsStore'

/** Whether the bell exists, and how many ROWS are unread (see `NotificationsSummary`). */
export function useNotificationsSummary(): NotificationsSummary {
  return useSyncExternalStore(notificationsStore.subscribe, notificationsStore.getSummary)
}

/** The notifications page's state: status, newest rows, hidden count, unread. */
export function useNotifications(): NotificationsSnapshot {
  return useSyncExternalStore(notificationsStore.subscribe, notificationsStore.getSnapshot)
}

/** The latest polite announcement; `seq` changes for every one, even a repeat of the text. */
export function useNotificationsAnnouncement(): NotificationsAnnouncement {
  return useSyncExternalStore(notificationsStore.subscribe, notificationsStore.getAnnouncement)
}
