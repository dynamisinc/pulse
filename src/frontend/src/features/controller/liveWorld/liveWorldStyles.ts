/**
 * features/controller/liveWorld/liveWorldStyles.ts
 * ---------------------------------------------------------------------------
 * The visual tokens for the console's LIVE WORLD column (demo-polish C2). STAFF
 * world only — every value here is sourced from the COBRA theme or the staff
 * shell's tokens (`staffShellTokens`), so the column reads as part of the same
 * Cadence-style operator tooling as the header and toolstrip and can NEVER be
 * mistaken for the participant fiction it is showing (the column's whole
 * design constraint, story 18 "Unmistakably staff").
 *
 * What makes it unmistakably staff, in tokens:
 *   - a NAVY title bar (the staff header's navy) carrying the "LIVE WORLD" title
 *     and the transport status;
 *   - MONOSPACED metadata (the staff classification-tag font stack);
 *   - a visible 1px panel border and hairline-separated, tight rows on the COBRA
 *     paper surface — no cards, no avatars-as-photos, no participant accent.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA). `meta` is deliberately darker than the
 * theme's `text.secondary` (#848482, 3.6:1 on white): it must clear 4.5:1 on both
 * the row surface and the hover surface — `liveWorldStyles.test.ts` computes the
 * ratios from these very values rather than asserting a hand-typed number.
 * Status is never colour alone; every state in the column also carries text.
 */

import { cobraTheme } from '@/theme/cobraTheme'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'

export const liveWorldTokens = {
  /** Monospaced stack for all metadata (handles, times, counts, status). */
  mono: staffShellTokens.classificationTag.fontFamily,
  /** Title-bar surface: the staff header navy. */
  barBackground: staffShellTokens.header.background,
  barBorder: staffShellTokens.header.borderColor,
  barText: staffShellTokens.header.textPrimary,
  barTextMuted: staffShellTokens.header.textMuted,
  /** The panel's outer border. */
  panelBorder: staffShellTokens.toolstrip.borderColor,
  /** Row separator (decorative; the rows are also separated by spacing). */
  hairline: '#d5dae1',
  /** Panel and row surface (COBRA paper). */
  surface: cobraTheme.palette.background.paper,
  /** Row hover surface. */
  surfaceHover: '#f1f5fa',
  /** Toolbar surface (a step off the row surface). */
  toolbar: '#f6f7f9',
  /** Primary text. */
  ink: cobraTheme.palette.text.primary,
  /** Metadata text: AA on `surface`, `surfaceHover` and `toolbar` (see the header). */
  meta: '#4d5560',
  /** Keyboard-focus ring and links: the staff navy, 2px. */
  focus: staffShellTokens.header.background,
  /**
   * Error ICON and border: Cadence red. It is 4.6:1 on white but only 4.3:1 on the
   * toolbar surface, so it is never used for text — error words stay `ink`.
   */
  danger: staffShellTokens.accent.cadenceRed,
} as const

/**
 * Visually hidden but available to assistive technology.
 *
 * The dimensions are PIXEL STRINGS on purpose: under MUI `sx` a bare number is
 * transformed — `width: 1` / `height: 1` mean 100% and `margin: -1` means one
 * spacing unit (-8px) — which would turn every one of these into a full-size
 * absolutely-positioned box (the Live world renders ~4 per row). The computed
 * style is pinned by `liveWorldStyles.test.ts` and `LiveWorldColumn.test.tsx`.
 */
export const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

/** Shared mono-metadata text style. */
export const monoMeta = {
  fontFamily: liveWorldTokens.mono,
  fontSize: 11,
  lineHeight: 1.4,
  color: liveWorldTokens.meta,
} as const
