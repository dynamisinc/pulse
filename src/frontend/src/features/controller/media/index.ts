/**
 * features/controller/media — public barrel (demo-polish C1, story 17).
 *
 * The STAFF-world media attach pieces of the controller console. C3's run sheet
 * imports `MediaLibraryPicker` from here (or by path) - its props are the FROZEN
 * contract of implementation.md section 1.11. Everything else is the composer's own
 * machinery, exported so C3 can reuse the same limits and the id -> asset lookup.
 */

export { MediaLibraryPicker } from './MediaLibraryPicker'
export type { MediaLibraryPickerProps } from './MediaLibraryPicker'

export { useLibraryAssetLookup } from './useLibraryAssetLookup'

export {
  MAX_IMAGES,
  MAX_VIDEOS,
  ALT_MAX_LENGTH,
  ALREADY_ATTACHED_MESSAGE,
  MIXED_MEDIA_MESSAGE,
  TOO_MANY_IMAGES_MESSAGE,
  TOO_MANY_VIDEOS_MESSAGE,
  checkKinds,
  effectiveAlt,
  kindLimit,
  validateAttachBatch,
} from './attachmentRules'
export type { AttachBatchResult } from './attachmentRules'

export { useAttachmentTray } from './useAttachmentTray'
export type {
  LibraryPickerLimits,
  TrayItem,
  TrayItemStatus,
  UseAttachmentTrayResult,
} from './useAttachmentTray'

export { AttachmentTray } from './AttachmentTray'
export type { AttachmentTrayProps } from './AttachmentTray'
