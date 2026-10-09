/**
 * features/controller/runSheet/RunSheetButtons.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's dense action buttons — thin wrappers over the COBRA buttons
 * (`CobraPrimaryButton`, `CobraSecondaryButton`, `CobraDeleteButton`,
 * `@/theme/styledComponents`) so every row action is a real COBRA control, never
 * a raw MUI `Button`. STAFF world only.
 *
 * WHY WRAP. The COBRA buttons are sized for forms (20 px side padding, pill
 * radius) and the secondary/link variants are cobalt-on-transparent, which has no
 * contrast against the dark console chrome. The wrappers shrink the padding for a
 * dense row and recolour the SECONDARY variant from the shared `consoleChrome`
 * tokens; the PRIMARY (cobalt fill, white text) and DELETE (red fill) variants keep
 * their COBRA colours. No new hex values.
 *
 * ACCESSIBILITY (NFR-001). Every button is icon + visible text and carries an
 * explicit accessible name that STARTS with its visible label ("Fire Boil-water
 * advisory") so the name contains the label (WCAG 2.5.3). `title` mirrors the
 * reason a button is disabled (e.g. "World frozen") and `describedBy` points at the
 * visible reason text, so a disabled control is never unexplained.
 */

import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faCheck } from '@fortawesome/free-solid-svg-icons'
import {
  CobraDeleteButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import { consoleChrome as chrome } from '../consoleChrome'

export type RunSheetButtonKind = 'primary' | 'secondary' | 'danger'

export interface RunSheetButtonProps {
  /** Visible text. */
  readonly label: string
  /** Accessible name; defaults to `label`. Should start with `label`. */
  readonly ariaLabel?: string
  /** Optional: a toggle needs none (it shows a check while pressed). */
  readonly icon?: IconDefinition
  readonly onClick: () => void
  readonly kind?: RunSheetButtonKind
  readonly disabled?: boolean
  /** Tooltip; set to the disabled reason when `disabled`. */
  readonly title?: string
  /** Id of the element that explains why the button is disabled. */
  readonly describedBy?: string
  readonly testId?: string
  readonly type?: 'button' | 'submit'
  /** A toggle button's state (`aria-pressed`); a pressed toggle also shows a check icon. */
  readonly pressed?: boolean
  readonly children?: ReactNode
}

const dense = {
  px: 1.25,
  py: 0.25,
  minWidth: 0,
  fontSize: 12,
  lineHeight: 1.7,
  fontWeight: 600,
} as const

const secondaryOnDark = {
  ...dense,
  color: chrome.ink,
  borderColor: chrome.line,
  '&:hover': { borderColor: chrome.blue, background: 'transparent' },
  '&.Mui-disabled': { color: chrome.inkFaint, borderColor: chrome.cardBorder },
} as const

/** A pressed toggle: the console's accent fill with dark text (contrast), plus the check icon. */
const pressedOnDark = {
  color: chrome.bg,
  background: chrome.blue,
  borderColor: chrome.blue,
  '&:hover': { borderColor: chrome.blue, background: chrome.blue },
} as const

function iconFor(icon: IconDefinition | undefined, pressed: boolean | undefined) {
  const shown = pressed ? faCheck : icon
  return shown ? <FontAwesomeIcon icon={shown} aria-hidden="true" /> : undefined
}

export function RunSheetButton({
  label,
  ariaLabel,
  icon,
  onClick,
  kind = 'secondary',
  disabled,
  title,
  describedBy,
  testId,
  type = 'button',
  pressed,
}: RunSheetButtonProps) {
  const common = {
    type,
    size: 'small' as const,
    disabled,
    title,
    onClick,
    'aria-label': ariaLabel ?? label,
    'aria-describedby': describedBy,
    'data-testid': testId,
    'aria-pressed': pressed,
    // A pressed toggle swaps its icon for a check: state is never colour alone (NFR-001).
    startIcon: iconFor(icon, pressed),
  }

  if (kind === 'primary') {
    return <CobraPrimaryButton {...common} sx={dense}>{label}</CobraPrimaryButton>
  }
  if (kind === 'danger') {
    return <CobraDeleteButton {...common} sx={dense}>{label}</CobraDeleteButton>
  }
  return (
    <CobraSecondaryButton
      {...common}
      sx={pressed ? { ...secondaryOnDark, ...pressedOnDark } : secondaryOnDark}
    >
      {label}
    </CobraSecondaryButton>
  )
}

export interface RunSheetIconButtonProps {
  /** Accessible name — there is no visible text, so it must say what the button does. */
  readonly ariaLabel: string
  readonly icon: IconDefinition
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly testId?: string
}

/** An icon-only secondary button (move up/down, remove, close). Always named. */
export function RunSheetIconButton({
  ariaLabel,
  icon,
  onClick,
  disabled,
  testId,
}: RunSheetIconButtonProps) {
  return (
    <CobraSecondaryButton
      type="button"
      size="small"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid={testId}
      sx={{ ...secondaryOnDark, px: 0.75 }}
    >
      <FontAwesomeIcon icon={icon} aria-hidden="true" />
    </CobraSecondaryButton>
  )
}
