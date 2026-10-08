/**
 * features/controller/runSheet/runSheetStatus.ts
 * ---------------------------------------------------------------------------
 * The run sheet's STATUS CHIP vocabulary (demo-polish C3, story 19; NFR-001). STAFF
 * world. One place decides what each beat state is called and which icon goes with it, so
 * the row, the tests and any future surface agree.
 *
 * STATUS IS TEXT + ICON, NEVER COLOUR ALONE. The label ("Pending", "Fired", "Skipped",
 * "Failed", "Unconfirmed", "Firing") always renders beside its icon; the colour is only
 * reinforcement. "Unconfirmed" is a `failed` beat whose outcome is unknown (the post may be
 * live - see `runSheetModel.ts`); it has its own label and icon so it can never be mistaken
 * for a clean failure that is safe to retry.
 */

import {
  faCircleCheck,
  faCircleQuestion,
  faClock,
  faForwardStep,
  faSpinner,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import type { BeatRuntime } from './runSheetModel'

/** What a status chip shows. */
export interface StatusChipSpec {
  readonly label: string
  readonly icon: IconDefinition
  readonly spin?: boolean
  /** Decorative text colour (the label and icon carry the meaning). */
  readonly color: string
}

// Dark enough for 4.5:1 on white (the console's Cadence red is only ~4.2:1 for small text).
export const COLOR_FAILED = '#a8160d'
export const COLOR_UNCONFIRMED = '#8a5a00'
export const COLOR_FIRED = '#1b6e3c'

/** The chip for a beat's runtime record. Exported for the panel's counts and the tests. */
export function statusChipFor(record: BeatRuntime): StatusChipSpec {
  if (record.inFlight === true) {
    return { label: 'Firing', icon: faSpinner, spin: true, color: staffShellTokens.header.background }
  }
  switch (record.status) {
    case 'fired':
      return { label: 'Fired', icon: faCircleCheck, color: COLOR_FIRED }
    case 'skipped':
      return {
        label: 'Skipped',
        icon: faForwardStep,
        color: staffShellTokens.accent.secondaryText,
      }
    case 'failed':
      return record.failure?.kind === 'unconfirmed'
        ? { label: 'Unconfirmed', icon: faCircleQuestion, color: COLOR_UNCONFIRMED }
        : { label: 'Failed', icon: faTriangleExclamation, color: COLOR_FAILED }
    case 'pending':
    default:
      return { label: 'Pending', icon: faClock, color: staffShellTokens.header.background }
  }
}
