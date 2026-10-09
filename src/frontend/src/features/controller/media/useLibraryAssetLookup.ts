/**
 * features/controller/media/useLibraryAssetLookup.ts
 * ---------------------------------------------------------------------------
 * Resolves a staff media-library asset id to its full `StaffMediaAssetView`
 * (demo-polish C1, story 17). STAFF world - a tiny hook, no UI.
 *
 * WHY IT EXISTS. The frozen `MediaLibraryPicker` contract (implementation.md
 * section 1.11) reports a selection as bare ids - `onChange(ids)` - so a consumer
 * that needs the asset behind an id (the composer's tray rows and preview need the
 * thumbnail, poster, kind and file name; C3's run sheet needs the same) has to look
 * it up. The picker's own `useMediaLibrary()` query already holds every asset it has
 * shown, so the lookup reads THAT cache instead of making a second request:
 *
 *   queryKey `['staff', 'media', exerciseId, kind | 'all']`  (core/media/mediaLibraryKey)
 *
 * It searches EVERY kind variant (All / Images / Videos) of the CURRENT exercise,
 * so an asset picked under the "Videos" filter resolves even though the "All" list
 * (capped at `take=100`) may not contain it. The exercise id is part of the cache
 * prefix, so an asset cached for another exercise can never be returned (COR-001) -
 * it is a cache KEY only; the request itself carries no exercise id.
 *
 * It does not require a `QueryClientProvider`: it reads the nearest client if there
 * is one and otherwise the app's shared singleton (`core/services/queryClient`, the
 * same instance the upload client invalidates). The composer therefore still renders
 * in tests that mount no provider; only the picker itself (a `useQuery`) needs one.
 */

import { useCallback, useContext } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { MEDIA_LIBRARY_QUERY_KEY, type StaffMediaAssetView } from '@/core/media'
import { queryClient as sharedQueryClient } from '@/core/services/queryClient'

/** A stable lookup `(id) => asset | undefined` over the current exercise's cached library. */
export function useLibraryAssetLookup(): (id: string) => StaffMediaAssetView | undefined {
  const { exerciseId } = useExerciseContext()
  const client = useContext(QueryClientContext) ?? sharedQueryClient

  return useCallback(
    (id: string) => {
      const cached = client.getQueriesData<StaffMediaAssetView[]>({
        queryKey: [...MEDIA_LIBRARY_QUERY_KEY, exerciseId],
      })
      for (const [, rows] of cached) {
        const found = rows?.find(row => row.id === id)
        if (found !== undefined) return found
      }
      return undefined
    },
    [client, exerciseId],
  )
}
