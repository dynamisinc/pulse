/**
 * features/pwa/dock/PwaDock.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet stories 10/11. A fixed, bottom-anchored stacking container shared by the
 * participant-world PWA banners (service-worker "update ready", install prompt) so they stack
 * instead of overlapping each other. It sits ABOVE the compliance chrome footer and the phone
 * bottom tab bar via shell CSS variables:
 *     bottom = --pulse-chrome-bottom + --pulse-tabbar-height (0 fallback; the tab bar lands
 *              in a separate PR and is expected to publish it) + the device safe-area inset.
 * It never covers the alert bar (top of the shell). It takes no space and no pointer events
 * itself; only its children are interactive. Empty => renders an inert zero-height node.
 *
 * LIMITATION: a bottom-docked composer (if the shell ever pins one) is not known to this
 * container; if it does it should publish its height into `--pulse-tabbar-height` or a
 * sibling var and extend `.dock` here.
 * World: participant. No COBRA / MUI.
 */
import type { ReactNode } from 'react'
import { SHELL_Z } from '@/features/participant-shell/mountContract'
import styles from './PwaDock.module.css'

/** Above content + channel nav, but below the alert bar (banners must never cover it). */
const DOCK_Z_INDEX = SHELL_Z.alertBar - 1

export interface PwaDockProps {
  children?: ReactNode
}

export function PwaDock({ children }: PwaDockProps) {
  return (
    <div className={styles.dock} style={{ zIndex: DOCK_Z_INDEX }} data-testid="pwa-dock">
      {children}
    </div>
  )
}
