/**
 * core/media — public barrel (demo-polish F0).
 *
 * The WORLD-NEUTRAL upload client + media library read: validation, poster
 * capture, the live/mock upload adapters, and the two hooks composers bind to.
 * No UI, no theme, no exercise id; imported by the participant world (F4) and
 * the staff world (C1/C3) alike. See `uploadMedia.ts` for the contract.
 */

export type { MediaKind, MediaAssetView, StaffMediaAssetView } from './types'

export {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_FORMAT_HINT,
  MEDIA_ERROR_TEXT,
  MediaUploadError,
  mediaUploadErrorMessage,
  isAbortError,
} from './mediaErrors'

export {
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
  ACCEPT_ANY_MEDIA,
  ACCEPT_IMAGES_ONLY,
  validateMediaFile,
} from './validateMediaFile'
export type { MediaValidationResult } from './validateMediaFile'

export { readImageSize } from './readImageSize'
export type { ImageSize, ReadImageSizeOptions } from './readImageSize'

export { captureVideoPoster, POSTER_CAPTURE_TIMEOUT_MS } from './captureVideoPoster'
export type { CapturedVideoPoster, CaptureVideoPosterOptions } from './captureVideoPoster'

export { uploadMedia, uploadVideoWithPoster, uploadPickedMedia } from './uploadMedia'
export type { UploadMediaOptions, UploadFlowHandlers } from './uploadMedia'

export { useMediaUpload } from './useMediaUpload'
export type { MediaUploadState, UseMediaUploadResult } from './useMediaUpload'

export { useMediaLibrary, resolveMediaLibrary } from './useMediaLibrary'
export { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'

// MOCK-MODE ONLY: the registry the mock `createPost` resolves `mediaId`s through.
export {
  getMockMediaAsset,
  listMockMedia,
  registerMockMedia,
  resetMockMediaRegistry,
} from './mockMediaRegistry'
