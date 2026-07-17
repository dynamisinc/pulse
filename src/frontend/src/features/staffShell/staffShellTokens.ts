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
 * (`#e42217`), and secondary gray (`#848482`) all already exist as COBRA
 * theme palette entries (`background.default` / `background.paper` /
 * `error.main` / `text.secondary`) — see `@/theme/cobraTheme`. This module
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

// --- Navy header chrome — Pulse-staff-shell-specific (NOT in cobraTheme; see
// module header "Why the navy header lives HERE"). ---
const NAVY_HEADER_BACKGROUND = '#1e3a5f'
const NAVY_HEADER_BORDER = '#16293f'
const NAVY_HEADER_TEXT_PRIMARY = '#eef3f9'
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
    /** Secondary gray text — cobraTheme.palette.text.secondary. */
    secondaryText: cobraTheme.palette.text.secondary,
  },
} as const
