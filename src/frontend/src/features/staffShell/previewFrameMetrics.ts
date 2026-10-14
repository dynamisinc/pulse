/**
 * features/staffShell/previewFrameMetrics.ts
 * ---------------------------------------------------------------------------
 * How wide the "Preview as participant" mat makes the participant frame (feature:
 * staff-shell, story 04, reworked by demo-polish C6).
 *
 * The Social channel lays itself out with VIEWPORT media queries -- its right rail
 * appears at a viewport >= 1184px and its nav rail shows labels at >= 840px
 * (`features/social/layout/frameMetrics`) -- but inside the preview the channel is
 * not the whole viewport, it is a frame inside the staff work area. So the mat gives
 * the frame the width the matching breakpoint assumes (and scrolls when the work area
 * is narrower) rather than letting the channel clip its own columns.
 *
 * These two numbers are COPIES of the channel's `FRAME_MIN_WIDTH` and
 * `NAV_EXPANDED_MIN_WIDTH`, kept here on purpose: the staff half of the preview
 * (`PreviewAsParticipant`, the label strip and the mat) imports nothing from the
 * participant world, so the two-worlds gate can say "no participant tokens in the
 * staff strip" without an exception. `previewFrameMetrics.test.ts` imports the
 * channel's constants and fails if either copy drifts.
 *
 * World: staff. Pure constants -- no UI, no COBRA, no participant skin.
 */

/** Frame width (px) of the full three-column channel: nav rail + main + sidebar. */
export const PREVIEW_FRAME_FULL_WIDTH_PX = 1184

/** Frame width (px) of the two-column channel: nav rail + main (no sidebar). */
export const PREVIEW_FRAME_NAV_WIDTH_PX = 840
