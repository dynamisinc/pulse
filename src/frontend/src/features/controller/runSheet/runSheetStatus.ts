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
import type { BeatRuntime } from './runSheetModel'
import { runSheetTokens } from './runSheetTokens'

/** What a status chip shows. */
export interface StatusChipSpec {
  readonly label: string
  readonly icon: IconDefinition
  readonly spin?: boolean
  /** Decorative text colour (the label and icon carry the meaning). */
  readonly color: string
}

/** How long a fire may sit in flight before the row says the server has not answered. */
export const SLOW_FIRE_NOTICE_MS = 20_000

/**
 * Shown on a beat that has been "Firing" for {@link SLOW_FIRE_NOTICE_MS}. There is no
 * auto-retry (a retry could double-post): the controller is told what a reload will do.
 */
export const SLOW_FIRE_NOTICE =
  'No answer yet. If this persists, reload — the beat will show as Unconfirmed.'

/** The chip for a beat's runtime record. Exported for the panel's counts and the tests. */
export function statusChipFor(record: BeatRuntime): StatusChipSpec {
  if (record.inFlight === true) {
    return { label: 'Firing', icon: faSpinner, spin: true, color: runSheetTokens.navy }
  }
  switch (record.status) {
    case 'fired':
      return { label: 'Fired', icon: faCircleCheck, color: runSheetTokens.firedText }
    case 'skipped':
      return {
        label: 'Skipped',
        icon: faForwardStep,
        // 8.27:1 on white, 7.41:1 on the selected row (COBRA's #848482 was 3.75 / 3.36).
        color: runSheetTokens.mutedText,
      }
    case 'failed':
      return record.failure?.kind === 'unconfirmed'
        ? { label: 'Unconfirmed', icon: faCircleQuestion, color: runSheetTokens.unconfirmedText }
        : { label: 'Failed', icon: faTriangleExclamation, color: runSheetTokens.failedText }
    case 'pending':
    default:
      return { label: 'Pending', icon: faClock, color: runSheetTokens.navy }
  }
}
