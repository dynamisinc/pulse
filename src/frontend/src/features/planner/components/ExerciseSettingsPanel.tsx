/**
 * features/planner/components/ExerciseSettingsPanel.tsx
 * ---------------------------------------------------------------------------
 * The staff-console PER-EXERCISE SETTINGS editor (feature:
 * exercise-configuration, story 01b — "Settings API + shell-config service +
 * staff editor"; COR-030 / XC-008; issue #41 / story #67). A planner reads and
 * full-replaces the settings that define a world: internal name,
 * participant-visible world name + locale, the exercise's single IANA time
 * zone, the scheduled window, the enabled channel set, and the theming block
 * (brand name + colors, per-outlet display names).
 *
 * TWO WORLDS — this is the STAFF world (D0 §2 / CLAUDE.md). COBRA look via
 * `@/theme/styledComponents` (`CobraPrimaryButton` / `CobraSecondaryButton` /
 * `CobraTextField`) + `CobraStyles` spacing, rendered inside the app's COBRA
 * `ThemeProvider`. It must NEVER read as a participant skin and never mounts a
 * brand theme — even though the values it edits are what the participant world
 * is skinned FROM. Icons are FontAwesome only; MUI system props go through `sx`
 * (MUI 9).
 *
 * ============================================================================
 * THE THREE RULES THIS COMPONENT EXISTS TO GET RIGHT
 * ============================================================================
 *
 * 1. `PUT` IS A FULL REPLACE, NOT A PATCH. An omitted or `null` optional field
 *    CLEARS it. So the form must submit EVERY field it manages on every save,
 *    or saving one field silently wipes the others. The guarantee here is
 *    structural, not vigilance:
 *      - one `ExerciseSettingsFormValues` object holds a value for every
 *        settable field (nothing is read straight off the DOM or the loaded
 *        settings at submit time);
 *      - `toUpdate()` returns `ExerciseSettingsUpdate`, whose every property is
 *        REQUIRED (`T | null`, never `T | undefined`) — forgetting a field is a
 *        COMPILE ERROR, not a silent data loss;
 *      - `outletNames` keeps a field for every key the server sent, including
 *        keys outside the channel catalog, so a full replace never drops an
 *        entry this editor did not know how to show.
 *
 * 2. A `null` OPTIONAL FIELD MEANS "NOT CONFIGURED" AND RENDERS EMPTY. The
 *    participant world falls back to a shipped constant for it. Pre-filling
 *    that constant and saving would silently turn a fallback into stored
 *    configuration, so `null` maps to `''` — never to the fallback value — and
 *    an empty box maps back to `null`.
 *
 * 3. THE CHANNEL CHECKBOXES ARE RENDERED FROM THE RESPONSE'S `channels` ARRAY.
 *    The catalog is CLOSED and server-owned; a client-invented id is a 400. No
 *    channel id is hardcoded in this file.
 *
 * Saving re-renders from the SERVER'S RESPONSE (the mutation seeds the query
 * cache — see `useExerciseSettings.ts`), never from local form state: the server
 * sanitizes free text (NFR-004), canonicalizes channel ids and round-trip
 * formats the instants, so its projection is the truth about what was stored.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - Every input is a real labelled control. Field errors are programmatically
 *    associated with their field — MUI wires `aria-describedby` to the helper
 *    text from the field's `id`, and `error` sets `aria-invalid` — so the error
 *    is never conveyed by color alone.
 *  - The channel checkbox group is a `fieldset`/`legend` whose validation
 *    message is bound with `aria-describedby`.
 *  - The load state and the save outcome reach assistive tech: `role="status"`
 *    for loading/success, `role="alert"` for every failure, each pairing a
 *    FontAwesome icon with text.
 *
 * CONTENT SECURITY (NFR-004): free text (world name, brand name, outlet names)
 * is sanitized SERVER-side through the shipped `PostSanitizer` on write — this
 * panel hand-rolls no sanitizer. Everything it displays is a React text node
 * (`{value}`) or an `<input value>`; there is no `dangerouslySetInnerHTML`
 * anywhere, so stored markup can never execute in the console.
 *
 * SCENARIO TIME (COR-053): not applicable. This is the staff world; the two
 * schedule fields are absolute planning instants, edited and labelled
 * explicitly in UTC so a staff planner is never guessing which clock a stored
 * instant belongs to.
 */

