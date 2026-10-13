/**
 * features/social/notifications/NotificationsEngine.tsx
 * ---------------------------------------------------------------------------
 * Mounts the notifications engine and owns its polite live region (demo-polish F7,
 * story 16; SOC-070 lite, NFR-001). Participant world -- renders one visually hidden
 * element; no COBRA, no MUI.
 *
 * `SocialChannel` renders it ONCE, as a sibling of the frame (not inside it), so the engine runs
 * on every route -- the badge in the rail must keep counting while the viewer reads Home or a
 * thread -- and is torn down only when the channel unmounts. It sits OUTSIDE the frame on
 * purpose: the frame goes `inert` while the compose modal is open, and a live region inside
 * it would be inert too, silently dropping any announcement made while the participant is
 * composing (S-5). A test pins that the region has no `[inert]` ancestor with the modal open.
 *
 * START / STOP. When the viewer is eligible (`useNotificationsEligibility`: an interactive,
 * persona-bound, not read-only participant whose persona has resolved) it starts a store
 * session keyed by exercise + persona + handle and stops it on cleanup. The effect depends
 * on those primitives only, so it restarts exactly when the viewer changes, never on a
 * re-render. React StrictMode's dev-only mount/unmount/mount simply stops and restarts the
 * session (the store's `stop` is idempotent and releases the shared arrival source's
 * reference each time).
 *
 * THE LIVE REGION. A persistent `role="status"` / `aria-live="polite"` / `aria-atomic`
 * element is mounted from the first render, EMPTY: a polite region has to exist before its
 * content changes for a screen reader to announce the change reliably. The store sets the
 * text ("1 new reply", "14 new replies", "3 new notifications", "All notifications marked as
 * read"), already throttled so a burst is spoken once, not per arrival (SOC-071). The text
 * lives in a `<span key={seq}>` so a repeat of the same sentence is a new node and is spoken
 * again. Polite, never assertive: the viewer's place is never taken.
 *
 * It renders even for an ineligible viewer (an empty, inert region): there is nothing to
 * announce, and it is invisible.
 */

import { useEffect } from 'react'
import { notificationsStore } from './notificationsStore'
import { useNotificationsAnnouncement } from './useNotifications'
import { useNotificationsEligibility } from './useNotificationsEligibility'
import styles from './NotificationsEngine.module.css'

export function NotificationsEngine() {
  const eligibility = useNotificationsEligibility()
  const announcement = useNotificationsAnnouncement()

  const ready = eligibility.kind === 'ready'
  const exerciseId = eligibility.kind === 'ready' ? eligibility.exerciseId : ''
  const personaId = eligibility.kind === 'ready' ? eligibility.personaId : ''
  const handle = eligibility.kind === 'ready' ? eligibility.handle : ''

  useEffect(() => {
    if (!ready) return
    return notificationsStore.start({ exerciseId, personaId, handle })
  }, [ready, exerciseId, personaId, handle])

  return (
    <div
      className={styles.live}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="notifications-live"
    >
      <span key={announcement.seq}>{announcement.text}</span>
    </div>
  )
}
