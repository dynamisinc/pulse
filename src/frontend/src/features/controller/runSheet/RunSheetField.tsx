/**
 * features/controller/runSheet/RunSheetField.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's one text/select field: `CobraTextField` (the COBRA staff-world
 * input — never a raw MUI `TextField`) with the small adjustments the DARK
 * operator chrome needs, so every form field in the editor reads the same.
 * STAFF world only.
 *
 * WHY A WRAPPER. `CobraTextField` gives its input a white (`background.paper`)
 * surface, which is right on a COBRA light page but leaves a floating label
 * unreadable when it sits over that white fill inside the dark console. This
 * wrapper:
 *   - ALWAYS floats the label (`shrink`), so the label lives on the dark panel
 *     (light `consoleChrome` ink on dark) and never overlays the white input;
 *   - recolours label / helper text from the shared `consoleChrome` tokens (no new
 *     hex values);
 *   - shows an error as TEXT with an icon next to the field's own red outline —
 *     never colour alone (NFR-001) — and keeps an always-on `hint` (e.g. the
 *     "12/280" counter) beside it;
 *   - takes `value` + `onChange(value)` as plain strings, so callers never touch a
 *     DOM event, and `select` renders a NATIVE `<select>` (accessible, keyboard
 *     native, and trivially driven by tests).
 */

import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraTextField } from '@/theme/styledComponents'
import { consoleChrome as chrome } from '../consoleChrome'

export interface RunSheetFieldProps {
  /** Required: ties the label to the input and the helper text to `aria-describedby`. */
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** Called on Enter in a single-line field (keyboard-first "add"). */
  readonly onEnter?: () => void
  /** A validation message — rendered as text with an icon, and sets the field's error state. */
  readonly error?: string
  /** Always-on helper text (e.g. a character counter), shown beside any error. */
  readonly hint?: ReactNode
  readonly multiline?: boolean
  /** Fixed visible rows for a multiline field (no autosize: cheap to mount in a 20-post burst). */
  readonly rows?: number
  /** Native `<select>`; pass `<option>` children. */
  readonly select?: boolean
  readonly type?: 'text' | 'number'
  readonly disabled?: boolean
  readonly required?: boolean
  /** Extra attributes on the underlying input (`data-testid`, `inputMode`, `min`, ...). */
  readonly inputProps?: Readonly<Record<string, string | number | boolean | undefined>>
  readonly sx?: SxProps<Theme>
  readonly children?: ReactNode
}

export function RunSheetField({
  id,
  label,
  value,
  onChange,
  onEnter,
  error,
  hint,
  multiline,
  rows,
  select,
  type = 'text',
  disabled,
  required,
  inputProps,
  sx,
  children,
}: RunSheetFieldProps) {
  const helper =
    error || hint ? (
      <Box
        component="span"
        sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
      >
        {error ? (
          <Box component="span" sx={{ color: chrome.amber }}>
            <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />{' '}
            <span data-testid={`${id}-error`}>{error}</span>
          </Box>
        ) : (
          <span />
        )}
        {hint ? <Box component="span" sx={{ flexShrink: 0, color: chrome.inkMuted }}>{hint}</Box> : null}
      </Box>
    ) : undefined

  return (
    <CobraTextField
      id={id}
      label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (onEnter && event.key === 'Enter' && !multiline) {
          event.preventDefault()
          onEnter()
        }
      }}
      error={Boolean(error)}
      helperText={helper}
      multiline={multiline}
      rows={rows}
      select={select}
      type={select ? undefined : type}
      disabled={disabled}
      required={required}
      fullWidth
      size="small"
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: inputProps,
        ...(select ? { select: { native: true } } : {}),
      }}
      sx={[
        {
          '& .MuiInputLabel-root': { color: chrome.inkMuted },
          '& label.Mui-focused': { color: chrome.blue },
          '& label.Mui-error': { color: chrome.amber },
          '& .MuiFormHelperText-root': { color: chrome.inkMuted, mx: 0 },
          '& .MuiInputBase-root.Mui-disabled': { opacity: 0.75 },
        },
        ...(sx === undefined ? [] : Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </CobraTextField>
  )
}
