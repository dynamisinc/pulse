/**
 * features/controller/personaEdit/personaEditStyles.ts
 * ---------------------------------------------------------------------------
 * Shared style constants of the persona edit dialog (demo-polish story 21 /
 * PE-FE; NFR-001 WCAG 2.1 AA). Staff world.
 *
 * ## Why not the theme's `text.secondary`
 * COBRA's `text.secondary` is #848482 — about 3.75:1 on white, which fails AA for
 * normal text (the same finding `PersonaContextPanel` documents next to its
 * `MUTED_NOTE_COLOR`). MUI paints field LABELS and HELPER TEXT with it, so the
 * dialog's fields override both with {@link MUTED_TEXT} (about 6.6:1 on white,
 * 6:1 on the preview's light-grey ground) rather than ship sub-AA labels.
 * Retuning the shared theme token is a separate staff-shell decision.
 */

/** Secondary text that meets AA (>= 4.5:1) on white and on `grey.100`. */
export const MUTED_TEXT = '#5c5c5a'

/** `sx` for a `CobraTextField` in this dialog: AA label and helper-text colour. */
export const STAFF_FIELD_SX = {
  '& .MuiInputLabel-root': { color: MUTED_TEXT },
  '& .MuiFormHelperText-root': { color: MUTED_TEXT },
  '& .MuiFormHelperText-root.Mui-error': { color: 'notifications.errorText' },
} as const
