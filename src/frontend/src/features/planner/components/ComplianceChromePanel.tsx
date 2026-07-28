/**
 * features/planner/components/ComplianceChromePanel.tsx
 * ---------------------------------------------------------------------------
 * The staff-console COMPLIANCE-CHROME editor (feature: exercise-configuration,
 * story 02 — "Compliance chrome: per-exercise config + NFR-008 guard";
 * COR-031 / XC-003 / NFR-008; issue #41 / story #68). A planner turns the
 * classification banners on or off for this exercise and sets their copy and
 * colors, plus the in-content EXERCISE watermark switch the NFR-008 mutual
 * guard is evaluated against.
 *
 * TWO WORLDS — this is the STAFF world (D0 §2 / CLAUDE.md). COBRA look via
 * `@/theme/styledComponents` (`CobraPrimaryButton` / `CobraSecondaryButton` /
 * `CobraTextField`) + `CobraStyles` spacing, rendered inside the app's COBRA
 * `ThemeProvider`. It must NEVER read as a participant skin and never mounts a
 * brand theme — even though the values it edits are what participants see
 * framing every channel. Icons are FontAwesome only; MUI system props go through
 * `sx` (MUI 9). There is no `CobraCheckbox`, so the switches use a raw MUI
 * `Checkbox`, exactly as the shipped `ExerciseSettingsPanel` does.
 *
 * SELF-CONTAINED BY CONTRACT. It owns its query, its mutation, its loading and
 * error states and takes NO props, so `ExerciseSettingsPage` mounts it with a
 * single JSX line and threads nothing through.
 *
 * ============================================================================
 * THE THREE RULES THIS COMPONENT EXISTS TO GET RIGHT
 * ============================================================================
 *
 * 1. NFR-008 — CHROME AND THE WATERMARK ARE NEVER BOTH OFF. The SERVER is the
 *    enforcement point (`ComplianceChromeGuard`, a 400 whatever the client
 *    sends). This panel mirrors the rule only so the planner gets an
 *    explanatory, field-associated message instead of a round trip — and it
 *    surfaces the server's own 400 verbatim if one arrives anyway.
 *
 * 2. `PUT` IS A FULL REPLACE, NOT A PATCH. An omitted or `null` banner field
 *    CLEARS it. One `ChromeFormValues` object holds a value for every settable
 *    field, and `toUpdate()` returns `ChromeSettingsUpdate`, whose every
 *    property is REQUIRED — forgetting a field is a COMPILE ERROR, not silent
 *    data loss.
 *
 * 3. A `null` BANNER FIELD MEANS "NOT CONFIGURED" AND RENDERS EMPTY. The
 *    participant world falls back to the shipped Phase-1 banner for it.
 *    Pre-filling that constant and saving would silently turn a fallback into
 *    stored configuration, so `null` maps to `''` — never to the fallback — and
 *    an empty box maps back to `null`.
 *
 * ============================================================================
 * LAYOUT: THE TWO BANNERS ARE A PAIR, SO THEY SIT AS ONE
 * ============================================================================
 * Stacked one above the other, this section was ~50px taller than the staff
 * work area at 1440x900 and had to scroll. The top and bottom banners carry
 * IDENTICAL field sets, so they now sit side by side in a `FieldGrid`: it halves
 * the height and puts the two values a planner is choosing between on screen
 * together. Below the width that holds both, the grid collapses them back into
 * one column.
 *
 * The duplicate `h3` above the markings fieldset is gone with it — it said
 * "Exercise markings" immediately above a `legend` saying "Exercise markings",
 * which cost 50px to say the same thing twice, on screen and to a screen
 * reader. The legend is the group's real accessible name (the shipped
 * "Enabled channels" group has never had a heading either).
 *
 * The save/revert footer is a `PanelSaveBar`, pinned to the bottom of the page's
 * scrolling content pane so this panel's own save stays as reachable as the
 * shared settings one.
 *
 * BANNER PRESENTATION IS FROZEN (R-006 / D7). This panel edits the CONFIG; the
 * banners themselves are `features/participant-shell/ComplianceChrome.tsx`
 * (shipped, a different Complete feature). Nothing here renders or restyles
 * them, and the color fields are plain text inputs — no preview swatch that
 * would imply a presentation this story does not own.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - Every input is a real labeled control. Field errors are programmatically
 *    associated with their field — MUI wires `aria-describedby` to the helper
 *    text from the field's `id`, and `error` sets `aria-invalid` — so an error
 *    is never conveyed by color alone.
 *  - The two markings switches are a `fieldset`/`legend` whose NFR-008 message
 *    is bound with `aria-describedby`.
 *  - The load state and the save outcome reach assistive tech: `role="status"`
 *    for loading/success, `role="alert"` for every failure, each pairing a
 *    FontAwesome icon with text.
 *
 * CONTENT SECURITY (NFR-004): banner text is sanitized SERVER-side through the
 * shipped `PostSanitizer` on write — this panel hand-rolls no sanitizer.
 * Everything it displays is a React text node or an `<input value>`; there is no
 * `dangerouslySetInnerHTML`, so stored markup can never execute in the console.
 *
 * SCENARIO TIME (COR-053): not applicable — this is the staff world and the
 * panel renders no timestamps.
 */

