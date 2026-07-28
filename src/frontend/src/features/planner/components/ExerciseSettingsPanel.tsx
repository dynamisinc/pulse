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
 *  - Every input is a real labeled control. Field errors are programmatically
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
 * schedule fields are absolute planning instants, edited and labeled
 * explicitly in UTC so a staff planner is never guessing which clock a stored
 * instant belongs to.
 *
 * ============================================================================
 * THREE SECTIONS, **ONE FORM** — THE THING TO NOT BREAK
 * ============================================================================
 * `ExerciseSettingsPage` presents this editor as three entries in its left
 * section nav — Identity & schedule / Channels / Theming & outlets — and passes
 * the selected one in as `section`. That is a VIEW SWITCH, not three forms:
 *
 *   - ONE `ExerciseSettingsPanel` is mounted, whichever section is selected, so
 *     there is ONE `ExerciseSettingsFormValues` object, ONE save and ONE revert.
 *     Mounting a second instance per section would give each its own state and
 *     each save would clear the other two sections' fields (rule 1 above).
 *   - The unselected sections' inputs are NOT RENDERED, and that is safe only
 *     because the values live in React state, never in the DOM: `toUpdate()`
 *     reads `values`, so an off-screen field is still submitted, unchanged.
 *     Never rewrite this to read a field off the DOM at submit time.
 *   - The save / revert footer renders in ALL THREE sections (it is outside the
 *     per-section blocks), so a planner never has to hunt for the section that
 *     happens to own the button. It is a `PanelSaveBar`, PINNED to the bottom of
 *     the page's scrolling content pane: with one save covering three sections,
 *     a commit button that can scroll out of reach is a safety problem, not a
 *     cosmetic one.
 *
 * ============================================================================
 * LAYOUT: COLUMNS, BECAUSE HEIGHT IS THE SCARCE RESOURCE
 * ============================================================================
 * Every section here used to stack its fields in ONE column, and measured in a
 * real browser at 1440x900 (work area 844px) two of the three overflowed —
 * theming, ten fields tall, by ~170px. A planner had to SCROLL A FULL-REPLACE
 * FORM to reach the button that commits it.
 *
 * Fields now flow into columns via `FieldGrid`, which picks the column count
 * from the width available and collapses to one column when there is none. The
 * three groupings, and why their column floors differ:
 *   - identity (270px) — three free-text fields with long helper text;
 *   - time and schedule (240px) — short, known-format values (an IANA id, two
 *     instants), so they read fine three-up;
 *   - theming (190px) — the brand name keeps the full row, the four colors
 *     share the one below it;
 *   - outlet names (220px) — no helper text, so the narrowest floor of the four,
 *     but not narrower: the labels ("Press Room outlet name") must not clip.
 *
 * NOTHING WAS SHRUNK TO MAKE THIS FIT: no fixed heights, no reduced font sizes,
 * no controls below the COBRA `size="small"` norm. The height came out of the
 * width that was already there, plus this panel's own outer padding, which
 * duplicated the padding the page's content pane already supplies.
 *
 * Two callbacks report upward so the PAGE's nav can show what this form knows
 * and the page itself stays free of form state:
 *   - `onStatusChange` — whether the form is dirty, and which sections hold a
 *     validation error, so the nav can mark them (icon + text, never color
 *     alone) and warn about unsaved edits before the planner walks away.
 *   - `onRequestSection` — after a blocked save whose errors are all in sections
 *     that are NOT on screen, this asks the page to move to the first offending
 *     one. Without it a client-side error could be invisible: the server reports
 *     only the FIRST failure, so client validation is what makes a multi-section
 *     problem discoverable at all.
 * Both are optional: the panel is fully usable (and testable) standalone.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { FieldGrid } from './FieldGrid'
import { PanelSaveBar } from './PanelSaveBar'
import {
  CLEAN_EXERCISE_SETTINGS_STATUS,
  EXERCISE_SETTINGS_SECTION_META,
  EXERCISE_SETTINGS_SECTION_ORDER,
  type ExerciseSettingsSectionId,
  type ExerciseSettingsStatus,
} from '../exerciseSettingsSections'
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
 * Which section each field is edited in. REQUIRED for every key of
 * `ExerciseSettingsFormValues`, so adding a field without deciding where it
 * lives is a COMPILE ERROR — a field with no section could fail validation in a
 * place the nav can never point at.
 */
const FIELD_SECTIONS: Readonly<
  Record<keyof ExerciseSettingsFormValues, ExerciseSettingsSectionId>
> = {
  name: 'identity',
  worldName: 'identity',
  locale: 'identity',
  timeZone: 'identity',
  scheduledStartAt: 'identity',
  scheduledEndAt: 'identity',
  enabledChannelIds: 'channels',
  brandName: 'theming',
  brandPrimary: 'theming',
  brandAccent: 'theming',
  brandSurface: 'theming',
  brandOnSurface: 'theming',
  outletNames: 'theming',
}