import { useState, type FormEvent } from 'react'
import {
  Box,
  Checkbox,
  CircularProgress,
  Divider,
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
  faSliders,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { useExerciseSettings, useSaveExerciseSettings } from '../hooks/useExerciseSettings'
import {
  HEX_COLOR_PATTERN,
  MAX_BRAND_NAME_LENGTH,
  MAX_COLOR_LENGTH,
  MAX_LOCALE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_OUTLET_NAME_LENGTH,
  MAX_TIME_ZONE_LENGTH,
  MAX_WORLD_NAME_LENGTH,
  type ExerciseSettings,
  type ExerciseSettingsError,
  type ExerciseSettingsUpdate,
} from '../services/exerciseSettingsService'

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

/**
 * Every settable field, as the DOM holds it (strings + a checked-id list + the
 * outlet map). One object, so `toUpdate()` can build a complete full-replace
 * body without reaching back into the loaded settings or the DOM.
 */
interface ExerciseSettingsFormValues {
  readonly name: string
  readonly worldName: string
  readonly locale: string
  readonly timeZone: string
  /** `datetime-local` value in UTC (`yyyy-MM-ddTHH:mm:ss`), or `''`. */
  readonly scheduledStartAt: string
  /** `datetime-local` value in UTC (`yyyy-MM-ddTHH:mm:ss`), or `''`. */
  readonly scheduledEndAt: string
  readonly enabledChannelIds: readonly string[]
  readonly brandName: string
  readonly brandPrimary: string
  readonly brandAccent: string
  readonly brandSurface: string
  readonly brandOnSurface: string
  /** Keyed by outlet id; a blank value means "not configured". */
  readonly outletNames: Readonly<Record<string, string>>
}

/** Per-field validation messages, keyed by the form field they belong to. */
type FieldErrors = Partial<Record<keyof ExerciseSettingsFormValues, string>>

/**
 * Renders a stored ISO instant as a UTC `datetime-local` value.
 *
 * An unparseable stored value is passed through verbatim rather than dropped —
 * losing it would let a full replace clear a schedule the planner never touched.
 */
function toDateTimeInput(instant: string | null): string {
  if (instant === null || instant.trim().length === 0) return ''
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return instant
  return parsed.toISOString().slice(0, 19)
}

/** Parses a UTC `datetime-local` value back to an ISO instant (`''` -> `null`). */
function fromDateTimeInput(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = new Date(trimmed.endsWith('Z') ? trimmed : `${trimmed}Z`)
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString()
}

/** `null` (not configured) renders as an EMPTY box — never as the fallback. */
function toText(value: string | null): string {
  return value ?? ''
}

/** An empty box means "not configured" and CLEARS the setting. */
function fromText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Seeds the form from the server's settings.
 *
 * `outletNames` gets a field for every catalogued channel AND for every extra
 * key the server already stores, so a full replace can never drop an entry this
 * editor did not know how to render.
 */
function toFormValues(settings: ExerciseSettings): ExerciseSettingsFormValues {
  const outletNames: Record<string, string> = {}
  for (const channel of settings.channels) {
    outletNames[channel.id] = ''
  }
  for (const [key, value] of Object.entries(settings.outletNames)) {
    outletNames[key] = value
  }

  return {
    name: settings.name,
    worldName: toText(settings.worldName),
    locale: toText(settings.locale),
    timeZone: settings.timeZone,
    scheduledStartAt: toDateTimeInput(settings.scheduledStartAt),
    scheduledEndAt: toDateTimeInput(settings.scheduledEndAt),
    enabledChannelIds: settings.channels.filter(c => c.enabled).map(c => c.id),
    brandName: toText(settings.brandName),
    brandPrimary: toText(settings.brandPrimary),
    brandAccent: toText(settings.brandAccent),
    brandSurface: toText(settings.brandSurface),
    brandOnSurface: toText(settings.brandOnSurface),
    outletNames,
  }
}

/**
 * Builds the FULL-REPLACE request body.
 *
 * The return type's properties are all REQUIRED, so this function cannot
 * compile while omitting a field — that is the structural guarantee that saving
 * one setting never clears another (see the module header, rule 1).
 */
function toUpdate(values: ExerciseSettingsFormValues): ExerciseSettingsUpdate {
  const outletNames: Record<string, string> = {}
  for (const [key, value] of Object.entries(values.outletNames)) {
    const trimmed = value.trim()
    if (trimmed.length > 0) outletNames[key] = trimmed
  }

  return {
    name: values.name.trim(),
    worldName: fromText(values.worldName),
    locale: fromText(values.locale),
    timeZone: values.timeZone.trim(),
    scheduledStartAt: fromDateTimeInput(values.scheduledStartAt),
    scheduledEndAt: fromDateTimeInput(values.scheduledEndAt),
    // Never `[]` — an empty list is a 400 (the server refuses to blank the
    // participant world), and validation blocks submission before we get here.
    enabledChannels: values.enabledChannelIds,
    brandName: fromText(values.brandName),
    brandPrimary: fromText(values.brandPrimary),
    brandAccent: fromText(values.brandAccent),
    brandSurface: fromText(values.brandSurface),
    brandOnSurface: fromText(values.brandOnSurface),
    outletNames,
  }
}

/** True when `zone` is an IANA id this runtime recognises (a Windows id throws). */
function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** A hex-color field error, or `undefined`. Blank is valid (clears the color). */
function colorError(value: string, label: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_COLOR_LENGTH) return `${label} must be ${MAX_COLOR_LENGTH} characters or fewer.`
  return HEX_COLOR_PATTERN.test(trimmed)
    ? undefined
    : `${label} must be a CSS hex color, for example #2b5f75.`
}

