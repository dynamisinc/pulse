/**
 * features/controller/report/components/ReportFilterBar.tsx
 * ---------------------------------------------------------------------------
 * The post-record filters of the printable report (demo-feedback story 30, DF-44). STAFF world,
 * screen only (it lives inside the page's toolbar, which `report.module.css` hides in print).
 *
 *  - SOURCES: four labelled checkboxes (Participant, Scripted inject, Engine, Background noise).
 *    At least one must stay checked: the last checked box is disabled, so an empty selection can
 *    never be asked for. Changing one applies at once.
 *  - WINDOW: From / To scenario-time text fields, "yyyy-MM-dd HH:mm", exercise zone, typed as
 *    written (no zone conversion anywhere). A value is validated and APPLIED on blur or Enter,
 *    never per keystroke, so typing does not refetch. An invalid or out-of-window value shows an
 *    inline message and leaves the applied filters (and so the query) untouched. Clear empties
 *    both. A server 400 reason (`serverError`) is shown here, beside the filters it is about.
 *
 * Story 31 (DF-45): the window now scopes the WHOLE report, not just the record. The sources
 * still change only the record (DF-44). "Latest scenario day" fills From/To with 00:00-23:59 of
 * the latest post's scenario date (`latestDay`, from the server) and applies at once; it is
 * disabled while the exercise has no posts (`latestDay` null).
 *
 * PICKERS (Tom, 10/17): From/To are native `datetime-local` inputs (the browser's date and time
 * picker; typing still works), holding exercise-zone wall times with no zone conversion. Until
 * To is touched it SHOWS "now" (`scenarioNow`: the live scenario clock, else the latest post)
 * but stays an OPEN end, so a live exercise's later posts are never cut off. A half-typed
 * value (the browser reports `badInput`) is refused inline instead of reading as "no bound".
 */

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Checkbox, FormControlLabel, FormGroup, FormLabel } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay, faCircleExclamation, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import {
  SOURCE_LABELS,
  SOURCE_ORDER,
  earliestStamp,
  fromInputValue,
  orderedSources,
  parseTimeField,
  toInputValue,
} from '../services/reportFilters'
import type { ReportFilters, ReportSourceKey } from '../types/report'

export interface ReportFilterBarProps {
  readonly filters: ReportFilters
  readonly onChange: (next: ReportFilters) => void
  /**
   * The exercise start; earlier times are rejected. Null until the first report arrives. There is
   * no upper bound: a live exercise keeps adding posts after the snapshot's `scenarioEnd`.
   */
  readonly windowStart: string | null
  /** The server's readable reason for a 400, or null. */
  readonly serverError: string | null
  /** Story 31: the latest post's scenario day (00:00 to 23:59, "yyyy-MM-dd HH:mm"), or null. */
  readonly latestDay?: { readonly from: string; readonly to: string } | null
  /** Scenario "now" ("yyyy-MM-dd HH:mm"): what an untouched To shows. Null when unknown. */
  readonly scenarioNow?: string | null
}

type TimeField = 'from' | 'to'

const HALF_TYPED = 'Enter a full date and time.'

/** The latest value the pickers accept: it caps the year at 4 digits. */
const PICKER_MAX = '9999-12-31T23:59'

/** Screen-reader-only text (the standard clip pattern). */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

