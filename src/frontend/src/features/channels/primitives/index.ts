/**
 * features/channels/primitives — FC-8 `primitives/` (channels-foundation 14).
 *
 * The presentational pieces every channel page shares and the D3/D4 briefs require to be
 * identical: the scenario-time dateline (+ its format registry), the EXERCISE watermark
 * slot, the sanitized body renderer, content media and the arrivals live region. No data
 * fetching, no skin ownership: skins style them through CSS variables.
 */

export { ScenarioDateline } from './dateline/ScenarioDateline'
export type { ScenarioDatelineProps } from './dateline/ScenarioDateline'
export {
  DEFAULT_DATELINE_FORMAT,
  hasDatelineFormat,
  registerDatelineFormat,
  resolveDatelineFormat,
} from './dateline/datelineFormats'
export type { DatelineFormat, ScenarioTimeFormatter } from './dateline/datelineFormats'
export { shouldShowUpdatedStamp } from './dateline/updatedStamp'

export { WatermarkSlot, WATERMARK_TEXT } from './watermark/WatermarkSlot'
export type { WatermarkSlotProps } from './watermark/WatermarkSlot'

export { ContentMedia } from './media/ContentMedia'
export type { ContentMediaProps } from './media/ContentMedia'

export { SanitizedBody } from './body/SanitizedBody'
export type { SanitizedBodyProps } from './body/SanitizedBody'
export {
  BODY_ALLOWED_ATTRIBUTES,
  BODY_ALLOWED_TAGS,
  PULSE_POST_TAG,
  sanitizeBodyHtml,
} from './body/sanitizeBody'

export { LiveRegionAnnouncer } from './announcer/LiveRegionAnnouncer'
export type { LiveRegionAnnouncerProps } from './announcer/LiveRegionAnnouncer'
export { ANNOUNCE_WINDOW_MS } from './announcer/arrivalCoalescer'