/** A max-length field error, or `undefined`. */
function lengthError(value: string, max: number, label: string): string | undefined {
  return value.trim().length > max ? `${label} must be ${max} characters or fewer.` : undefined
}

/**
 * Client-side validation that mirrors the server's rules so a planner gets a
 * field-associated message instead of a round trip. The SERVER stays the
 * authority — a 400 is still surfaced verbatim.
 */
function validate(values: ExerciseSettingsFormValues): FieldErrors {
  const errors: FieldErrors = {}

  if (values.name.trim().length === 0) {
    errors.name = 'An exercise name is required.'
  } else {
    const tooLong = lengthError(values.name, MAX_NAME_LENGTH, 'The exercise name')
    if (tooLong) errors.name = tooLong
  }

  const worldNameError = lengthError(values.worldName, MAX_WORLD_NAME_LENGTH, 'The world name')
  if (worldNameError) errors.worldName = worldNameError

  const localeError = lengthError(values.locale, MAX_LOCALE_LENGTH, 'The locale')
  if (localeError) errors.locale = localeError

  const zone = values.timeZone.trim()
  if (zone.length === 0) {
    errors.timeZone = 'A time zone is required.'
  } else if (zone.length > MAX_TIME_ZONE_LENGTH) {
    errors.timeZone = `The time zone must be ${MAX_TIME_ZONE_LENGTH} characters or fewer.`
  } else if (!isIanaZone(zone)) {
    errors.timeZone =
      'Enter an IANA time zone, for example America/New_York. Windows zone ids are not accepted.'
  }

  const start = values.scheduledStartAt.trim()
  const end = values.scheduledEndAt.trim()
  const startInstant = start.length > 0 ? new Date(`${start}Z`) : null
  const endInstant = end.length > 0 ? new Date(`${end}Z`) : null
  if (startInstant !== null && Number.isNaN(startInstant.getTime())) {
    errors.scheduledStartAt = 'Enter a valid start date and time, or leave it empty.'
  }
  if (endInstant !== null && Number.isNaN(endInstant.getTime())) {
    errors.scheduledEndAt = 'Enter a valid end date and time, or leave it empty.'
  } else if (
    startInstant !== null &&
    endInstant !== null &&
    !Number.isNaN(startInstant.getTime()) &&
    endInstant.getTime() < startInstant.getTime()
  ) {
    errors.scheduledEndAt = 'The end must not come before the start.'
  }

  if (values.enabledChannelIds.length === 0) {
    errors.enabledChannelIds =
      'Enable at least one channel. An exercise with no channels would leave participants with nothing to see.'
  }

  const brandNameError = lengthError(values.brandName, MAX_BRAND_NAME_LENGTH, 'The brand name')
  if (brandNameError) errors.brandName = brandNameError

  const primary = colorError(values.brandPrimary, 'The primary color')
  if (primary) errors.brandPrimary = primary
  const accent = colorError(values.brandAccent, 'The accent color')
  if (accent) errors.brandAccent = accent
  const surface = colorError(values.brandSurface, 'The surface color')
  if (surface) errors.brandSurface = surface
  const onSurface = colorError(values.brandOnSurface, 'The on-surface color')
  if (onSurface) errors.brandOnSurface = onSurface

  for (const [key, value] of Object.entries(values.outletNames)) {
    if (value.trim().length > MAX_OUTLET_NAME_LENGTH) {
      errors.outletNames = `Each outlet name must be ${MAX_OUTLET_NAME_LENGTH} characters or fewer (check ${key}).`
      break
    }
  }

  return errors
}

