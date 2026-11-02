/**
 * features/portal/layout/ModuleFrame.tsx
 * ---------------------------------------------------------------------------
 * The section frame every portal module renders through (exercise-portal story
 * 07, #772; PRT-003, PRT-020, NFR-001).
 *
 *  - A labelled `section` with a real `h2` (the masthead owns the page's `h1`).
 *  - An optional "See all" link to the source channel's home, in-content and
 *    not navigation chrome (conflict C-1). It renders only while that channel
 *    is enabled, so a disabled channel leaves no dangling door (D2-005).
 *  - A polite live-region slot (F14 `LiveRegionAnnouncer`; never assertive).
 *  - `loading` shows the heading over a quiet static skeleton. `empty` and
 *    `error` render NOTHING, heading and link included, and tell the layout so
 *    an emptied region collapses (fail closed: no placeholder box).
 *
 * Styling comes from the skin variables (`--pulse-skin-*`) with neutral
 * fallbacks. Participant world: CSS Module, no COBRA, no MUI component.
 */

import { useId, useLayoutEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { LiveRegionAnnouncer } from '@/features/channels/primitives'
import { PORTAL_MODULE_CHANNELS, type PortalModuleId } from '../contract'
import { channelHomePath } from './channelHome'
import { usePortalFrameEnvironment } from './frameEnvironmentContext'
import { usePortalLayoutSlot } from './layoutSlot'
import type { ModuleFrameStatus } from './types'
import styles from './ModuleFrame.module.css'

export interface ModuleFrameProps {
  readonly moduleId: PortalModuleId
  /** The module heading (an `h2`), also the section's accessible name. */
  readonly title: string
  /** `empty` / `error` hide the whole module; `loading` shows a skeleton. */
  readonly status: ModuleFrameStatus
  /** Show the "See all" link (only ever while the source channel is enabled). Default `true`. */
  readonly seeAll?: boolean
  /** The link's visible text. Default `"See all"`; its accessible name appends the title. */
  readonly seeAllLabel?: string
  /** Arrivals to announce politely, as F14's `LiveRegionAnnouncer` counts them. */
  readonly announce?: {
    readonly arrivals: number
    readonly noun?: { readonly one: string; readonly other: string }
  }
  readonly children?: ReactNode
}

export function ModuleFrame(props: ModuleFrameProps) {
  const { moduleId, title, status, seeAll = true, seeAllLabel = 'See all', announce, children } = props
  const headingId = useId()
  const environment = usePortalFrameEnvironment()
  const slot = usePortalLayoutSlot()
  const hidden = status === 'empty' || status === 'error'

  useLayoutEffect(() => {
    if (!slot) return undefined
    slot.setModuleHidden(moduleId, hidden)
    return () => slot.setModuleHidden(moduleId, false)
  }, [slot, moduleId, hidden])

  if (hidden) return null

  const channelId = PORTAL_MODULE_CHANNELS[moduleId]
  const showSeeAll = seeAll && environment.isChannelEnabled(channelId)
  const loading = status === 'loading'

  return (
    <section
      className={styles.frame}
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      data-portal-module={moduleId}
      data-status={status}
    >
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>{title}</h2>
        {showSeeAll && (
          <Link
            to={channelHomePath(channelId)}
            className={styles.seeAll}
            onClick={() => environment.trackClick(moduleId)}
            // Distinct names per module; starts with the visible text (WCAG 2.5.3 label in name).
            aria-label={`${seeAllLabel} ${title}`}
            data-testid="module-see-all"
          >
            {seeAllLabel}
            <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" className={styles.seeAllIcon} />
          </Link>
        )}
      </div>
      {announce && <LiveRegionAnnouncer arrivals={announce.arrivals} noun={announce.noun} />}
      {loading ? (
        <div className={styles.loading} data-testid="module-loading">
          <span className={styles.srOnly}>Loading</span>
          <span className={styles.skeletonLine} aria-hidden="true" />
          <span className={styles.skeletonLine} aria-hidden="true" />
          <span className={styles.skeletonLineShort} aria-hidden="true" />
        </div>
      ) : (
        <div className={styles.body}>{children}</div>
      )}
    </section>
  )
}
