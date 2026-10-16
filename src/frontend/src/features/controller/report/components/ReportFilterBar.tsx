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
 * Filters change only the post record; the summary and charts never change with them.
 */

import { useId, useState, type KeyboardEvent } from 'react'
import { Box, Checkbox, FormControlLabel, FormGroup, FormLabel } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import { SOURCE_LABELS, SOURCE_ORDER, orderedSources, parseTimeField } from '../services/reportFilters'
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
}

type TimeField = 'from' | 'to'

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
}: ReportFilterBarProps) {
  const [draft, setDraft] = useState<Record<TimeField, string>>({
    from: filters.from ?? '',
    to: filters.to ?? '',
  })
  const [errors, setErrors] = useState<Record<TimeField, string | null>>({ from: null, to: null })

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
    const mine = parseTimeField(draft[field], windowStart, null)
    const theirs = parseTimeField(draft[other], windowStart, null)
    const mineValue = mine.ok ? mine.value : null
    const theirValue = theirs.ok ? theirs.value : null
    const [low, high] = field === 'from' ? [mineValue, theirValue] : [theirValue, mineValue]
    const inverted = mine.ok && theirs.ok && low !== null && high !== null && low > high

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
    setDraft({ from: '', to: '' })
    setErrors({ from: null, to: null })
    if (filters.from !== null || filters.to !== null) onChange({ ...filters, from: null, to: null })
  }

  const hint = 'yyyy-MM-dd HH:mm'
  const timeField = (field: TimeField, label: string) => (
    <CobraTextField
      size="small"
      label={label}
      value={draft[field]}
      onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
      onBlur={() => commit(field)}
      onKeyDown={event => onKeyDown(field, event)}
      error={errors[field] !== null}
      helperText={errors[field] ?? hint}
      placeholder={windowStart ?? hint}
      slotProps={{ htmlInput: { autoComplete: 'off' } }}
      sx={{ width: 190 }}
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
