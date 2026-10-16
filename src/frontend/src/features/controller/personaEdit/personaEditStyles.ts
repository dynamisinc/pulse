/**
 * features/controller/personaEdit/personaEditStyles.ts
 * ---------------------------------------------------------------------------
 * Shared style constants of the persona edit dialog (demo-polish story 21 /
 * PE-FE; NFR-001 WCAG 2.1 AA). Staff world.
 *
 * ## Muted text is the COBRA token
 * The dialog's secondary text (field LABELS, HELPER TEXT, the save hint) is COBRA's
 * `palette.text.muted` (demo-feedback 25, DF-37): AA on white and on the preview's
 * light-grey ground. It used to be a local #5c5c5a because the theme's old
 * `text.secondary` (#848482) was below AA; the theme now carries the AA value itself.
 */

import { cobraTheme } from '@/theme/cobraTheme'

/** Secondary text: the COBRA muted-text token (>= 4.5:1 on white and on `grey.100`). */
export const MUTED_TEXT = cobraTheme.palette.text.muted

/** `sx` for a `CobraTextField` in this dialog: AA label and helper-text colour. */
export const STAFF_FIELD_SX = {
  '& .MuiInputLabel-root': { color: MUTED_TEXT },
  '& .MuiFormHelperText-root': { color: MUTED_TEXT },
  '& .MuiFormHelperText-root.Mui-error': { color: 'notifications.errorText' },
} as const
