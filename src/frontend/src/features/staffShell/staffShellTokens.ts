/**
 * features/staffShell/staffShellTokens.ts
 * ---------------------------------------------------------------------------
 * Staff-shell chrome tokens (feature: staff-shell, story 05 — "Cadence chrome
 * tokens + thumbnail-distinguishability gate"; D7-009, COR-063; see
 * docs/features/staff-shell/05-cadence-chrome-tokens.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell owns" /
 * §4 hard gates).
 *
 * This module is the small, wave-1 token foundation the rest of `staff-shell`
 * (stories 01 header, 02 toolstrip, 03 admin flyout, 04 preview-as) and
 * `console-shell` build their chrome against, so every staff surface reads as
 * ONE consistent Cadence system rather than each component re-deriving its
 * own navy/gray.
 *
 * ## Why the navy header lives HERE and not in `cobraTheme`
 * `@/theme/cobraTheme` is the generic COBRA C5 palette shared across Dynamis
 * operator tooling (Cadence, and now Pulse's staff world) — it has no opinion
 * about a 56px navy application header, because not every COBRA-themed
 * surface has one. The navy header, its darker bottom border, its
 * light-on-navy text colors, and the mono classification-tag styling are
 * Pulse-**staff-shell**-specific chrome (D7-010: "no separate exercise bar" —
 * this is the header the FOUO tag folds into). They are defined here, next to
 * the frame that renders them, instead of polluting the shared theme file
 * with a fixture only one consumer needs.
 *
 * ## Why everything else is SOURCED from cobraTheme, not re-hardcoded
 * The work-area background (`#f8f8f8`), white panels (`#fff`), Cadence red
 * (`#e42217`), and muted secondary text (the AA `text.muted` token, demo-feedback
 * 25) all already exist as COBRA theme palette entries (`background.default` /
 * `background.paper` / `error.main` / `text.muted`) — see `@/theme/cobraTheme`. This module
 * REFERENCES those, so if the COBRA palette is ever retuned, this frame
 * follows it automatically instead of drifting out of sync with a second,
 * hardcoded copy of the same colors.
 *
 * ## The hard gate this module exists to serve (SHELL-CONTRACT §4)
 * A staff surface must be thumbnail-distinguishable from a participant
 * surface: dark navy chrome + a single top bar, never the light world framed
 * by two green compliance banners. These tokens are staff-only — participant
 * surfaces (`features/{social,portal,news,press,weather,participant-shell}`)
 * must never import this module or any COBRA token. That absence is enforced
 * mechanically by `twoWorldsSeparation.test.ts` in this folder.
 */

import { cobraTheme } from '@/theme/cobraTheme'

/** Staff shell header row height (SHELL-CONTRACT §1, "Header (56px)"). */
export const STAFF_HEADER_HEIGHT_PX = 56

/** Staff shell right-edge toolstrip dock width (SHELL-CONTRACT §1, "Toolstrip"). */
export const STAFF_TOOLSTRIP_WIDTH_PX = 56

// --- Tablet variants (feature: mobile-tablet, story 13; D5-021, TABLET-AMENDMENT §1/§3/§4) ---
//
// BANDS ARE BY WIDTH ONLY; TOUCH SIZING IS A SEPARATE TEST. An iPad with a trackpad still gets the
// tablet layout, and a narrow desktop window gets the tablet layout WITHOUT touch sizing
// (`(pointer: coarse)` gates only the 44px targets below). Desktop at 1280 and up is unchanged.

/** Width at and above which the desktop shell renders, unchanged (TABLET-AMENDMENT §1). */
export const STAFF_DESKTOP_MIN_WIDTH_PX = 1280
/** Below this width: tablet PORTRAIT band (768-1023); at or above it, landscape (1024-1279). */
export const STAFF_TABLET_LANDSCAPE_MIN_WIDTH_PX = 1024

/** Tablet header height. Same as desktop today; its own token so the two can be tuned apart. */
export const STAFF_HEADER_HEIGHT_TABLET_PX = 56
/**
 * Tablet toolstrip width. Held at 56 because the amendment's work-area budget (712 / 764 / 968 /
 * 1124) assumes it: the 44px touch button plus 6px either side fits without growing the column.
 */
export const STAFF_TOOLSTRIP_WIDTH_TABLET_PX = 56

/** Minimum touch target under a coarse pointer (TABLET-AMENDMENT §4; WCAG 2.5.5 spirit). */
export const STAFF_TOUCH_TARGET_PX = 44
/** Minimum gap between adjacent touch actions (TABLET-AMENDMENT §4). */
export const STAFF_TOUCH_GAP_PX = 8

