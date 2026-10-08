/**
 * core/media/useMediaLibrary.ts
 * ---------------------------------------------------------------------------
 * The STAFF media library read (demo-polish F0, implementation.md §1.5.1 / §1.11
 * / §5): `GET /api/staff/media?kind=image|video&take=100`, newest first by
 * SCENARIO upload time, poster images excluded. Staff-only on the wire (the
 * participant shape never includes `fileName` / `uploadedAtScenario`); the
 * controller's media picker (C1) and the run sheet (C3) are the consumers.
 *
 * React Query (project default for server state). Mock/live flip is
 * `USE_MOCK_DATA`: the mock routes through the same shared axios client with a
 * per-request adapter (like `feedService`/`personaService`) and answers with the
 * in-memory `mockMediaRegistry` — the four canned items plus anything uploaded
 * this session. Fails CLOSED on a malformed body (never an empty library).
 *
 * The client sends NO `exerciseId` on the request (COR-001): the staff session
 * binds the exercise server-side. The exercise id is in the query KEY only, so
 * the cache is partitioned per exercise. The upload client invalidates this
 * query's key PREFIX after every successful upload, so a just-uploaded asset
 * appears on next open.
 *
 * World-neutral (`core/`): no UI, no theme.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '../services/api'
import { useExerciseContext } from '../exerciseContext'
import { USE_MOCK_DATA } from '../config/mockData'
import { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'
import { parseStaffMediaAssetView } from './mediaGuards'
import { listMockMedia } from './mockMediaRegistry'
import type { MediaKind, StaffMediaAssetView } from './types'

/** `take` the client always asks for (server range is 1..200). */
const LIBRARY_TAKE = 100

/** Mock adapter: the registry (canned + uploaded), filtered by the request's `kind`. */
const mockLibraryAdapter: AxiosAdapter = config => {
  const params = config.params as { kind?: MediaKind } | undefined
  return Promise.resolve({
    data: listMockMedia(params?.kind),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

/**
 * Resolves the library (newest first). Throws on request failure or a
 * malformed body.
 */
export async function resolveMediaLibrary(kind?: MediaKind): Promise<StaffMediaAssetView[]> {
  const response = await api.get<unknown>('/staff/media', {
    params: { ...(kind !== undefined ? { kind } : {}), take: LIBRARY_TAKE },
    ...(USE_MOCK_DATA ? { adapter: mockLibraryAdapter } : {}),
  })
  const data = response.data
  if (!Array.isArray(data)) {
    throw new Error('resolveMediaLibrary: resolution returned a malformed media library')
  }
  // Each row is parsed and rebuilt from its contract keys; a `null` optional
  // member is treated as absent, a malformed row fails the whole read closed.
  const rows = data.map(parseStaffMediaAssetView)
  if (!rows.every(row => row !== undefined)) {
    throw new Error('resolveMediaLibrary: resolution returned a malformed media library')
  }
  return rows
}

/**
 * The staff media library, optionally narrowed to one kind. Must render under the
 * `ExerciseContextProvider` (always the case in the app): the session's exercise
 * id is part of the QUERY KEY so a cached library can never be served after the
 * staff session switches exercise (COR-001). It is a cache key only — the request
 * itself carries no exercise id; the server resolves scope from the session.
 */
export function useMediaLibrary(kind?: MediaKind): UseQueryResult<StaffMediaAssetView[]> {
  const { exerciseId } = useExerciseContext()
  return useQuery({
    queryKey: [...MEDIA_LIBRARY_QUERY_KEY, exerciseId, kind ?? 'all'],
    queryFn: () => resolveMediaLibrary(kind),
  })
}
