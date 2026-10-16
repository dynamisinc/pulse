/**
 * features/social/notifications/NotificationsPage.tsx
 * ---------------------------------------------------------------------------
 * The `/notifications` page (demo-polish F7, story 16 "Page"; SOC-070 lite, SOC-071,
 * NFR-001, COR-053, XC-004). Participant world (Pulse Social skin): plain elements, a scoped
 * CSS Module and FontAwesome -- NO COBRA, NO themed MUI.
 *
 * WHAT IT SHOWS. A labelled page (`<h1>Notifications</h1>`) listing the derived rows
 * newest first -- replies to my posts, @mentions of me, and "Your post got N new likes" --
 * each with a typed icon AND a text label (`NotificationRow`). Activating a row opens the
 * thread it is about, through the channel's navigation adapter. "Mark all read" is the one
 * control: it clears the rail's badge, persists per persona in `localStorage` under an
 * exercise-, persona- and account-scoped key, and is announced politely.
 *
 * THE DATA is the engine's snapshot (`useNotifications`): this page derives nothing and
 * fetches nothing. The engine (`NotificationsEngine`, mounted by `SocialChannel`) keeps
 * running on every route, so the list is already warm when the viewer arrives and is live
 * while they read it. Under a burst the rows are groups, so the page stays legible
 * (SOC-071) -- a mention storm is ONE row ("Keisha and 41 others mentioned you") -- and only
 * the newest {@link MAX_NOTIFICATION_ROWS} are drawn, the rest counted in a note, so the DOM
 * stays bounded too (NFR-002).
 *
 * STATES -- all text, none colour-only (NFR-001):
 *   - the cast / first read still loading: "Loading notifications..." (a polite status);
 *   - the cast or the first read failed: "Notifications are not available right now.";
 *   - nothing derived: an honest empty state ("Nothing here yet ...") -- never a placeholder
 *     row, never a made-up notification.
 *
 * ABSENT, NOT INERT (D1-011 / COR-015). A read-only, observer, kiosk, preview or persona-less
 * session has no notifications at all: the rail draws no bell, and a visit to this URL is
 * redirected Home (like any other route the viewer may not use) instead of rendering a page
 * that could do nothing.
 *
 * "MARK ALL READ" KEEPS FOCUS. The button stays in place after it is used (it becomes
 * `aria-disabled`, still focusable, and a no-op) rather than disappearing out from under a
 * keyboard user's focus.
 *
 * SCENARIO TIME (COR-053): every row's time comes from ONE `useScenarioTime(timeZone)`
 * snapshot, bound to the exercise's zone; nothing here reads the wall clock.
 *
 * TELEMETRY (XC-004). One `view` event per mount, ref-guarded against re-renders and
 * StrictMode's double effect -- the same shape as Explore's and the hashtag page's,
 * targeting the `notifications` page. The server emits no `view`, so the client does.
 */

import { useEffect, useRef } from 'react'
import { useSession } from '@/core/auth'
import { scenarioNow, useScenarioTime } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useSocialDirectory } from '../layout/socialDirectory'
import { HOME_PATH } from '../layout/socialNavigation'
import { SocialRedirect } from '../layout/routes/SocialRedirect'
import { useSocialOpeners } from '../layout/useSocialOpeners'
import { NotificationRow } from './NotificationRow'
import { notificationsStore } from './notificationsStore'
import { useNotifications } from './useNotifications'
import { useNotificationsEligibility } from './useNotificationsEligibility'
import styles from './NotificationsPage.module.css'

export function NotificationsPage() {
  const eligibility = useNotificationsEligibility()
  // Absent, not inert: such a session has no bell, so it has no page either (D1-011).
  if (eligibility.kind === 'unavailable') return <SocialRedirect to={HOME_PATH} />
  // Shell variant not resolved yet (cold load): render nothing, emit nothing,
  // redirect nothing until it is (MT-D8).
  if (eligibility.kind === 'resolving') return <div aria-busy="true" data-testid="notifications-resolving" />
  return <NotificationsBody castFailed={eligibility.kind === 'failed'} />
}

interface NotificationsBodyProps {
  /** The persona cast settled without the viewer's persona: nothing can be derived. */
  readonly castFailed: boolean
}

function NotificationsBody({ castFailed }: NotificationsBodyProps) {
  const { items, status, unread, hiddenCount } = useNotifications()
  const { findById } = useSocialDirectory()
  const { openThread } = useSocialOpeners()
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { format } = useScenarioTime(timeZone)

  const viewEmittedRef = useRef(false)
  useEffect(() => {
    if (viewEmittedRef.current) return
    viewEmittedRef.current = true
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'notifications', entityId: 'notifications' },
    })
  }, [exerciseId, timeZone, session.accountId])

  const unavailable = castFailed || (status === 'error' && items.length === 0)
  // `inactive` is the one render between "eligible" and the engine's effect starting a session.
  const loading = !unavailable && (status === 'loading' || status === 'inactive')
  const empty = !unavailable && !loading && items.length === 0

  return (
    <section
      className={styles.page}
      aria-labelledby="notifications-heading"
      data-testid="notifications-page"
    >
      <header className={styles.header}>
        <h1 id="notifications-heading" className={styles.title}>Notifications</h1>
        {items.length > 0 && (
          <button
            type="button"
            className={styles.markAll}
            aria-disabled={unread === 0}
            data-testid="notifications-mark-all-read"
            onClick={() => {
              if (unread > 0) notificationsStore.markAllRead()
            }}
          >
            Mark all read
          </button>
        )}
      </header>

      {loading && <p className={styles.state} role="status">Loading notifications…</p>}
      {unavailable && (
        <p className={styles.state} role="status">Notifications aren’t available right now.</p>
      )}
      {empty && (
        <p className={styles.state} data-testid="notifications-empty">
          Nothing here yet. Replies, @mentions and likes on your posts will show up here.
        </p>
      )}

      {items.length > 0 && (
        <ol className={styles.list} role="list" data-testid="notifications-list">
          {items.map(item => (
            <NotificationRow
              key={item.id}
              item={item}
              findById={findById}
              format={format}
              onOpenThread={openThread}
            />
          ))}
        </ol>
      )}

      {hiddenCount > 0 && (
        <p className={styles.state} data-testid="notifications-hidden">
          {hiddenCount === 1
            ? '1 older notification is not shown.'
            : `${hiddenCount} older notifications are not shown.`}
        </p>
      )}
    </section>
  )
}