export function ReportFilterBar({
  filters,
  onChange,
  windowStart,
  serverError,
  latestDay = null,
  scenarioNow = null,
}: ReportFilterBarProps) {
  const [draft, setDraft] = useState<Record<TimeField, string>>({
    from: filters.from ?? '',
    to: filters.to ?? '',
  })
  const [errors, setErrors] = useState<Record<TimeField, string | null>>({ from: null, to: null })
  // Until To is touched it shows "now" but is not a bound (an open end).
  const [toTouched, setToTouched] = useState(filters.to !== null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)
  const inputOf = (field: TimeField) => (field === 'from' ? fromInput : toInput)
  /** The text a field stands for: an untouched To is empty (open), whatever it shows. */
  const valueOf = (field: TimeField) => (field === 'to' && !toTouched ? '' : draft[field])
  const showsNow = (field: TimeField) => field === 'to' && !toTouched && scenarioNow !== null
  /** The browser holds a half-typed date or time (its value then reads as empty). */
  const halfTyped = (field: TimeField) => inputOf(field).current?.validity.badInput === true

  const selected = orderedSources(filters.sources)
  const lastId = useId()

  function toggleSource(key: ReportSourceKey, checked: boolean) {
    const next = checked ? [...selected, key] : selected.filter(item => item !== key)
    if (next.length === 0) return
    onChange({ ...filters, sources: orderedSources(next) })
  }

  /**
   * Validates the committed field, then re-validates the OTHER field's draft against it, so a
   * stale "From must not be after To." clears once To moves later. Each valid, changed value is
   * applied together (one refetch); nothing is applied while the pair is inverted.
   */
  function commit(field: TimeField) {
    const other: TimeField = field === 'from' ? 'to' : 'from'
    if (halfTyped(field)) {
      setErrors(current => ({ ...current, [field]: HALF_TYPED }))
      return
    }
    const mine = parseTimeField(valueOf(field), windowStart, null)
    const theirs = halfTyped(other)
      ? ({ ok: false, message: HALF_TYPED } as const)
      : parseTimeField(valueOf(other), windowStart, null)
    const mineValue = mine.ok ? mine.value : null
    // An invalid other draft is not what gets sent: its APPLIED value is, so check against that.
    const theirValue = theirs.ok ? theirs.value : filters[other]
    // An untouched To SHOWS "now": From may not pass it either (it bounds this check, never the
    // query), so the fields never display an inverted window.
    const checkedTo = field === 'from' && theirValue === null && showsNow('to') ? scenarioNow : theirValue
    const [low, high] = field === 'from' ? [mineValue, checkedTo] : [theirValue, mineValue]
    const inverted = mine.ok && low !== null && high !== null && low > high

    setErrors(current => ({
      ...current,
      [field]: !mine.ok ? mine.message : inverted ? 'From must not be after To.' : null,
      // The other field keeps its own format error; a stale inversion error clears.
      [other]: !theirs.ok ? current[other] : null,
    }))
    if (!mine.ok || inverted) return

    const next = { ...filters, [field]: mineValue }
    if (theirs.ok) next[other] = theirValue
    if (next.from !== filters.from || next.to !== filters.to) onChange(next)
  }

  function onKeyDown(field: TimeField, event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(field)
    }
  }

  function clearWindow() {
    // A half-typed value lives only in the browser (its value already reads ''), so React would
    // leave it on screen: wipe the inputs themselves.
    for (const input of [fromInput.current, toInput.current]) if (input !== null) input.value = ''
    setDraft({ from: '', to: '' })
    setToTouched(false)
    setErrors({ from: null, to: null })
    if (filters.from !== null || filters.to !== null) onChange({ ...filters, from: null, to: null })
  }

  /** Story 31: one click to the latest scenario day; applied together (one refetch). */
  function applyLatestDay() {
    if (latestDay === null) return
    setDraft({ from: latestDay.from, to: latestDay.to })
    setToTouched(true)
    setErrors({ from: null, to: null })
    if (latestDay.from !== filters.from || latestDay.to !== filters.to) {
      onChange({ ...filters, from: latestDay.from, to: latestDay.to })
    }
  }

  const earliest = earliestStamp(windowStart)
  const shown = (field: TimeField) =>
    showsNow(field) && scenarioNow !== null ? scenarioNow : draft[field]
  const hint = (field: TimeField) =>
    showsNow(field) ? 'Defaults to now' : 'Scenario time, exercise zone'
  const timeField = (field: TimeField, label: string) => (
    <CobraTextField
      size="small"
      type="datetime-local"
      label={label}
      value={toInputValue(shown(field))}
      inputRef={inputOf(field)}
      onChange={event => {
        if (field === 'to') setToTouched(true)
        const value = fromInputValue(event.target.value)
        setDraft(current => ({ ...current, [field]: value }))
      }}
      onBlur={() => commit(field)}
      onKeyDown={event => onKeyDown(field, event)}
      error={errors[field] !== null}
      helperText={errors[field] ?? hint(field)}
      slotProps={{
        // A datetime-local input always shows its own mask, so the label stays shrunk.
        inputLabel: { shrink: true },
        htmlInput: {
          autoComplete: 'off',
          step: 60,
          // A 4-digit year cap: without it Chrome's year segment takes 6 digits, so typing
          // "2026" never moves on to the hour (Tom, UAT 10/19).
          max: PICKER_MAX,
          ...(earliest === null ? {} : { min: toInputValue(earliest) }),
        },
      }}
      sx={{ width: 230 }}
    />
  )

  return (
    <Box
      role="group"
      aria-label="Post record filters"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 24px',
        alignItems: 'flex-start',
        width: '100%',
      }}
    >
      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <FormLabel component="legend" sx={{ fontSize: 12 }}>Post record sources</FormLabel>
        <FormGroup row>
          {SOURCE_ORDER.map(key => {
            const checked = selected.includes(key)
            const lastOne = checked && selected.length === 1
            return (
              <FormControlLabel
                key={key}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    disabled={lastOne}
                    onChange={event => toggleSource(key, event.target.checked)}
                    slotProps={{
                      input: lastOne ? { 'aria-describedby': lastId } : {},
                    }}
                    // COBRA's primary is silver, which reads as disabled when checked; use the
                    // button blue so a checked source is unmistakable.
                    sx={{ '&.Mui-checked': { color: 'buttonPrimary.main' } }}
                  />
                }
                label={SOURCE_LABELS[key]}
                sx={{ mr: 1.5 }}
              />
            )
          })}
        </FormGroup>
        {selected.length === 1 && (
          <Box id={lastId} sx={VISUALLY_HIDDEN}>At least one source is required.</Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
        {timeField('from', 'From (scenario time)')}
        {timeField('to', 'To (scenario time)')}
        <CobraSecondaryButton
          size="small"
          onClick={applyLatestDay}
          disabled={latestDay === null}
          onMouseDown={event => event.preventDefault()}
          startIcon={<FontAwesomeIcon icon={faCalendarDay} aria-hidden="true" />}
          sx={{ mt: '3px' }}
        >
          Latest scenario day
        </CobraSecondaryButton>
        <CobraSecondaryButton
          size="small"
          onClick={clearWindow}
          // Without this the fields blur first and a second commit refetches alongside Clear.
          onMouseDown={event => event.preventDefault()}
          startIcon={<FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />}
          sx={{ mt: '3px' }}
        >
          Clear
        </CobraSecondaryButton>
      </Box>

      {serverError !== null && (
        <Box
          role="alert"
          data-testid="filter-server-error"
          sx={{ width: '100%', fontSize: 13, display: 'flex', gap: 0.75, alignItems: 'center' }}
        >
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
          {serverError}
        </Box>
      )}
    </Box>
  )
}
