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
// it is a composition point, so wave 3 adds `ComplianceChromePanel` (story 02) and
// `PracticeModePanel` (story 04) exports alongside these.
export { ExerciseSettingsPage } from './pages/ExerciseSettingsPage'
export { ExerciseSettingsPanel } from './components/ExerciseSettingsPanel'
export { useExerciseSettings } from './hooks/useExerciseSettings'
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