import { useState, type FormEvent } from 'react'
import {
  Box,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faFloppyDisk,
  faRotateLeft,
  faShieldHalved,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { FieldGrid } from './FieldGrid'
import { PanelSaveBar } from './PanelSaveBar'
import { useChromeSettings, useSaveChromeSettings } from '../hooks/useChromeSettings'
import {
  CHROME_HEX_COLOR_PATTERN,
  MAX_BANNER_TEXT_LENGTH,
  MAX_CHROME_COLOR_LENGTH,
  violatesWatermarkInvariant,
  type ChromeSettings,
  type ChromeSettingsError,
  type ChromeSettingsUpdate,
} from '../services/chromeSettingsService'

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

/** Every settable field, as the DOM holds it (two switches + six strings). */
interface ChromeFormValues {
  readonly chromeEnabled: boolean
  readonly watermarkEnabled: boolean
  readonly topText: string
  readonly topFg: string
  readonly topBg: string
  readonly bottomText: string
  readonly bottomFg: string
  readonly bottomBg: string
}

/** Per-field validation messages, keyed by the form field they belong to. */
type FieldErrors = Partial<Record<keyof ChromeFormValues, string>>

/**
 * The NFR-008 message the panel shows before the server would say the same.
 *
 * Stated as the CONSEQUENCE, in a conductor's terms, rather than as the rule id:
 * the reader is running an exercise, not reading the requirements register (the
 * module header above carries NFR-008 for engineers).
 */
const BOTH_OFF_MESSAGE =
  'Turn on at least one marking. With the banners and the watermark both off, a screenshot from '
  + 'this exercise is indistinguishable from a real incident.'

/** `null` (not configured) renders as an EMPTY box — never as the fallback. */
function toText(value: string | null): string {
  return value ?? ''
}

/** An empty box means "not configured" and CLEARS the setting. */
function fromText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Seeds the form from the server's config. */
function toFormValues(settings: ChromeSettings): ChromeFormValues {
  return {
    chromeEnabled: settings.chromeEnabled,
    watermarkEnabled: settings.watermarkEnabled,
    topText: toText(settings.topText),
    topFg: toText(settings.topFg),
    topBg: toText(settings.topBg),
    bottomText: toText(settings.bottomText),
    bottomFg: toText(settings.bottomFg),
    bottomBg: toText(settings.bottomBg),
  }
}

/**
 * Builds the FULL-REPLACE request body.
 *
 * The return type's properties are all REQUIRED, so this function cannot compile
 * while omitting a field — that is the structural guarantee that saving one
 * setting never clears another (see the module header, rule 2).
 */
function toUpdate(values: ChromeFormValues): ChromeSettingsUpdate {
  return {
    chromeEnabled: values.chromeEnabled,
    watermarkEnabled: values.watermarkEnabled,
    topText: fromText(values.topText),
    topFg: fromText(values.topFg),
    topBg: fromText(values.topBg),
    bottomText: fromText(values.bottomText),
    bottomFg: fromText(values.bottomFg),
    bottomBg: fromText(values.bottomBg),
  }
}

/** A hex-color field error, or `undefined`. Blank is valid (clears the color). */
function colorError(value: string, label: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_CHROME_COLOR_LENGTH) {
    return `${label} must be ${MAX_CHROME_COLOR_LENGTH} characters or fewer.`
  }
  return CHROME_HEX_COLOR_PATTERN.test(trimmed)
    ? undefined
    : `${label} must be a hex color, for example #2e6b2e.`
}

