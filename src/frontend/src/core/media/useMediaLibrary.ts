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
 * The client sends NO `exerciseId` (COR-001): the staff session binds the
 * exercise server-side. The upload client invalidates this query's key prefix
 * after every successful upload, so a just-uploaded asset appears on next open.
 *
 * World-neutral (`core/`): no UI, no theme.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '../services/api'
import { USE_MOCK_DATA } from '../config/mockData'
import { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'
import { listMockMedia } from './mockMediaRegistry'
import type { MediaKind, StaffMediaAssetView } from './types'

/** `take` the client always asks for (server range is 1..200). */
const LIBRARY_TAKE = 100

function isStaffMediaAssetView(value: unknown): value is StaffMediaAssetView {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    (v.kind === 'image' || v.kind === 'video') &&
    typeof v.url === 'string' && v.url.length > 0 &&
    typeof v.fileName === 'string' &&
    typeof v.uploadedAtScenario === 'string' && v.uploadedAtScenario.length > 0 &&
    (v.posterUrl === undefined || typeof v.posterUrl === 'string') &&
    (v.width === undefined || typeof v.width === 'number') &&
    (v.height === undefined || typeof v.height === 'number') &&
    (v.durationSec === undefined || typeof v.durationSec === 'number')
  )
}

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
  if (!Array.isArray(data) || !data.every(isStaffMediaAssetView)) {
    throw new Error('resolveMediaLibrary: resolution returned a malformed media library')
  }
  return data
}

/** The staff media library, optionally narrowed to one kind. */
export function useMediaLibrary(kind?: MediaKind): UseQueryResult<StaffMediaAssetView[]> {
  return useQuery({
    queryKey: [...MEDIA_LIBRARY_QUERY_KEY, kind ?? 'all'],
    queryFn: () => resolveMediaLibrary(kind),
  })
}
