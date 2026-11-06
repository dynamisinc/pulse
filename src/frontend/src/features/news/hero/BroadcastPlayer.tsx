/**
 * features/news/hero/BroadcastPlayer.tsx
 * ---------------------------------------------------------------------------
 * The news hero's broadcast-style video player (news story 05; NWS-014, NWS-032,
 * NFR-008, NFR-001). ONE player for every outlet: skins change its tint, never its anatomy.
 *
 *   +----------------------------------------------+  <- shared VideoPlayer wrapper
 *   | EXERCISE EXERCISE EXERCISE   (bands, shared) |     (the element that fullscreens)
 *   |                                              |
 *   |                (poster / video)              |
 *   | EXERCISE EXERCISE EXERCISE        [EXERCISE] |  <- chip box ends above the row
 *   | [play] [----o------] 0:12 / 1:30 [mute][full]|  <- PlayerControls, tinted
 *   +----------------------------------------------+
 *
 *  - NOT A SECOND VIDEO STACK: this wraps the shared `VideoPlayer` from
 *    `@/core/media/player` (F14, news FU-9) and only swaps its control row in through
 *    `renderControls`. No autoplay (`preload="metadata"`, the poster first), one video at
 *    a time, wrapper-only fullscreen (so the chip and bands survive), the Pause / EndEx
 *    overlay pause and the EXERCISE bands are all the shared player's.
 *  - WATERMARK (NWS-032 / NFR-008): F14's `WatermarkSlot` is drawn bottom-right of the
 *    video FRAME, inside a box that stops at the control row, so it never overlaps the
 *    controls. It is always mounted (space reserved when not required) and is not
 *    restyled here: no prop or token reaches it.
 *  - The `--pulse-skin-player-tint` / `--pulse-skin-on-player-tint` custom properties
 *    (F13, from `skin.media.playerTint`) are the only skin input.
 *  - `onPlayProgress` (optional) reports the first play and the 50% / 100% milestones,
 *    for story 19's telemetry hook. Nothing is emitted from here.
 *
 * Participant world: CSS Module + FontAwesome, no COBRA, no MUI.
 */

import { useEffect, useRef } from 'react'
import { VideoPlayer } from '@/core/media/player'
import type { PlayerControlsApi } from '@/core/media/player'
import { WatermarkSlot } from '@/features/channels'
import type { ContentMediaDto } from '@/features/channels'
import { reachedMilestones } from './heroModel'
import type { PlayProgressEvent } from './heroModel'
import { PlayerControls } from './PlayerControls'
import styles from './BroadcastPlayer.module.css'

export interface BroadcastPlayerProps {
  /** A `video` media item from the contract (signed, host-relative URLs). */
  readonly media: ContentMediaDto
  /** Id of the visible caption, read as the player's accessible description. */
  readonly describedBy?: string
  /** First play and 50% / 100% milestones (news story 19 wires telemetry to it). */
  readonly onPlayProgress?: (event: PlayProgressEvent) => void
  /** The shared player's in-app fullscreen fallback (no native fullscreen API). */
  readonly onRequestModal?: (trigger: HTMLElement, startAt?: number) => void
}

export function BroadcastPlayer({
  media,
  describedBy,
  onPlayProgress,
  onRequestModal,
}: BroadcastPlayerProps) {
  return (
    <div className={styles.root} data-testid="broadcast-player">
      <VideoPlayer
        media={{
          id: media.id,
          kind: 'video',
          url: media.url,
          alt: media.alt,
          posterUrl: media.posterUrl ?? undefined,
          width: media.width ?? undefined,
          height: media.height ?? undefined,
          durationSec: media.durationSec ?? undefined,
        }}
        className={styles.frame}
        describedBy={describedBy}
        onRequestModal={onRequestModal}
        overlay={
          <div className={styles.chipBox} data-testid="broadcast-chip-box">
            <WatermarkSlot />
          </div>
        }
        renderControls={api => (
          <ProgressReportingControls api={api} onPlayProgress={onPlayProgress} />
        )}
      />
    </div>
  )
}

function ProgressReportingControls({
  api,
  onPlayProgress,
}: {
  readonly api: PlayerControlsApi
  readonly onPlayProgress: ((event: PlayProgressEvent) => void) | undefined
}) {
  // What has been reported for this mount (HeroSlot keys the player by media id).
  const progress = useRef({ played: false, reported: new Set<number>() })
  const latestCallback = useRef(onPlayProgress)
  useEffect(() => {
    latestCallback.current = onPlayProgress
  })
  const { playing, currentTime, duration } = api
  useEffect(() => {
    const report = (event: PlayProgressEvent) => latestCallback.current?.(event)
    const state = progress.current
    if (playing && !state.played) {
      state.played = true
      report({ type: 'play' })
    }
    if (!state.played) return
    for (const pct of reachedMilestones(currentTime, duration, state.reported)) {
      state.reported.add(pct)
      report({ type: 'progress', pct })
    }
  }, [playing, currentTime, duration])

  return <PlayerControls api={api} />
}
