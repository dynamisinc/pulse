/**
 * core/media/useMediaLibrary.test.ts
 * ---------------------------------------------------------------------------
 * The staff media library read in MOCK mode (`USE_MOCK_DATA` true under Vitest;
 * demo-polish F0, implementation.md §5): the four canned items newest first, the
 * `kind` filter, anything uploaded this session, and — through the SAME shared
 * axios pipeline a live call uses — a fail-closed malformed body.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { registerMockMedia, resetMockMediaRegistry } from './mockMediaRegistry'
import { resolveMediaLibrary, useMediaLibrary } from './useMediaLibrary'

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
