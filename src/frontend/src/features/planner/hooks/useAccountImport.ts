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

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { importAccounts, type AccountImportError } from '../services/accountImportService'
import type { AccountImportResult } from '../types'
import { READINESS_QUERY_KEY } from './useReadiness'

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
  const queryClient = useQueryClient()

  return useMutation<AccountImportResult, AccountImportError, File>({
    mutationFn: importAccounts,
    onSuccess: () => {
      // New accounts change go-live readiness (story 03): refresh it.
      void queryClient.invalidateQueries({ queryKey: READINESS_QUERY_KEY })
    },
  })
}
