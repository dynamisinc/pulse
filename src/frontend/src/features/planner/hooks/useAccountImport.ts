/**
 * features/planner/hooks/useAccountImport.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutation wrapper around the bulk account-import seam (feature:
 * identity-auth-roles, story 02; COR-011).
 *
 * A mutation (not a query) because an import is an explicit, planner-triggered
 * write that must NOT auto-fire, refetch, or dedupe. It carries the pending /
 * success / error state the COBRA panel renders against, and surfaces the
 * typed `AccountImportError` the service throws so the panel can give
 * status-aware feedback (401 vs 400 vs network) without touching axios itself.
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { importAccounts, type AccountImportError } from '../services/accountImportService'
import type { AccountImportResult } from '../types'

/**
 * Provisions participant accounts from a CSV file. `mutate(file)` /
 * `mutateAsync(file)` run the upload; the returned result exposes
 * `isPending` / `isSuccess` / `data` / `isError` / `error` for the panel.
 */
export function useAccountImport(): UseMutationResult<
  AccountImportResult,
  AccountImportError,
  File
> {
  return useMutation<AccountImportResult, AccountImportError, File>({
    mutationFn: importAccounts,
  })
}
