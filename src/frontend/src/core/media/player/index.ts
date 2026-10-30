/**
 * core/media/player — the shared participant media player (channels-foundation 14).
 *
 * Extracted from `features/social/components/media` so a channel can play inline video
 * with the EXERCISE bands without importing Social chrome (news FU-9). Social keeps
 * re-export shims at the old paths, so its own imports are unchanged. Participant world
 * only: CSS Modules + FontAwesome, no COBRA, no MUI. Kept out of the `core/media`
 * barrel, which is the world-neutral, UI-free upload client.
 */

export { VideoPlayer } from './VideoPlayer'
export type { VideoPlayerProps } from './VideoPlayer'
export { ExerciseBands } from './ExerciseBands'
export type { ExerciseBandsProps } from './ExerciseBands'
export { MediaFallbackTile } from './MediaFallbackTile'
export { ParticipantTooltip } from './ParticipantTooltip'
export { mediaAlt, singleMediaAspectRatio } from './mediaLayout'
export { resolveSafeMediaUrl } from './safeMediaUrl'
export { EXERCISE_BAND_TEXT } from './mediaCopy'
export type { PlayerMedia } from './playerTypes'
