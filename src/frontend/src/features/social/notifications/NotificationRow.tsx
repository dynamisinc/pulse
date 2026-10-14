/**
 * features/social/notifications/NotificationRow.tsx
 * ---------------------------------------------------------------------------
 * One row of the notifications page (demo-polish F7, story 16 "Page"; NFR-001, COR-053,
 * SOC-071). Participant world: plain elements, a scoped CSS Module and FontAwesome -- no
 * COBRA, no MUI.
 *
 * WHAT A ROW IS. A *group* (see `notificationTypes`): "Alex Kim and 3 others replied to your
 * post", "Dana mentioned you", "Your post got 5 new likes". The whole row is ONE real
 * `<a href>` to the thread it is about (built with `socialPaths.thread`), so it is natively
 * keyboard-operable, "open in new tab" works, and a plain click is routed through the
 * channel's navigation adapter (`activateLink` -> the `onOpen` callback), never the browser.
 *
 * TYPE IS NEVER COLOUR ALONE (NFR-001). Every row carries its type TWICE as non-colour
 * information: a FontAwesome icon (reply arrow / @ / heart) AND a text label ("Reply" /
 * "Mention" / "Like"). Unread is also three cues, not a tint alone: a "New" text tag, a
 * heavier summary and the row wash. The icon is decorative (`aria-hidden`); the label and the
 * sentence carry the meaning for assistive technology.
 *
 * SCENARIO TIME (COR-053). The time is the group's newest event, rendered through the
 * caller's `format` (one `useScenarioTime` snapshot for the whole page, so every row agrees)
 * as a relative stamp with the absolute scenario time in the `title`. Wall-clock never shows.
 *
 * NAMES COME FROM THE SHARED DIRECTORY (`useSocialDirectory`, passed in): the model holds
 * persona ids only. A person the cast does not list reads "Someone" -- never a raw id.
 * Display names and excerpts are rendered as React text, so a hostile name or post text
 * cannot inject markup (NFR-004); the excerpt was sanitized on the way in (`sanitize.ts`).
 *
 * Memoized: the model hands back the SAME item object for a row that did not change, so under
 * a burst only the rows that moved re-render.
 */

import { memo, type MouseEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faAt, faHeart, faReply } from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import type { FormatScenarioTimeOptions } from '@/core/clock'
import { Avatar } from '../components/Avatar'
import { activateLink } from '../explore/exploreNavigation'
import { socialPaths } from '../layout/socialNavigation'
import { describeItem, UNKNOWN_ACTOR } from './notificationText'
import type { NotificationItem, NotificationType } from './notificationTypes'
import styles from './NotificationsPage.module.css'

/** The visible type label and icon per notification type. */
const TYPE_PRESENTATION: Record<NotificationType, { label: string; icon: IconDefinition }> = {
  reply: { label: 'Reply', icon: faReply },
  mention: { label: 'Mention', icon: faAt },
  like: { label: 'Like', icon: faHeart },
}

export interface NotificationRowProps {
  readonly item: NotificationItem
  /** Persona id -> persona, from the channel's shared directory. */
  readonly findById: (personaId: string) => Persona | undefined
  /** Scenario-time formatter from ONE `useScenarioTime` snapshot. */
  readonly format: (instant: string, opts?: FormatScenarioTimeOptions) => string
  /** Opens a post's thread (the channel's `openThread`). */
  readonly onOpenThread: (postId: string, authorHandle?: string) => void
}

function NotificationRowImpl({ item, findById, format, onOpenThread }: NotificationRowProps) {
  const { label, icon } = TYPE_PRESENTATION[item.type]
  const actors = item.actorIds.map(findById)
  const names = actors.map(actor => actor?.displayName ?? UNKNOWN_ACTOR)
  // A top-level mention IS its subject post: its author is the newest actor, so the URL's
  // (cosmetic) handle segment can still be a real handle.
  const handle = item.subjectHandle ?? actors[0]?.handle
  const href = socialPaths.thread(item.subjectPostId, handle)

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) =>
    activateLink(event, () => onOpenThread(item.subjectPostId, handle))

  return (
    <li
      className={item.unread ? `${styles.row} ${styles.rowUnread}` : styles.row}
      data-testid="notification-row"
      data-type={item.type}
      data-unread={item.unread ? 'true' : 'false'}
    >
      <a className={styles.link} href={href} onClick={handleClick}>
        <span className={styles.iconWrap} aria-hidden="true">
          <FontAwesomeIcon icon={icon} />
        </span>
        <span className={styles.content}>
          {actors.length > 0 && (
            <span className={styles.avatars} aria-hidden="true">
              {actors.map((actor, index) =>
                actor === undefined
                  ? null
                  : <Avatar key={`${actor.id}-${index}`} persona={actor} size={28} />,
              )}
            </span>
          )}
          <span className={styles.meta}>
            <span className={styles.kind}>{label}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.at} title={format(item.at, { format: 'absolute' })}>
              {format(item.at, { format: 'relative' })}
            </time>
            {item.unread && <span className={styles.newTag}>New</span>}
          </span>
          <span className={styles.summary}>{describeItem(item, names)}</span>
          {item.excerpt !== '' && <span className={styles.excerpt}>{item.excerpt}</span>}
        </span>
      </a>
    </li>
  )
}

export const NotificationRow = memo(NotificationRowImpl)