/** Maps a thrown settings error to clear, status-aware staff-facing copy. */
function friendlyErrorMessage(error: ExerciseSettingsError, verb: 'load' | 'save'): string {
  switch (error.status) {
    case 400:
      return error.serverMessage
        ? `These settings were not saved: ${error.serverMessage}`
        : 'These settings were rejected. Nothing was saved — check the fields and try again.'
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'Your staff account is not assigned to this exercise.'
    case 404:
      return 'This exercise no longer exists. Pick another exercise and try again.'
    default:
      return error.status === undefined
        ? `Could not reach the server, so the settings could not be ${verb}ed. Check your connection and try again.`
        : (error.serverMessage ?? `The settings could not be ${verb}ed. Please try again.`)
  }
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/** A `role="alert"` block pairing an icon with a message (never color-only). */
function SettingsAlert({ message, testId }: { message: string; testId: string }) {
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
// The form (mounted once settings have loaded)
// ---------------------------------------------------------------------------

interface ExerciseSettingsFormProps {
  readonly settings: ExerciseSettings
}

function ExerciseSettingsForm({ settings }: ExerciseSettingsFormProps) {
  const save = useSaveExerciseSettings()

  // Re-sync from the SERVER's settings whenever a new projection arrives — the
  // documented React "adjust state when a prop changes" pattern, no effect and
  // no flash of stale values. After a save the mutation seeds the query cache
  // with the response, which is exactly how "re-render from the response, not
  // from local state" happens here.
  const [syncedFrom, setSyncedFrom] = useState<ExerciseSettings>(settings)
  const [values, setValues] = useState<ExerciseSettingsFormValues>(() => toFormValues(settings))
  const [errors, setErrors] = useState<FieldErrors>({})
  if (syncedFrom !== settings) {
    setSyncedFrom(settings)
    setValues(toFormValues(settings))
    setErrors({})
  }

  const setField = <K extends keyof ExerciseSettingsFormValues>(
    field: K,
    value: ExerciseSettingsFormValues[K],
  ) => {
    setValues(current => ({ ...current, [field]: value }))
    save.reset()
  }

  const toggleChannel = (id: string, enabled: boolean) => {
    setField(
      'enabledChannelIds',
      enabled
        ? [...values.enabledChannelIds, id]
        : values.enabledChannelIds.filter(current => current !== id),
    )
  }

  const setOutletName = (id: string, value: string) => {
    setField('outletNames', { ...values.outletNames, [id]: value })
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
  const extraOutletKeys = Object.keys(values.outletNames).filter(
    key => !settings.channels.some(channel => channel.id === key),
  )

  /** Shared props for every text field: label, bounded length, and an
   *  `id` so MUI binds the helper text with `aria-describedby`. */
  const textFieldProps = (field: keyof ExerciseSettingsFormValues, hint: string) => ({
    id: `exercise-settings-${field}`,
    error: Boolean(errors[field]),
    helperText: errors[field] ?? hint,
    disabled,
    fullWidth: true,
    size: 'small' as const,
  })

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate data-testid="exercise-settings-form">
      <SectionHeading text="Identity" />
      <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
        <CobraTextField
          {...textFieldProps('name', 'Staff-facing internal name for this run. Participants never see it.')}
          label="Exercise name"
          required
          value={values.name}
          onChange={event => setField('name', event.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
        />
        <CobraTextField
          {...textFieldProps(
            'worldName',
            'Participant-visible name of the simulated world. Leave empty to keep the shipped default.',
          )}
          label="World name"
          value={values.worldName}
          onChange={event => setField('worldName', event.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_WORLD_NAME_LENGTH } }}
        />
        <CobraTextField
          {...textFieldProps('locale', 'BCP-47 tag, for example en-US. Leave empty to keep the shipped default.')}
          label="Locale"
          value={values.locale}
          onChange={event => setField('locale', event.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_LOCALE_LENGTH } }}
        />
      </Stack>

      <SectionHeading text="Time and schedule" />
      <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
        <CobraTextField
          {...textFieldProps(
            'timeZone',
            'One IANA zone per exercise, for example America/New_York. Every participant timestamp renders in it.',
          )}
          label="Time zone"
          required
          value={values.timeZone}
          onChange={event => setField('timeZone', event.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_TIME_ZONE_LENGTH } }}
        />
        <Stack direction="row" sx={{ gap: CobraStyles.Spacing.FormFields, flexWrap: 'wrap' }}>
          <CobraTextField
            {...textFieldProps('scheduledStartAt', 'Absolute instant, entered in UTC. Leave empty if unscheduled.')}
            label="Scheduled start (UTC)"
            type="datetime-local"
            value={values.scheduledStartAt}
            onChange={event => setField('scheduledStartAt', event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }}
            sx={{ flex: '1 1 220px' }}
          />
          <CobraTextField
            {...textFieldProps('scheduledEndAt', 'Absolute instant, entered in UTC. Must not precede the start.')}
            label="Scheduled end (UTC)"
            type="datetime-local"
            value={values.scheduledEndAt}
            onChange={event => setField('scheduledEndAt', event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }}
            sx={{ flex: '1 1 220px' }}
          />
        </Stack>
      </Stack>

      <SectionHeading text="Channels" />
      <FormControl
        component="fieldset"
        variant="standard"
        disabled={disabled}
        error={Boolean(errors.enabledChannelIds)}
        aria-describedby="exercise-settings-channels-help"
        data-testid="exercise-settings-channels"
      >
        <FormLabel component="legend">Enabled channels</FormLabel>
        <FormGroup>
          {/* Rendered from the server's CLOSED catalog — no channel id is
              hardcoded here; an invented id would be a 400. */}
          {settings.channels.map(channel => (
            <FormControlLabel
              key={channel.id}
              control={
                <Checkbox
                  checked={values.enabledChannelIds.includes(channel.id)}
                  onChange={event => toggleChannel(channel.id, event.target.checked)}
                  slotProps={{ input: { 'aria-describedby': 'exercise-settings-channels-help' } }}
                />
              }
              /* The server's own label — this is the ACCESSIBLE NAME each
                 checkbox is found by, so nothing here depends on a client-side
                 id list. */
              label={channel.label}
            />
          ))}
        </FormGroup>
        <FormHelperText id="exercise-settings-channels-help">
          {errors.enabledChannelIds ??
            'A disabled channel is catalogued but never served to participants.'}
        </FormHelperText>
      </FormControl>

      <SectionHeading text="Theming" />
      <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
        <CobraTextField
          {...textFieldProps(
            'brandName',
            'Participant-visible brand name. Leave empty to keep the shipped default brand.',
          )}
          label="Brand name"
          value={values.brandName}
          onChange={event => setField('brandName', event.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_BRAND_NAME_LENGTH } }}
        />
        <Stack direction="row" sx={{ gap: CobraStyles.Spacing.FormFields, flexWrap: 'wrap' }}>
          <CobraTextField
            {...textFieldProps('brandPrimary', 'Hex, for example #2b5f75. Empty keeps the default.')}
            label="Primary color"
            value={values.brandPrimary}
            onChange={event => setField('brandPrimary', event.target.value)}
            sx={{ flex: '1 1 180px' }}
          />
          <CobraTextField
            {...textFieldProps('brandAccent', 'Hex. Empty keeps the default.')}
            label="Accent color"
            value={values.brandAccent}
            onChange={event => setField('brandAccent', event.target.value)}
            sx={{ flex: '1 1 180px' }}
          />
        </Stack>
        <Stack direction="row" sx={{ gap: CobraStyles.Spacing.FormFields, flexWrap: 'wrap' }}>
          <CobraTextField
            {...textFieldProps('brandSurface', 'Hex. Empty keeps the default.')}
            label="Surface color"
            value={values.brandSurface}
            onChange={event => setField('brandSurface', event.target.value)}
            sx={{ flex: '1 1 180px' }}
          />
          <CobraTextField
            {...textFieldProps('brandOnSurface', 'Hex. Empty keeps the default.')}
            label="On-surface color"
            value={values.brandOnSurface}
            onChange={event => setField('brandOnSurface', event.target.value)}
            sx={{ flex: '1 1 180px' }}
          />
        </Stack>
      </Stack>

      <SectionHeading text="Outlet names" />
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Per-outlet display names. Leave one empty to keep that outlet&rsquo;s shipped default name.
      </Typography>
      <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
        {settings.channels.map(channel => (
          <CobraTextField
            key={channel.id}
            id={`exercise-settings-outlet-${channel.id}`}
            label={`${channel.label} outlet name`}
            value={values.outletNames[channel.id] ?? ''}
            onChange={event => setOutletName(channel.id, event.target.value)}
            disabled={disabled}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { maxLength: MAX_OUTLET_NAME_LENGTH } }}
          />
        ))}
        {/* Keys the server already stores that fall outside the catalog: shown
            so a FULL REPLACE never silently drops them. */}
        {extraOutletKeys.map(key => (
          <CobraTextField
            key={key}
            id={`exercise-settings-outlet-${key}`}
            label={`${key} outlet name`}
            value={values.outletNames[key] ?? ''}
            onChange={event => setOutletName(key, event.target.value)}
            disabled={disabled}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { maxLength: MAX_OUTLET_NAME_LENGTH } }}
          />
        ))}
        {errors.outletNames ? (
          <SettingsAlert message={errors.outletNames} testId="exercise-settings-outlet-error" />
        ) : null}
      </Stack>

      <Divider sx={{ mt: 3 }} />

      <Stack
        direction="row"
        sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 2 }}
      >
        <CobraPrimaryButton
          type="submit"
          disabled={disabled}
          startIcon={
            save.isPending
              ? <CircularProgress size={16} color="inherit" />
              : <FontAwesomeIcon icon={faFloppyDisk} />
          }
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
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
        <SettingsAlert
          message="Some settings need attention before they can be saved. Nothing has been sent to the server."
          testId="exercise-settings-client-error"
        />
      ) : null}

      {save.isError ? (
        <SettingsAlert
          message={friendlyErrorMessage(save.error, 'save')}
          testId="exercise-settings-save-error"
        />
      ) : null}

      {save.isSuccess ? (
        <Stack
          role="status"
          direction="row"
          data-testid="exercise-settings-saved"
          sx={{ alignItems: 'center', gap: 1, color: 'success.main', mt: 1.5 }}
        >
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
          <Typography variant="body2">
            Settings saved. The fields below now show what the server stored.
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The panel (query states + the form)
// ---------------------------------------------------------------------------

/**
 * The per-exercise settings panel. Self-contained COBRA staff surface: it loads
 * the resolved exercise's COR-030 settings, renders them for editing, and
 * full-replaces them on save. Mounted by `ExerciseSettingsPage`.
 */
export function ExerciseSettingsPanel() {
  const settingsQuery = useExerciseSettings()

  return (
    <Box
      component="section"
      aria-labelledby="exercise-settings-heading"
      data-testid="exercise-settings-panel"
      sx={{ padding: CobraStyles.Padding.MainWindow, maxWidth: 860 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faSliders} aria-hidden />
        <Typography id="exercise-settings-heading" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Exercise settings
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        The settings that define this world. Saving replaces the whole block, so every field
        below is sent together. An empty field means &ldquo;not configured&rdquo; — that setting
        falls back to the shipped default rather than being stored.
      </Typography>

      {settingsQuery.isPending ? (
        <Stack
          role="status"
          direction="row"
          data-testid="exercise-settings-loading"
          sx={{ alignItems: 'center', gap: 1, mt: 2 }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2">Loading exercise settings…</Typography>
        </Stack>
      ) : null}

      {settingsQuery.isError ? (
        <SettingsAlert
          message={friendlyErrorMessage(settingsQuery.error, 'load')}
          testId="exercise-settings-load-error"
        />
      ) : null}

      {settingsQuery.isSuccess ? <ExerciseSettingsForm settings={settingsQuery.data} /> : null}
    </Box>
  )
}