/** The sections holding at least one of these errors, in nav order. */
function sectionsWithErrors(errors: FieldErrors): readonly ExerciseSettingsSectionId[] {
  const hit = new Set<ExerciseSettingsSectionId>()
  for (const field of Object.keys(errors) as (keyof ExerciseSettingsFormValues)[]) {
    hit.add(FIELD_SECTIONS[field])
  }
  return EXERCISE_SETTINGS_SECTION_ORDER.filter(section => hit.has(section))
}

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
 * `outletNames` gets a field for every cataloged channel AND for every extra
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

/**
 * True when saving now would send something OTHER than what the server already
 * holds — i.e. there are unsaved changes.
 *
 * It compares the two REQUEST BODIES rather than the raw form values, so a
 * whitespace-only edit that `toUpdate()` trims away is correctly "not dirty":
 * the question this answers is "would the planner lose anything?", and they
 * cannot lose what would never have been sent. Both bodies are built by the same
 * function from objects seeded the same way, so their key order matches and a
 * JSON comparison is sound. `enabledChannels` is compared IN ORDER: re-checking
 * the same channels in a different order reads as dirty, which errs toward
 * warning — the safe direction for an unsaved-changes prompt.
 */
function isDirty(values: ExerciseSettingsFormValues, settings: ExerciseSettings): boolean {
  return JSON.stringify(toUpdate(values)) !== JSON.stringify(toUpdate(toFormValues(settings)))
}

/** True when `zone` is an IANA id this runtime recognizes (a Windows id throws). */
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
    : `${label} must be a hex color, for example #2b5f75.`
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
      'Enter an IANA time zone, for example America/New_York. A name like Eastern Standard Time '
      + 'will not work.'
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
      'Turn on at least one channel. With all of them off, participants have nothing to see.'
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

/**
 * Maps a thrown settings error to clear, status-aware staff-facing copy.
 *
 * `verb` is the PAST PARTICIPLE ('loaded' / 'saved'), not the infinitive: the
 * previous `${verb}ed` produced "could not be saveed" on every failed save.
 */
