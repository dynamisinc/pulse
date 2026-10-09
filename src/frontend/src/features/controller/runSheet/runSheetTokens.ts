/**
 * features/controller/runSheet/runSheetTokens.ts
 * ---------------------------------------------------------------------------
 * Every colour the run sheet draws with, named once (demo-polish C3, Gate-1 M-5 / L-12;
 * NFR-001 WCAG 2.1 AA). STAFF world. Components import `runSheetTokens` instead of
 * scattering hex values, and `runSheetTokens.test.ts` PINS the contrast of each text /
 * background pair the panel actually draws, so a palette tweak that drops below 4.5:1
 * fails a test instead of shipping.
 *
 * WHY `mutedText` IS NOT `text.secondary`. COBRA's `text.secondary` (`#848482`, also
 * `staffShellTokens.accent.secondaryText`) is only 3.75:1 on white and 3.36:1 on the
 * selected row - below AA for the 11-13px informational text a dense list is made of.
 * `#4a4f55` is 8.27:1 on white, 7.41:1 on the selected row and 7.78:1 on the work area.
 * The shared COBRA token is a separate follow-up; until it lands the run sheet uses this.
 *
 * Where COBRA already has the colour (the notification banners, body text, the navy, the
 * hairline) it is read from the theme / shell tokens, never re-typed. The three status
 * text colours have no COBRA equivalent that reaches AA on both the white panel and the
 * selected row, so they are defined here with their ratios.
 */

import { cobraTheme } from '@/theme/cobraTheme'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'

export const runSheetTokens = {
  /** Body text. */
  bodyText: cobraTheme.palette.text.primary,
  /** 11-13px informational text: 8.27:1 on white, 7.41:1 on `selectedRow`, 7.78:1 on `workArea`. */
  mutedText: '#4a4f55',
  /** Navy used for headings, the time stamp and the selection edge (11.5:1 on white). */
  navy: staffShellTokens.header.background,
  /** The white panel surface. */
  panel: staffShellTokens.toolstrip.background,
  /** The light work-area grey (the `kbd` keycap surface). */
  workArea: staffShellTokens.workArea.background,
  /** Hairlines and the unselected row edge. */
  hairline: staffShellTokens.toolstrip.borderColor,
  /** The selected row's surface. */
  selectedRow: '#eef3f9',
  /** "Failed" text: 7.54:1 on white, 6.76:1 on `selectedRow`. (Cadence red is only 4.2:1.) */
  failedText: '#a8160d',
  /** "Unconfirmed" text: 5.93:1 on white, 5.31:1 on `selectedRow`. */
  unconfirmedText: '#8a5a00',
  /** "Fired" text: 6.28:1 on white, 5.63:1 on `selectedRow`. */
  firedText: '#1b6e3c',
  /** Warning banner (storage warning): COBRA's notification colours + body text. */
  warningBanner: {
    background: cobraTheme.palette.notifications.warning,
    text: cobraTheme.palette.text.primary,
  },
  /** Error banner (failed / unconfirmed / refused import). */
  errorBanner: {
    background: cobraTheme.palette.notifications.error,
    text: cobraTheme.palette.text.primary,
  },
  /** Keycap / timestamp font. */
  mono: staffShellTokens.classificationTag.fontFamily,
} as const

/** A keycap hint ("F", "N") beside a label, on the work-area grey. */
export const KBD_SX = {
  fontFamily: runSheetTokens.mono,
  fontSize: 11,
  fontWeight: 700,
  color: runSheetTokens.navy,
  border: `1px solid ${runSheetTokens.hairline}`,
  borderRadius: '4px',
  bgcolor: runSheetTokens.workArea,
  px: 0.75,
  py: 0.125,
} as const

/**
 * A keycap hint INSIDE a coloured button (Fire next). It must take the button's own
 * colours: the grey keycap surface under the button's white text was 1.06:1 (Gate-1 H-1).
 */
export const BUTTON_KBD_SX = {
  ...KBD_SX,
  ml: 0.75,
  color: 'inherit',
  bgcolor: 'transparent',
  borderColor: 'currentColor',
} as const

/**
 * Helper, error and floating-label text of COBRA text fields, applied on a CONTAINER (the
 * selectors are descendant ones). MUI's defaults (`text.secondary` and the lava-red
 * `error.main`) are both below 4.5:1 at 12px, so the run sheet sets its own.
 */
export const FIELD_SX = {
  '& .MuiFormHelperText-root': { color: runSheetTokens.mutedText },
  '& .MuiFormHelperText-root.Mui-error': { color: runSheetTokens.failedText },
  // The floating label is 12px when shrunk. (COBRA's own focus colour still wins on focus.)
  '& .MuiInputLabel-root': { color: runSheetTokens.mutedText },
  '& .MuiInputLabel-root.Mui-error': { color: runSheetTokens.failedText },
} as const
