/**
 * features/participantAdmin/components/people/rosterStyles.ts
 * ---------------------------------------------------------------------------
 * Shared style constants for the staff roster screen (feature: easy-login,
 * story 10). COBRA world — theme tokens and `CobraStyles` where they exist.
 *
 * ## Why MUTED_TEXT is not `text.secondary`
 * The COBRA `text.secondary` (#848482) is 3.7:1 on white, under the WCAG 2.1 AA
 * 4.5:1 floor for normal text (NFR-001). Secondary lines on this screen carry
 * real information (issued times, "no persona"), so they use a darker grey
 * (#595957, 7:1). Status colours are theme tokens that clear 4.5:1 on white
 * (`success.main`, `notifications.errorText`, `notifications.warningText`,
 * `info.main`) — and colour is never the only cue: every status is icon + text.
 */

/** Secondary text that still clears AA on white. */
// TODO(#461): COBRA's `text.secondary` fails AA; fix it in the theme and drop this override.
export const MUTED_TEXT = '#595957'

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