function friendlyErrorMessage(error: ExerciseSettingsError, verb: 'loaded' | 'saved'): string {
  switch (error.status) {
    case 400:
      return error.serverMessage
        ? `These settings were not saved: ${error.serverMessage}`
        : 'These settings were rejected and nothing was saved. Check the fields and try again.'
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'Your staff account is not assigned to this exercise.'
    case 404:
      return 'This exercise no longer exists. Pick another exercise and try again.'
    default:
      return error.status === undefined
        ? `Pulse could not be reached, so the settings were not ${verb}. Check your connection and try again.`
        : (error.serverMessage ?? `The settings were not ${verb}. Try again.`)
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
  /** The section on screen. A VIEW switch — the state below is shared by all three. */
  readonly section: ExerciseSettingsSectionId
  readonly onStatusChange?: (status: ExerciseSettingsStatus) => void
  readonly onRequestSection?: (section: ExerciseSettingsSectionId) => void
}

function ExerciseSettingsForm({
  settings,
  section,
  onStatusChange,
  onRequestSection,
}: ExerciseSettingsFormProps) {
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
    const failing = sectionsWithErrors(found)
    const firstFailing = failing[0]
    if (firstFailing !== undefined) {
      // A field in a section that is NOT on screen just blocked the save. Say so
      // where the planner is looking: move them to the first offending section
      // (the nav marks all of them). Silently refusing to save with the reason
      // one click away is the failure this exists to prevent.
      if (!failing.includes(section)) onRequestSection?.(firstFailing)
      return
    }
    // ONE call, ONE complete body — every managed field from every section,
    // every time, whether or not it is currently rendered.
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

  // ---------------------------------------------------------------------
  // Report upward so the page's nav can mark what only this form knows.
  // ---------------------------------------------------------------------
  const dirty = isDirty(values, settings)
  const failingSections = useMemo(() => sectionsWithErrors(errors), [errors])

  useEffect(() => {
    onStatusChange?.({ dirty, sectionsWithErrors: failingSections })
  }, [dirty, failingSections, onStatusChange])

  // If this form goes away (a reload that fails, say), the nav must not keep
  // warning about unsaved changes that no longer have anywhere to live. The ref
  // keeps this effect mount-scoped: re-running it on every status change would
  // emit a spurious clean status between renders.
  const notifyStatus = useRef(onStatusChange)
  useEffect(() => {
    notifyStatus.current = onStatusChange
  }, [onStatusChange])
  useEffect(() => () => notifyStatus.current?.(CLEAN_EXERCISE_SETTINGS_STATUS), [])

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
      {/*
        ONLY THE SELECTED SECTION IS RENDERED. Safe because every value lives in
        `values` (React state), not in these inputs: `toUpdate()` below sends the
        whole body regardless of what is on screen. See the module header.
      */}
      {section === 'identity' ? (
        <>
          <SectionHeading text="Identity" />
          {/*
            Multi-column, so a six-field section fits a desktop work area
            without scrolling a full-replace form. `FieldGrid` decides the
            column count from the pane's width and collapses to one column when
            there is no room — see its module header.
          */}
          <FieldGrid minColumnWidth={270}>
            <CobraTextField
              {...textFieldProps('name', 'The name your planning team uses. Participants never see it.')}
              label="Exercise name"
              required
              value={values.name}
              onChange={event => setField('name', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
            />
            <CobraTextField
              {...textFieldProps(
                'worldName',
                'The place participants think they are in, for example Metro Atlanta. Leave it '
                + 'blank and they see the standard name.',
              )}
              label="World name"
              value={values.worldName}
              onChange={event => setField('worldName', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_WORLD_NAME_LENGTH } }}
            />
            <CobraTextField
              {...textFieldProps(
                'locale',
                'How dates and numbers are written for participants. Use a BCP-47 tag, for '
                + 'example en-US. Blank uses the standard format.',
              )}
              label="Locale"
              value={values.locale}
              onChange={event => setField('locale', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_LOCALE_LENGTH } }}
            />
          </FieldGrid>

          <SectionHeading text="Time and schedule" />
          {/* A slightly narrower floor than identity: these three are short,
              known-format values (an IANA id and two instants), so they read
              fine three-up where a free-text name would not. */}
          <FieldGrid minColumnWidth={240}>
            <CobraTextField
              {...textFieldProps(
                'timeZone',
                'One zone for the whole exercise, for example America/New_York. Participants read '
                + 'every date and time in it, so the wrong zone puts every post hours out.',
              )}
              label="Time zone"
              required
              value={values.timeZone}
              onChange={event => setField('timeZone', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_TIME_ZONE_LENGTH } }}
            />
            <CobraTextField
              {...textFieldProps(
                'scheduledStartAt',
                'Planned StartEx, in UTC. Leave it blank if the date is not fixed yet.',
              )}
              label="Scheduled start (UTC)"
              type="datetime-local"
              value={values.scheduledStartAt}
              onChange={event => setField('scheduledStartAt', event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }}
            />
            <CobraTextField
              {...textFieldProps(
                'scheduledEndAt',
                'Planned EndEx, in UTC. It cannot be earlier than the start.',
              )}
              label="Scheduled end (UTC)"
              type="datetime-local"
              value={values.scheduledEndAt}
              onChange={event => setField('scheduledEndAt', event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 1 } }}
            />
          </FieldGrid>
        </>
      ) : null}

      {section === 'channels' ? (
        <FormControl
          component="fieldset"
          variant="standard"
          disabled={disabled}
          error={Boolean(errors.enabledChannelIds)}
          aria-describedby="exercise-settings-channels-help"
          data-testid="exercise-settings-channels"
          sx={{ mt: 1 }}
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
              'Turn a channel off and participants cannot reach it. Nothing posted to it gets to '
                + 'them.'}
          </FormHelperText>
        </FormControl>
      ) : null}

      {section === 'theming' ? (
        <>
          <SectionHeading text="Theming" />
          {/*
            The brand name keeps the full row (`gridColumn: '1 / -1'`) — it is
            free text and the one field here that benefits from the width — and
            the four colors share the row below it. Ten fields in one column is
            what made this the worst-scrolling section of the five.
          */}
          <FieldGrid minColumnWidth={190}>
            <CobraTextField
              {...textFieldProps(
                'brandName',
                'The brand participants see across every channel. Leave it blank to use the '
                + 'standard brand.',
              )}
              label="Brand name"
              value={values.brandName}
              onChange={event => setField('brandName', event.target.value)}
              slotProps={{ htmlInput: { maxLength: MAX_BRAND_NAME_LENGTH } }}
              sx={{ gridColumn: '1 / -1' }}
            />
            <CobraTextField
              {...textFieldProps(
                'brandPrimary',
                'Main brand color. Hex, for example #2b5f75. Blank uses the standard color.',
              )}
              label="Primary color"
              value={values.brandPrimary}
              onChange={event => setField('brandPrimary', event.target.value)}
            />
            <CobraTextField
              {...textFieldProps(
                'brandAccent',
                'Buttons and links. Hex, for example #c05621. Blank uses the standard color.',
              )}
              label="Accent color"
              value={values.brandAccent}
              onChange={event => setField('brandAccent', event.target.value)}
            />
            <CobraTextField
              {...textFieldProps(
                'brandSurface',
                'Page background. Hex, for example #f7f7f5. Blank uses the standard color.',
              )}
              label="Surface color"
              value={values.brandSurface}
              onChange={event => setField('brandSurface', event.target.value)}
            />
            <CobraTextField
              {...textFieldProps(
                'brandOnSurface',
                'Text on that background. Hex, for example #1c1c1c. Blank uses the standard color.',
              )}
              label="On-surface color"
              value={values.brandOnSurface}
              onChange={event => setField('brandOnSurface', event.target.value)}
            />
          </FieldGrid>

          <SectionHeading text="Outlet names" />
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            What participants see each outlet called. Leave one blank to use its standard name.
          </Typography>
          {/* No helper text and short labels, so these tolerate the narrowest
              floor of the three grids — five outlets land in two rows. */}
          <FieldGrid minColumnWidth={220}>
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
              // Spans the row: a validation message that shared a row with a
              // field would read as belonging to that one field.
              <Box sx={{ gridColumn: '1 / -1' }}>
                <SettingsAlert message={errors.outletNames} testId="exercise-settings-outlet-error" />
              </Box>
            ) : null}
          </FieldGrid>
        </>
      ) : null}

      {/*
        THE SHARED FOOTER. Rendered in ALL THREE sections, because there is only
        one form: whichever section a planner is looking at, Save sends the whole
        body and Revert restores the whole body. `PanelSaveBar` PINS it to the
        bottom of the scrolling content pane, so the one commit point for all
        three sections can never scroll out of reach (see its module header).
      */}
      <PanelSaveBar>
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

        {/* Pinned WITH the buttons: an alert that says nothing was sent is of
            no use scrolled off below the button that refused to send. */}
        {hasClientErrors ? (
          <SettingsAlert
            message={
              'Nothing was saved. Fix the marked fields, then save again. Sections to check: '
              + `${failingSections.map(id => EXERCISE_SETTINGS_SECTION_META[id].label).join(', ')}.`
            }
            testId="exercise-settings-client-error"
          />
        ) : null}

        {save.isError ? (
          <SettingsAlert
            message={friendlyErrorMessage(save.error, 'saved')}
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
              Settings saved. All three sections now show the stored values.
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

interface ExerciseSettingsPanelProps {
  /**
   * Which of the three settings sections to show. A VIEW switch over one shared
   * form — mount ONE panel and change this prop; never mount one panel per
   * section (see the module header).
   */
  readonly section: ExerciseSettingsSectionId
  /** Reports dirty state + which sections hold validation errors, for the page's nav. */
  readonly onStatusChange?: (status: ExerciseSettingsStatus) => void
  /** Asks the page to show a section — used when a blocked save's errors are all off-screen. */
  readonly onRequestSection?: (section: ExerciseSettingsSectionId) => void
}

/**
 * The per-exercise settings panel. Self-contained COBRA staff surface: it loads
 * the resolved exercise's COR-030 settings, renders ONE section of them for
 * editing, and full-replaces ALL of them on save. Mounted once by
 * `ExerciseSettingsPage`, which drives `section` from its left nav.
 */
export function ExerciseSettingsPanel({
  section,
  onStatusChange,
  onRequestSection,
}: ExerciseSettingsPanelProps) {
  const settingsQuery = useExerciseSettings()
  const meta = EXERCISE_SETTINGS_SECTION_META[section]

  return (
    <Box
      component="section"
      aria-labelledby="exercise-settings-heading"
      data-testid="exercise-settings-panel"
      sx={{
        // NO top/side padding: the page already insets the content pane by
        // `CobraStyles.Padding.MainWindow`, and a second copy of it here cost
        // 18px of the height this section has to fit in and 36px of the width
        // its field grids get to divide into columns. The bottom padding stays
        // — it is the breathing room under the pinned save bar, which is sized
        // to swallow exactly this much (see `PanelSaveBar`).
        paddingBottom: CobraStyles.Padding.MainWindow,
        maxWidth: 860,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={meta.icon} aria-hidden />
        <Typography id="exercise-settings-heading" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {meta.label}
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        {meta.description}
      </Typography>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Identity &amp; schedule, Channels and Theming &amp; outlets share one Save. Saving writes
        all three, including the fields you never opened, so check them before you save. A field
        left blank is not stored: participants get the standard value for it.
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
          message={friendlyErrorMessage(settingsQuery.error, 'loaded')}
          testId="exercise-settings-load-error"
        />
      ) : null}

      {settingsQuery.isSuccess ? (
        <ExerciseSettingsForm
          settings={settingsQuery.data}
          section={section}
          onStatusChange={onStatusChange}
          onRequestSection={onRequestSection}
        />
      ) : null}
    </Box>
  )
}
