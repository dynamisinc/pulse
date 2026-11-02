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
 * Icon + text, never colour alone; the icon is decorative. The banner sits in
 * an always-mounted `role="status"` region (empty, and zero-height, while the
 * product is active), so a clock-driven flip is announced politely.
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBan, faClock, faHourglassEnd } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useScenarioTime } from '@/core/clock'
import type { WeatherProductStateSubject } from '@/features/weather/contract'
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

function BannerView({
  product,
  published,
  scenarioNow,
  className,
}: ProductStateBannerProps & { readonly scenarioNow: Date | string }) {
  const banner = productBanner(product, scenarioNow, published)
  // The status region is ALWAYS mounted (empty while active), so a flip to
  // EXPIRED / CANCELLED / active is announced: a live region inserted already
  // holding its text is often not read.
  return (
    <div role="status" className={className} data-testid="weather-product-state-region">
      {banner !== null && (
        <div
          className={[styles.banner, styles[banner.state]].join(' ')}
          data-testid="weather-product-state-banner"
          data-product-state={banner.state}
        >
          <FontAwesomeIcon icon={BANNER_ICONS[banner.state]} className={styles.icon} aria-hidden="true" />
          <span>{banner.text}</span>
        </div>
      )}
    </div>
  )
}