/** `matchMedia` queries (JS) for the two header bands — width only, never pointer. */
export const STAFF_TABLET_QUERY = `(max-width: ${STAFF_DESKTOP_MIN_WIDTH_PX - 0.05}px)`
export const STAFF_TABLET_PORTRAIT_QUERY = `(max-width: ${STAFF_TABLET_LANDSCAPE_MIN_WIDTH_PX - 0.05}px)`

/** CSS media-query keys for `sx` — the SAME bands, plus the independent touch gate. */
export const STAFF_TABLET_MEDIA = `@media ${STAFF_TABLET_QUERY}`
export const STAFF_TABLET_PORTRAIT_MEDIA = `@media ${STAFF_TABLET_PORTRAIT_QUERY}`
export const STAFF_COARSE_POINTER_MEDIA = '@media (pointer: coarse)'

// --- Navy header chrome — Pulse-staff-shell-specific (NOT in cobraTheme; see
// module header "Why the navy header lives HERE"). ---
const NAVY_HEADER_BACKGROUND = '#1e3a5f'
const NAVY_HEADER_BORDER = '#16293f'
const NAVY_HEADER_TEXT_PRIMARY = '#eef3f9'
// Light-on-navy muted ink: 4.72:1 on the header, 6.06:1 on its border (AA; pinned by
// `theme/cobraTheme.contrast.test.ts`). NOT `cobraTheme.palette.text.muted`: that is a dark
// grey for light surfaces and would fail on navy.
const NAVY_HEADER_TEXT_MUTED = '#93a8c2'

/**
 * The Cadence chrome tokens the staff shell frame (and stories 01–04) render
 * against. Grouped by region so a consumer only imports the slice it needs.
 */
export const staffShellTokens = {
  header: {
    heightPx: STAFF_HEADER_HEIGHT_PX,
    /** Cadence navy — staff-shell-specific, never used on a participant surface. */
    background: NAVY_HEADER_BACKGROUND,
    /** Darker navy bottom border, separating the header from the work area. */
    borderColor: NAVY_HEADER_BORDER,
    /** Light text/icon color for content sitting directly on the navy header. */
    textPrimary: NAVY_HEADER_TEXT_PRIMARY,
    /** Muted variant for secondary header text (e.g. role/cell under the lockup). */
    textMuted: NAVY_HEADER_TEXT_MUTED,
  },
  /**
   * Classification tag styling (`UNCLASSIFIED // FOUO`, mono, persistent on
   * every staff screen — SHELL-CONTRACT §1 "Header" + "Classification
   * strings"). D7-010 folds it into the header rather than a separate
   * exercise bar. Story 01 renders the label; this module only owns the
   * visual treatment.
   */
  classificationTag: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: NAVY_HEADER_TEXT_MUTED,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    letterSpacing: '0.1em',
  },
  /**
   * Flyout stacking contract (story 13). Flyouts live INSIDE the work-area row (a separate grid
   * row from the header, so they can never cover the header) and the toolstrip is its own grid
   * column (so they never cover it). `zIndex` orders flyouts above work-area content. MUI
   * popovers/menus/dialogs (1300+) always sit above flyouts, so a confirm raised from a flyout is
   * never buried. `topVar` is an OPT-IN seam, only for a surface whose sticky band sits inside the
   * flyouts' containing block: it sets `--staff-flyout-top: <band height>` on an ancestor and
   * every flyout starts below it. Unset it is 0. The controller console does NOT use it (its
   * flyouts already live in its pane area, below its band), so it must stay unset there.
   */
  flyout: {
    zIndex: 30,
    topVar: '--staff-flyout-top',
  },
  toolstrip: {
    widthPx: STAFF_TOOLSTRIP_WIDTH_PX,
    /** COBRA-sourced white panel — see cobraTheme.palette.background.paper. */
    background: cobraTheme.palette.background.paper,
    /** COBRA-sourced divider color, not a re-hardcoded gray. */
    borderColor: cobraTheme.palette.divider,
  },
  workArea: {
    /** COBRA-sourced light work-area background — see cobraTheme.palette.background.default. */
    background: cobraTheme.palette.background.default,
  },
  /**
   * Cadence accents used by later stories' badges/pills/lockout states — all
   * COBRA-sourced (never a second hardcoded copy of these colors).
   */
  accent: {
    /** Cadence red — cobraTheme.palette.error.main. */
    cadenceRed: cobraTheme.palette.error.main,
    /** Secondary gray text — the COBRA muted-text token, cobraTheme.palette.text.muted (AA). */
    secondaryText: cobraTheme.palette.text.muted,
  },
} as const
