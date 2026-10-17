/**
 * features/pwa/serviceWorker/UpdateBanner.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 10. In-fiction "a fresh version is ready" banner, skinned with the
 * participant brand tokens (`--pulse-brand-*`, published by BrandThemeProvider). No COBRA, no
 * MUI, FontAwesome icon, 44px action targets, polite live region (no focus stealing). Copy is
 * brand-neutral and never says Pulse/Dynamis. Controlled: the owner decides when to show it.
 */
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons'
import styles from './UpdateBanner.module.css'

export interface UpdateBannerProps {
  onRefresh: () => void
  onLater: () => void
}

export function UpdateBanner({ onRefresh, onLater }: UpdateBannerProps) {
  return (
    <section className={styles.banner} role="status" aria-live="polite" aria-label="Update ready">
      <FontAwesomeIcon icon={faArrowsRotate} aria-hidden="true" className={styles.icon} />
      <span className={styles.text}>A fresh version is ready.</span>
      <button type="button" className={styles.primary} onClick={onRefresh}>
        Refresh
      </button>
      <button type="button" className={styles.secondary} onClick={onLater}>
        Later
      </button>
    </section>
  )
}