/** A banner-text field error, or `undefined`. Blank is valid (keeps the default). */
function bannerTextError(value: string, label: string): string | undefined {
  return value.trim().length > MAX_BANNER_TEXT_LENGTH
    ? `${label} must be ${MAX_BANNER_TEXT_LENGTH} characters or fewer.`
    : undefined
}

/**
 * Client-side validation that mirrors the server's rules so a planner gets a
 * field-associated message instead of a round trip. The SERVER stays the
 * authority — a 400 is still surfaced verbatim.
 */
function validate(values: ChromeFormValues): FieldErrors {
  const errors: FieldErrors = {}

  // NFR-008 first: whether the exercise keeps a marking at all outranks whether
  // a color parses. Reported against the chrome switch, which is the control
  // the planner most likely just changed.
  if (violatesWatermarkInvariant(values.chromeEnabled, values.watermarkEnabled)) {
    errors.chromeEnabled = BOTH_OFF_MESSAGE
  }

  const topText = bannerTextError(values.topText, 'The top banner text')
  if (topText) errors.topText = topText
  const bottomText = bannerTextError(values.bottomText, 'The bottom banner text')
  if (bottomText) errors.bottomText = bottomText

  const topFg = colorError(values.topFg, 'The top banner text color')
  if (topFg) errors.topFg = topFg
  const topBg = colorError(values.topBg, 'The top banner background color')
  if (topBg) errors.topBg = topBg
  const bottomFg = colorError(values.bottomFg, 'The bottom banner text color')
  if (bottomFg) errors.bottomFg = bottomFg
  const bottomBg = colorError(values.bottomBg, 'The bottom banner background color')
  if (bottomBg) errors.bottomBg = bottomBg

  return errors
}

/**
 * Maps a thrown chrome error to clear, status-aware staff-facing copy.
 *
 * `verb` is the PAST PARTICIPLE ('loaded' / 'saved'), not the infinitive: the
 * previous `${verb}ed` produced "could not be saveed" on every failed save.
 */
