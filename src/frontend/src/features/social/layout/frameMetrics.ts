/**
 * features/social/layout/frameMetrics.ts
 * ---------------------------------------------------------------------------
 * The three-column frame's fixed measurements (demo-polish F1; D1-013 "frame
 * is left-anchored: 240px nav rail | 600px main | 344px sidebar").
 *
 * WHY THESE ARE TS CONSTANTS WHEN THE LAYOUT IS CSS. A CSS Module cannot import a
 * `.ts` value, so `SocialChannel.module.css` hand-mirrors every number below. The
 * constants exist so the layout test can read the real stylesheet text and assert
 * the two agree (`SocialChannel.layout.test.tsx`) -- change a number here and the
 * CSS in the same commit, or that test fails. They are also the single place a
 * future story (F7's Notifications badge, the mobile tab bar) can look up "how
 * wide is the rail" without re-deriving it.
 *
 * BREAKPOINT MODEL (mobile-first, `min-width` queries; the page must never scroll
 * horizontally anywhere from 390 to 1440 px):
 *
 *   < NAV_EXPANDED_MIN_WIDTH   icon rail (NAV_RAIL_COLLAPSED) + main
 *   >= NAV_EXPANDED_MIN_WIDTH  full nav rail (NAV_RAIL_WIDTH) + main        (= 840)
 *   >= FRAME_MIN_WIDTH         nav rail + main + sidebar (the full frame)   (= 1184)
 *
 * The right rail is the FIRST thing to go as the viewport narrows (it is
 * `display: none`, so it also leaves the accessibility tree rather than just
 * going off-screen), and only then does the nav rail collapse to icons.
 *
 * World: participant. Pure constants -- no UI, no COBRA.
 */

/** Nav rail width in the full frame (px). */
export const NAV_RAIL_WIDTH = 240

/** Main (feed / thread / profile) column width in the full frame (px). */
export const MAIN_COLUMN_WIDTH = 600

/** Right rail ("sidebar") width in the full frame (px). */
export const RIGHT_RAIL_WIDTH = 344

/** Nav rail width once it has collapsed to an icon rail (px). */
export const NAV_RAIL_COLLAPSED_WIDTH = 68

/** Viewport width at which the right rail appears: 240 + 600 + 344 (px). */
export const FRAME_MIN_WIDTH = NAV_RAIL_WIDTH + MAIN_COLUMN_WIDTH + RIGHT_RAIL_WIDTH

/** Viewport width at which the nav rail shows labels: 240 + 600 (px). */
export const NAV_EXPANDED_MIN_WIDTH = NAV_RAIL_WIDTH + MAIN_COLUMN_WIDTH
