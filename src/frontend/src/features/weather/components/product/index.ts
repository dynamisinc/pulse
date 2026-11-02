/**
 * features/weather/components/product — the presentational product pieces
 * (weather-source story 07, #758). Data in, no fetching; styled from the
 * Weather Desk skin's CSS variables (with neutral fallbacks, so they render
 * before story 06 mounts the channel). Used by the site (08), the permalink
 * page (09), the widget (10) and the staff preview.
 */

export { SeverityChip } from './SeverityChip'
export type { SeverityChipProps } from './SeverityChip'
export { IbwGrid } from './IbwGrid'
export { IBW_ROWS } from './ibwRows'
export type { IbwGridProps } from './IbwGrid'
export {
  BODY_TERMINATOR,
  PRECAUTIONARY_HEADER,
  PRODUCT_TERMINATOR,
  ProductText,
} from './ProductText'
export type { ProductTextProps, ProductTextSubject } from './ProductText'
export { ProductTimes } from './ProductTimes'
export type { ProductTimesProps } from './ProductTimes'
export { ProductStateBanner } from './ProductStateBanner'
export type { ProductStateBannerProps } from './ProductStateBanner'
export { formatCountdown, productBanner } from './productBanner'
export type { ProductBannerModel } from './productBanner'
export { ProductImagery } from './ProductImagery'
export type { ProductImageryProps } from './ProductImagery'
export {
  WEATHER_SEVERITY,
  WEATHER_SEVERITY_ON_COLOR,
  WEATHER_SKIN_EXT_NAMESPACE,
  severityFillStyle,
  severityHue,
} from './severity'
export type { WeatherSeverityPresentation } from './severity'
