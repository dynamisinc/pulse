/**
 * features/participantAdmin/components/people/rosterStyles.ts
 * ---------------------------------------------------------------------------
 * Shared style constants for the staff roster screen (feature: easy-login,
 * story 10). COBRA world — theme tokens and `CobraStyles` where they exist.
 *
 * ## MUTED_TEXT is the COBRA muted-text token
 * Secondary lines on this screen carry real information (issued times, "no
 * persona"), so they must clear the WCAG 2.1 AA 4.5:1 floor (NFR-001). They use
 * COBRA's `palette.text.muted` (demo-feedback 25, DF-37; was a local #595957
 * while the theme's grey was below AA). Status colours are theme tokens that clear
 * 4.5:1 on white (`success.main`, `notifications.errorText`,
 * `notifications.warningText`, `info.main`) — and colour is never the only cue:
 * every status is icon + text.
 */

import { cobraTheme } from '@/theme/cobraTheme'

/** Secondary text: the COBRA muted-text token (AA on white and on the table's grounds). */
export const MUTED_TEXT = cobraTheme.palette.text.muted

/** Dense table cell (desktop-first, dense on purpose). */
export const CELL_SX = {
  padding: '6px 10px',
  fontSize: 13,
  lineHeight: 1.35,
  borderBottom: '1px solid',
  borderBottomColor: 'grid.main',
  textAlign: 'left',
  verticalAlign: 'top',
} as const

/** A focus ring that is visible on the COBRA light surface (keyboard-first). */
export const FOCUS_RING = {
  outline: '2px solid',
  outlineColor: 'info.main',
  outlineOffset: 2,
} as const