function friendlyErrorMessage(error: ChromeSettingsError, verb: 'loaded' | 'saved'): string {
  switch (error.status) {
    case 400:
      return error.serverMessage
        ? `These banner settings were not saved: ${error.serverMessage}`
        : 'These banner settings were rejected and nothing was saved. Check the fields and try again.'
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'Your staff account is not assigned to this exercise.'
    case 404:
      return 'This exercise no longer exists. Pick another exercise and try again.'
    default:
      return error.status === undefined
        ? `Pulse could not be reached, so the compliance chrome was not ${verb}. Check your connection and try again.`
        : (error.serverMessage ?? `The compliance chrome was not ${verb}. Try again.`)
  }
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/** A `role="alert"` block pairing an icon with a message (never color-only). */
function ChromeAlert({ message, testId }: { message: string; testId: string }) {
  return (
    <Stack
      role="alert"
      direction="row"
      data-testid={testId}
      sx={{ alignItems: 'flex-start', gap: 1, color: 'error.main', mt: 1.5 }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">{message}</Typography>
    </Stack>
  )
}

/** A section heading inside the form. */
function SectionHeading({ text }: { text: string }) {
  return (
    <Typography
      variant="subtitle2"
      component="h3"
      sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', mt: 2.5, mb: 1 }}
    >
      {text}
    </Typography>
  )
}

// ---------------------------------------------------------------------------
// The form (mounted once the config has loaded)
// ---------------------------------------------------------------------------

interface ComplianceChromeFormProps {
  readonly settings: ChromeSettings
}

function ComplianceChromeForm({ settings }: ComplianceChromeFormProps) {
  const save = useSaveChromeSettings()

  // Re-sync from the SERVER's config whenever a new projection arrives — the
  // documented React "adjust state when a prop changes" pattern, no effect and
  // no flash of stale values. After a save the mutation seeds the query cache
  // with the response, which is how "re-render from the response, not from local
  // state" happens here.
  const [syncedFrom, setSyncedFrom] = useState<ChromeSettings>(settings)
  const [values, setValues] = useState<ChromeFormValues>(() => toFormValues(settings))
  const [errors, setErrors] = useState<FieldErrors>({})
  if (syncedFrom !== settings) {
    setSyncedFrom(settings)
    setValues(toFormValues(settings))
    setErrors({})
  }

  const setField = <K extends keyof ChromeFormValues>(field: K, value: ChromeFormValues[K]) => {
    setValues(current => ({ ...current, [field]: value }))
    save.reset()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // ONE call, ONE complete body — every managed field, every time.
    save.mutate(toUpdate(values))
  }

  const handleRevert = () => {
    setValues(toFormValues(settings))
    setErrors({})
    save.reset()
  }

  const disabled = save.isPending
  const hasClientErrors = Object.keys(errors).length > 0

  /** Shared props for every text field: bounded length, and an `id` so MUI binds
   *  the helper text with `aria-describedby`. */
  const textFieldProps = (field: keyof ChromeFormValues, hint: string) => ({
    id: `compliance-chrome-${field}`,
    error: Boolean(errors[field]),
    helperText: errors[field] ?? hint,
    disabled,
    fullWidth: true,
    size: 'small' as const,
  })

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate data-testid="compliance-chrome-form">
      {/*
        No `SectionHeading` above this group: the `legend` below already says
        "Exercise markings", and an `h3` carrying the identical string
        immediately above it was 50px of height spent saying the same thing
        twice — to a screen reader as well as on screen. The fieldset's legend
        is the group's real accessible name, which is why the shipped
        "Enabled channels" group in `ExerciseSettingsPanel` has never had a
        heading either.
      */}
      <FormControl
        component="fieldset"
        variant="standard"
        disabled={disabled}
        error={Boolean(errors.chromeEnabled)}
        aria-describedby="compliance-chrome-markings-help"
        data-testid="compliance-chrome-markings"
        sx={{ mt: 1 }}
      >
        <FormLabel component="legend">Exercise markings</FormLabel>
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={values.chromeEnabled}
                onChange={event => setField('chromeEnabled', event.target.checked)}
                slotProps={{ input: { 'aria-describedby': 'compliance-chrome-markings-help' } }}
              />
            }
            label="Show the compliance chrome banners"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={values.watermarkEnabled}
                onChange={event => setField('watermarkEnabled', event.target.checked)}
                slotProps={{ input: { 'aria-describedby': 'compliance-chrome-markings-help' } }}
              />
            }
            label="Show the in-content EXERCISE watermark"
          />
        </FormGroup>
        <FormHelperText id="compliance-chrome-markings-help">
          {errors.chromeEnabled ??
            'You can turn one marking off, but not both. Every exercise has to carry at least one '
              + 'EXERCISE marking.'}
        </FormHelperText>
      </FormControl>

      {/*
        THE TWO BANNERS SIT SIDE BY SIDE. They carry IDENTICAL field sets (text
        / foreground / background), so pairing them halves the height of the
        section AND puts the two values a planner is choosing between — the top
        marking and the bottom one — on screen together. Stacked, this section
        overflowed a desktop work area by ~50px. `FieldGrid` collapses the pair
        back into one column when the pane is too narrow to hold both.
      */}
      <FieldGrid minColumnWidth={320}>
        <Box>
          <SectionHeading text="Top banner" />
          <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
            <CobraTextField
              {...textFieldProps(
                'topText',
                'Runs across the top of every participant screen. Leave it blank to use the '
                + 'standard wording.',
              )}
              label="Top banner text"
              value={values.topText}
              onChange={event => setField('topText', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_BANNER_TEXT_LENGTH } }}
            />
            <CobraTextField
              {...textFieldProps(
                'topFg',
                'Color of the banner wording. Hex, for example #eaf5e6. Blank uses the standard '
                + 'color.',
              )}
              label="Top banner text color"
              value={values.topFg}
              onChange={event => setField('topFg', event.target.value)}
            />
            <CobraTextField
              {...textFieldProps(
                'topBg',
                'Color of the band behind it. Hex, for example #2e6b2e. Blank uses the standard '
                + 'color.',
              )}
              label="Top banner background color"
              value={values.topBg}
              onChange={event => setField('topBg', event.target.value)}
            />
          </Stack>
        </Box>

        <Box>
          <SectionHeading text="Bottom banner" />
          <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
            <CobraTextField
              {...textFieldProps(
                'bottomText',
                'Runs across the bottom of every participant screen. Leave it blank to use the '
                + 'standard wording.',
              )}
              label="Bottom banner text"
              value={values.bottomText}
              onChange={event => setField('bottomText', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_BANNER_TEXT_LENGTH } }}
            />
            <CobraTextField
              {...textFieldProps(
                'bottomFg',
                'Color of the banner wording. Hex, for example #eaf5e6. Blank uses the standard '
                + 'color.',
              )}
              label="Bottom banner text color"
              value={values.bottomFg}
              onChange={event => setField('bottomFg', event.target.value)}
            />
            <CobraTextField
              {...textFieldProps(
                'bottomBg',
                'Color of the band behind it. Hex, for example #2e6b2e. Blank uses the standard '
                + 'color.',
              )}
              label="Bottom banner background color"
              value={values.bottomBg}
              onChange={event => setField('bottomBg', event.target.value)}
            />
          </Stack>
        </Box>
      </FieldGrid>

      {/* Pinned to the bottom of the scrolling content pane — see
          `PanelSaveBar`. This panel has its own save; it must stay as reachable
          as the shared settings one. */}
      <PanelSaveBar>
        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
          <CobraPrimaryButton
            type="submit"
            disabled={disabled}
            startIcon={
              save.isPending
                ? <CircularProgress size={16} color="inherit" />
                : <FontAwesomeIcon icon={faFloppyDisk} />
            }
          >
            {save.isPending ? 'Saving…' : 'Save compliance chrome'}
          </CobraPrimaryButton>
          <CobraSecondaryButton
            type="button"
            onClick={handleRevert}
            disabled={disabled}
            startIcon={<FontAwesomeIcon icon={faRotateLeft} />}
          >
            Revert changes
          </CobraSecondaryButton>
        </Stack>

        {hasClientErrors ? (
          <ChromeAlert
            message="Nothing was saved. Fix the marked fields, then save again."
            testId="compliance-chrome-client-error"
          />
        ) : null}

        {save.isError ? (
          <ChromeAlert
            message={friendlyErrorMessage(save.error, 'saved')}
            testId="compliance-chrome-save-error"
          />
        ) : null}

        {save.isSuccess ? (
          <Stack
            role="status"
            direction="row"
            data-testid="compliance-chrome-saved"
            sx={{ alignItems: 'center', gap: 1, color: 'success.main', mt: 1.5 }}
          >
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
            <Typography variant="body2">
              Compliance chrome saved. The fields above now show the stored values.
            </Typography>
          </Stack>
        ) : null}
      </PanelSaveBar>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The panel (query states + the form)
