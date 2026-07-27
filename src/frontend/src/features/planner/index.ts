/**
 * features/planner/index.ts
 * ---------------------------------------------------------------------------
 * Public surface of the STAFF-world planner feature (feature:
 * identity-auth-roles, story 02 — named participant accounts; COR-011).
 *
 * The later app-shell/planner story imports `AccountImport` from here to mount
 * the panel into a route; this feature owns the component + its hook + its
 * service, never the route table (`App.tsx`).
 */

export { AccountImport } from './components/AccountImport'
export { useAccountImport } from './hooks/useAccountImport'

// E1 exercise-configuration, story 01b — the per-exercise settings editor (COR-030).
// `ExerciseSettingsPage` is the surface App.tsx mounts as the PLANNER staff surface;
// it is a composition point (a left section nav + content pane), and wave 3's two
// panels are sections of it (see below) as well as exported here.
// `ExerciseSettingsPanel` takes a `section` prop: its three sections are VIEWS over
// ONE form with ONE save, because the settings `PUT` is a FULL REPLACE. Mount it
// ONCE and change the prop — never one panel per section.
export { ExerciseSettingsPage } from './pages/ExerciseSettingsPage'
export { ExerciseSettingsPanel } from './components/ExerciseSettingsPanel'
export {
  EXERCISE_SETTINGS_SECTION_META,
  EXERCISE_SETTINGS_SECTION_ORDER,
} from './exerciseSettingsSections'
export type {
  ExerciseSettingsSectionId,
  ExerciseSettingsStatus,
} from './exerciseSettingsSections'
export { useExerciseSettings } from './hooks/useExerciseSettings'

// E1 exercise-configuration, story 02 — the COR-031 compliance-chrome panel + the
// NFR-008 chrome/watermark guard. Mounted into `ExerciseSettingsPage`; the panel is
// self-contained and takes no props.
export { ComplianceChromePanel } from './components/ComplianceChromePanel'
export { useChromeSettings, useSaveChromeSettings } from './hooks/useChromeSettings'

// E1 exercise-configuration, story 04 — the COR-033 practice/sandbox flag panel.
// Mounted into `ExerciseSettingsPage`; self-contained, no props. STAFF-WORLD ONLY:
// practice state is never projected onto a participant surface (XC-002).
export { PracticeModePanel } from './components/PracticeModePanel'
export { usePracticeMode, useSetPracticeMode } from './hooks/usePracticeMode'
export {
  AccountImportError,
  IMPORT_FILE_ACCEPT,
  MAX_IMPORT_FILE_BYTES,
} from './services/accountImportService'
export type {
  AccountImportResult,
  AccountImportRowResult,
  AccountImportRowStatus,
} from './types'
