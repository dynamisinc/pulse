/**
 * features/planner/exerciseSettingsSections.ts
 * ---------------------------------------------------------------------------
 * The section vocabulary shared by `ExerciseSettingsPage` (which renders the
 * left nav) and `ExerciseSettingsPanel` (which renders one section at a time).
 * Feature: exercise-configuration, story 01b; #41.
 *
 * WHY A MODULE OF ITS OWN. Two reasons, one mechanical and one real:
 *  - mechanical: exporting constants from a component file breaks Fast Refresh
 *    (`react-refresh/only-export-components`);
 *  - real: the nav item a planner CLICKS and the `h2` they LAND ON must be the
 *    same string. One table, imported by both, makes drift impossible rather
 *    than merely unlikely.
 *
 * IT HOLDS NO STATE AND NO BEHAVIOUR — labels, icons, copy and the nav order.
 * The form state lives in `ExerciseSettingsPanel`; which section is selected
 * lives in `ExerciseSettingsPage`.
 *
 * THE ONE THING TO REMEMBER. These three sections are VIEWS OVER ONE FORM, not
 * three forms: `PUT /api/staff/exercise-settings` is a FULL REPLACE, so a save
 * from any of them submits the fields of all three. Adding a section here means
 * adding a view over that same form — a genuinely separate concern belongs in
 * its own self-contained panel with its own endpoint (see the page's `SECTIONS`
 * registry).
 *
 * TWO WORLDS — STAFF (D0 §2): this is planner console vocabulary; nothing here
 * is participant-visible.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faIdCard, faPalette, faTowerBroadcast } from '@fortawesome/free-solid-svg-icons'

/** Which slice of the one settings form is on screen. */
export type ExerciseSettingsSectionId = 'identity' | 'channels' | 'theming'

/**
 * The sections in nav order. Also the order a blocked save walks to find the
 * FIRST section that needs attention.
 */
export const EXERCISE_SETTINGS_SECTION_ORDER: readonly ExerciseSettingsSectionId[] = [
  'identity',
  'channels',
  'theming',
]

interface ExerciseSettingsSectionMeta {
  /** The nav item's label AND the panel's `h2` — deliberately the same string. */
  readonly label: string
  readonly icon: IconDefinition
  /** What the section says about itself, under its heading. */
  readonly description: string
}

/** Label, icon and blurb per section. */
export const EXERCISE_SETTINGS_SECTION_META: Readonly<
  Record<ExerciseSettingsSectionId, ExerciseSettingsSectionMeta>
> = {
  identity: {
    label: 'Identity & schedule',
    icon: faIdCard,
    description:
      'What this exercise is called — internally and in-fiction — and the single time zone and '
      + 'scheduled window every participant timestamp is rendered against.',
  },
  channels: {
    label: 'Channels',
    icon: faTowerBroadcast,
    description:
      'Which channels this exercise serves. A disabled channel is catalogued but never reaches '
      + 'participants.',
  },
  theming: {
    label: 'Theming & outlets',
    icon: faPalette,
    description:
      'The brand the participant world is skinned from, and the display name each outlet carries.',
  },
}

/**
 * What the settings form reports up to the page so the section nav can show what
 * only the form knows. The page holds it; the form owns it.
 */
export interface ExerciseSettingsStatus {
  /** True when saving now would send something different from what the server holds. */
  readonly dirty: boolean
  /** Sections holding a client-side validation error, in nav order. */
  readonly sectionsWithErrors: readonly ExerciseSettingsSectionId[]
}

/** Nothing pending, nothing wrong — the status while no form is mounted. */
export const CLEAN_EXERCISE_SETTINGS_STATUS: ExerciseSettingsStatus = {
  dirty: false,
  sectionsWithErrors: [],
}
