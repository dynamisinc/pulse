/**
 * core/media/useMediaLibrary.test.ts
 * ---------------------------------------------------------------------------
 * The staff media library read in MOCK mode (`USE_MOCK_DATA` true under Vitest;
 * demo-polish F0, implementation.md §5): the four canned items newest first, the
 * `kind` filter, anything uploaded this session, and — through the SAME shared
 * axios pipeline a live call uses — a fail-closed malformed body, `null` optional
 * members treated as absent (one backend member missing `WhenWritingNull` must not
 * fail-close the whole library), and the exercise id in the QUERY KEY (never the
 * request) so a cached library cannot outlive an exercise switch (COR-001).
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'
import { registerMockMedia, resetMockMediaRegistry } from './mockMediaRegistry'
import { resolveMediaLibrary, useMediaLibrary } from './useMediaLibrary'

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    )
  }
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  resetMockMediaRegistry()
  vi.restoreAllMocks()
})

describe('useMediaLibrary (mock)', () => {
  it('returns the four canned items, newest first', async () => {
    const { result } = renderHook(() => useMediaLibrary(), { wrapper: wrapperFor(freshClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const items = result.current.data ?? []
    expect(items).toHaveLength(4)
    const times = items.map(item => Date.parse(item.uploadedAtScenario))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(items.every(item => item.fileName.length > 0)).toBe(true)
  })

  it('narrows by kind', async () => {
    const images = renderHook(() => useMediaLibrary('image'), {
      wrapper: wrapperFor(freshClient()),
    })
    const videos = renderHook(() => useMediaLibrary('video'), {
      wrapper: wrapperFor(freshClient()),
    })

    await waitFor(() => expect(images.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(videos.result.current.isSuccess).toBe(true))

    expect(images.result.current.data).toHaveLength(3)
    expect(videos.result.current.data).toHaveLength(1)
    expect(videos.result.current.data?.[0]?.kind).toBe('video')
  })

  it('includes an asset registered by a mock upload', async () => {
    registerMockMedia({
      id: 'mock-media-uploaded',
      kind: 'image',
      url: 'blob:uploaded',
      fileName: 'uploaded.png',
      uploadedAtScenario: '2033-09-04T20:00:00.000Z',
    })

    const { result } = renderHook(() => useMediaLibrary('image'), {
      wrapper: wrapperFor(freshClient()),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.[0]?.id).toBe('mock-media-uploaded')
  })
})

describe('resolveMediaLibrary — the request and the fail-closed guard', () => {
  it('asks for take=100 and only adds kind when filtering (no exerciseId)', async () => {
    const get = vi.spyOn(api, 'get')

    await resolveMediaLibrary()
    await resolveMediaLibrary('video')

    expect(get.mock.calls[0]?.[0]).toBe('/staff/media')
    expect(get.mock.calls[0]?.[1]?.params).toEqual({ take: 100 })
    expect(get.mock.calls[1]?.[1]?.params).toEqual({ kind: 'video', take: 100 })
  })

  it('rejects a body that is not an array of library rows', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { nope: true } })
    await expect(resolveMediaLibrary()).rejects.toThrow(/malformed/)

    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'x', kind: 'image', url: 'u' }] })
    await expect(resolveMediaLibrary()).rejects.toThrow(/malformed/)
  })
})

describe('useMediaLibrary — the cache key carries the exercise (L-2)', () => {
  it('keys the query by prefix, the session exercise id, then the kind', async () => {
    const client = freshClient()
    const { result } = renderHook(() => useMediaLibrary('image'), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const keys = client.getQueryCache().findAll({ queryKey: MEDIA_LIBRARY_QUERY_KEY })
    expect(keys.map(query => query.queryKey)).toEqual([
      [...MEDIA_LIBRARY_QUERY_KEY, 'ex-mock-0001', 'image'],
    ])
  })

  it('still sends NO exercise id on the request itself (COR-001)', async () => {
    const get = vi.spyOn(api, 'get')
    const { result } = renderHook(() => useMediaLibrary(), { wrapper: wrapperFor(freshClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // (The exercise-context provider issues its own read; only the library's counts.)
    const libraryCalls = get.mock.calls.filter(call => call[0] === '/staff/media')
    expect(libraryCalls).toHaveLength(1)
    expect(JSON.stringify(libraryCalls)).not.toMatch(/ex-mock-0001/)
    expect(libraryCalls[0]?.[1]?.params).toEqual({ take: 100 })
  })
})

describe('resolveMediaLibrary — null optional members are treated as absent (M-4)', () => {
  const row = {
    id: 'asset-1',
    kind: 'image',
    url: 'https://blob/a.png',
    fileName: 'a.png',
    uploadedAtScenario: '2033-09-04T12:00:00.000Z',
  }

  it('accepts null posterUrl / width / height / durationSec and drops the keys', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [{ ...row, posterUrl: null, width: null, height: null, durationSec: null }],
    })

    const [parsed] = await resolveMediaLibrary()

    expect(parsed).toEqual(row)
    expect(Object.keys(parsed ?? {}).sort()).toEqual(
      ['fileName', 'id', 'kind', 'uploadedAtScenario', 'url'],
    )
  })

  it('keeps present optional members', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [{ ...row, kind: 'video', posterUrl: 'https://blob/p.jpg', width: 640, height: 360, durationSec: 4 }],
    })

    const [parsed] = await resolveMediaLibrary()

    expect(parsed).toMatchObject({ posterUrl: 'https://blob/p.jpg', width: 640, durationSec: 4 })
  })

  it('does not forward stray server-side keys on a row', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [{ ...row, blobName: 'ex/secret.png', uploadedByHumanId: 'human-secret' }],
    })

    const [parsed] = await resolveMediaLibrary()

    expect(parsed).not.toHaveProperty('blobName')
    expect(parsed).not.toHaveProperty('uploadedByHumanId')
  })

  it('still fails the whole read closed on one genuinely malformed row', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [row, { ...row, id: 'asset-2', width: 'wide' }],
    })

    await expect(resolveMediaLibrary()).rejects.toThrow(/malformed/)
  })
})