// ---------------------------------------------------------------------------

/**
 * The compliance-chrome panel. Self-contained COBRA staff surface: it loads the
 * resolved exercise's COR-031 chrome config, renders it for editing, and
 * full-replaces it on save. Takes no props — `ExerciseSettingsPage` mounts it
 * with a single JSX line.
 */
export function ComplianceChromePanel() {
  const chromeQuery = useChromeSettings()

  return (
    <Box
      component="section"
      aria-labelledby="compliance-chrome-heading"
      data-testid="compliance-chrome-panel"
      sx={{
        // See `ExerciseSettingsPanel`: the page's content pane already supplies
        // the outer padding; only the bottom is kept, as the room the pinned
        // save bar swallows.
        paddingBottom: CobraStyles.Padding.MainWindow,
        maxWidth: 860,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faShieldHalved} aria-hidden />
        <Typography
          id="compliance-chrome-heading"
          variant="h6"
          component="h2"
          sx={{ fontWeight: 700 }}
        >
          Compliance chrome
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        The EXERCISE markings that top and tail every participant screen, so nobody mistakes
        exercise traffic for a real incident. One Save covers every field below. A field left blank
        is not stored: that banner keeps its standard wording.
      </Typography>

      {chromeQuery.isPending ? (
        <Stack
          role="status"
          direction="row"
          data-testid="compliance-chrome-loading"
          sx={{ alignItems: 'center', gap: 1, mt: 2 }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2">Loading compliance chrome…</Typography>
        </Stack>
      ) : null}

      {chromeQuery.isError ? (
        <ChromeAlert
          message={friendlyErrorMessage(chromeQuery.error, 'loaded')}
          testId="compliance-chrome-load-error"
        />
      ) : null}

      {chromeQuery.isSuccess ? <ComplianceChromeForm settings={chromeQuery.data} /> : null}
    </Box>
  )
}
