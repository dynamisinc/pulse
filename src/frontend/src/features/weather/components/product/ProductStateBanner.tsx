/**
 * features/weather/components/product/ProductStateBanner.tsx
 * ---------------------------------------------------------------------------
 * The product-state banner (weather-source story 07, #758; COR-053, NFR-001):
 *
 *   [⏱ EFFECTIVE IN 2 HR 5 MIN]   [⌛ EXPIRED]   [⊘ CANCELLED]
 *
 * An active product shows no banner ("IN EFFECT UNTIL …" is the default
 * reading). The state is recomputed from the scenario clock, so a time jump or
 * the expiry instant flips it without a refetch:
 *  - pass `scenarioNow` when the parent already holds one "now" for a whole
 *    list (one snapshot per render pass, no timer per row);
 *  - omit it and the banner follows the live clock itself (`useScenarioTime`:
 *    the clock's change notification plus a 30 s refresh).
 *
 * Icon + text, never colour alone; the icon is decorative. A visually hidden,
 * always-mounted `role="status"` region announces state CHANGES (EXPIRED,
 * CANCELLED, IN EFFECT, PENDING) once each; the countdown is never announced.
 * `className` styles the visible banner, so an active product takes no space.
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBan, faClock, faHourglassEnd } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useState } from 'react'
import { useScenarioTime } from '@/core/clock'
import type { WeatherProductState, WeatherProductStateSubject } from '@/features/weather/contract'
import { productBanner, type ProductBannerModel } from './productBanner'
import styles from './ProductStateBanner.module.css'

const BANNER_ICONS: Readonly<Record<ProductBannerModel['state'], IconDefinition>> = {
  pending: faClock,
  expired: faHourglassEnd,
  cancelled: faBan,
}

export interface ProductStateBannerProps {
  readonly product: WeatherProductStateSubject
  /** The other published weather products the caller holds (a published cancel wins). */
  readonly published?: readonly WeatherProductStateSubject[]
  /** The parent's scenario "now" snapshot; absent follows the live scenario clock. */
  readonly scenarioNow?: Date | string
  readonly className?: string
}

export function ProductStateBanner({ scenarioNow, ...rest }: ProductStateBannerProps) {
  if (scenarioNow !== undefined) return <BannerView {...rest} scenarioNow={scenarioNow} />
  return <LiveBanner {...rest} />
}

function LiveBanner(props: Omit<ProductStateBannerProps, 'scenarioNow'>) {
  const { now } = useScenarioTime()
  return <BannerView {...props} scenarioNow={now} />
}

/** What the status region says when the state CHANGES (never the countdown). */
const STATE_ANNOUNCEMENTS: Readonly<Record<WeatherProductState, string>> = {
  pending: 'PENDING',
  active: 'IN EFFECT',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
}

function BannerView({
  product,
  published,
  scenarioNow,
  className,
}: ProductStateBannerProps & { readonly scenarioNow: Date | string }) {
  const banner = productBanner(product, scenarioNow, published)
  const state: WeatherProductState = banner?.state ?? 'active'

  // Announce state CHANGES only. The region is always mounted and starts empty
  // (the visible banner already reads on first visit, and a live region that
  // mounts holding text is often not read anyway); a flip puts the state word
  // in it once. The per-minute countdown text never enters it, so a pending
  // product does not re-announce every minute.
  const [announcedFor, setAnnouncedFor] = useState(state)
  const [announcement, setAnnouncement] = useState('')
  if (state !== announcedFor) {
    setAnnouncedFor(state)
    setAnnouncement(STATE_ANNOUNCEMENTS[state])
  }

  return (
    <>
      <span role="status" className={styles.srOnly} data-testid="weather-product-state-region">
        {announcement}
      </span>
      {banner !== null && (
        <div
          className={[styles.banner, styles[banner.state], className].filter(Boolean).join(' ')}
          data-testid="weather-product-state-banner"
          data-product-state={banner.state}
        >
          <FontAwesomeIcon icon={BANNER_ICONS[banner.state]} className={styles.icon} aria-hidden="true" />
          <span>{banner.text}</span>
        </div>
      )}
    </>
  )
}
