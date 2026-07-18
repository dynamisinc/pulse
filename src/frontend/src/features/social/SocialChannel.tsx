/**
 * features/social/SocialChannel.tsx
 * ---------------------------------------------------------------------------
 * The Pulse "Social" channel — the integration composition mounted as the
 * participant shell's DEFAULT channel (Wave S2; feeds-discovery/01 + posts/01 +
 * threads-replies/01+02). This is the seam that turns four independently-built
 * stories into one working surface; App.tsx's `ParticipantShellRoute` renders
 * it in the shell's channel mount point (replacing the Phase-1 placeholder).
 *
 * WHAT IT COMPOSES
 *  - `<Composer>` (posts/01) at the top — but only when the shell variant grants
 *    interactive affordances (`affordancesAvailable(variant)`; COR-015/D1-011).
 *    In an observer / read-only / preview session the composer is ABSENT (the
 *    component also self-guards on `session.isReadOnly`, belt-and-braces).
 *  - `<Feed>` (feeds-discovery/01) below it — the All Posts firehose, the
 *    default landing surface. Its `onOpenThread` is wired to open a thread.
 *  - `<ThreadView>` (threads-replies/01) — shown IN PLACE of the feed+composer
 *    when a post is opened (via its body-tap OR its reply affordance,
 *    threads-replies/02 / SOC-011), with a "Back to feed" control.
 *
 * NAVIGATION MODEL (Phase 1): the shell mounts exactly ONE channel and has no
 * cross-channel router yet (channelNavConfig is a single-channel catalog), so
 * "open a post's thread" is local view state HERE (`openThreadId`), not a URL
 * route — the whole point of keeping it in the channel. `ThreadView` emits its
 * own `'view'` (thread-open) telemetry on mount (XC-004), so opening a thread
 * is instrumented without this component emitting anything itself.
 *
 * WHY NO `onPosted` WIRING (S2): a published post is sanitized + instrumented by
 * `createPost` and the composer clears itself, but it does NOT appear in the
 * feed here. Live/own-post insertion is feeds-discovery story 04 (the real-time
 * "new posts" pill, explicitly out of this wave), and the mock cast does not
 * seed the current participant persona as a feed author, so an optimistic
 * prepend would be dropped by the feed's author resolution anyway. Story 04
 * owns that seam (`Composer`'s `onPosted` prop is already there for it).
 *
 * World: participant (Pulse skin) — no COBRA, no themed MUI, FontAwesome only,
 * plain semantic elements + a scoped CSS Module.
 */

import { useCallback, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { Composer } from './components/Composer'
import { Feed } from './pages/Feed'
import { ThreadView } from './components/ThreadView'
import styles from './SocialChannel.module.css'

export function SocialChannel() {
  const { variant } = useShellContext()
  const canCompose = affordancesAvailable(variant)

  // Local view state — Phase 1 has no cross-channel router (see module header).
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)

  // Stable identities so the feed's memoized rows still skip re-render under
  // burst even though a callback is threaded down (NFR-002/SOC-071).
  const openThread = useCallback((id: string) => setOpenThreadId(id), [])
  const closeThread = useCallback(() => setOpenThreadId(null), [])

  if (openThreadId !== null) {
    return (
      <div className={styles.channel} data-testid="social-channel">
        <button type="button" className={styles.back} onClick={closeThread}>
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" className={styles.backIcon} />
          Back to feed
        </button>
        <ThreadView focusedPostId={openThreadId} />
      </div>
    )
  }

  return (
    <div className={styles.channel} data-testid="social-channel">
      {canCompose && <Composer />}
      <Feed onOpenThread={openThread} />
    </div>
  )
}
