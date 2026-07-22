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
