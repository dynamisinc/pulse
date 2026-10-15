/**
 * features/social/components/media/mediaCopy.ts
 * ---------------------------------------------------------------------------
 * User-facing strings for the media components (demo-polish F2), kept out of the
 * `.tsx` files so they can be imported by tests without tripping the
 * components-only export rule.
 */

/**
 * Shown (with the alt text) when a `<video>` errors. The server cannot tell a
 * non-H.264 MP4 from a playable one, so the browser is the only judge.
 */
export const UNPLAYABLE_VIDEO_MESSAGE = "This video can't be played in this browser"

/**
 * The media marking (demo-feedback 06, DF-4): drawn in a band across the top AND the
 * bottom of every participant image and video while the exercise requires it. Fixed
 * copy, uppercase, three times so a crop or a partial screenshot still carries it.
 */
export const EXERCISE_BAND_TEXT = 'EXERCISE EXERCISE EXERCISE'
