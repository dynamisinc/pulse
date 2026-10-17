/**
 * viewports.mjs — the screen sizes the guide screenshots are captured at
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 *   Plain viewport objects for `capture.mjs`. Each carries its size plus a
 *   `mobile` flag; `capture.mjs` turns that flag into Playwright's `isMobile` /
 *   `hasTouch` emulation (a coarse pointer, so the touch-sized controls from the
 *   mobile-tablet stories render as they do on a real device).
 *
 * WHY A SEPARATE FILE
 *   `capture.mjs` runs its capture on import, so other tooling (e.g. controller
 *   tablet shots, mobile-tablet story 16) imports the sizes from here instead.
 *
 * SUFFIX
 *   `suffix` names a shot's size variant: `participant-feed` + PHONE_SMALL is
 *   written as `participant-feed-360.png`. The primary size of a shot has no suffix,
 *   so existing file names stay unchanged.
 */

/** Staff desktop. */
export const DESKTOP = { width: 1440, height: 900, mobile: false }

/** Taller desktop window for CROPPED console panels, so each panel shows more rows. */
export const DESKTOP_TALL = { width: 1440, height: 1150, mobile: false }

/**
 * Default participant phone (iPhone 12-15 class). The guide's primary participant size;
 * its suffix only applies if it is ever used as a variant.
 */
export const PHONE = { width: 390, height: 844, mobile: true, suffix: '390' }

/** Small Android phone: the narrowest width the participant surfaces support. */
export const PHONE_SMALL = { width: 360, height: 800, mobile: true, suffix: '360' }

/** Portrait tablet (iPad mini / 9.7" class). */
export const TABLET = { width: 768, height: 1024, mobile: true, suffix: 'tablet' }
