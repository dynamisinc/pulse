/**
 * features/channels/routing/enabled.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 08 (#704) — `useEnabledChannels()` and `<ChannelRoute>`.
 *
 * `@/core/services/api` is mocked at the module boundary (the
 * `channelNavConfig.test.tsx` pattern) so these tests drive the REAL
 * `GET /channel-nav-config` resolution with mixed catalogs, not the shipped
 * social-only mock (no tautological tests). `@/core/exerciseContext` is mocked
 * for its id only (it keys the cache; it is never sent).
 */
import type { ReactNode } from 'react'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { useChannelNav } from '@/features/participant-shell/channelNavConfig'
import { ChannelRoute } from './ChannelRoute'
import { useEnabledChannels } from './enabled'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-enablement-0001',
    exerciseName: 'Enablement Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

let previewActive = false
vi.mock('@/features/staffShell/previewContext', () => ({
  useOptionalPreview: () => (previewActive ? { active: true } : undefined),
}))

const mockGet = vi.mocked(api.get)

type Flags = Partial<Record<'social' | 'portal' | 'news' | 'press' | 'weather', boolean>>

function navConfig(flags: Flags) {
  return {
    channels: [
      { id: 'social', label: 'Social', icon: 'social', enabled: flags.social ?? false },
      { id: 'portal', label: 'Portal', icon: 'portal', enabled: flags.portal ?? false },
      { id: 'news', label: 'News', icon: 'news', enabled: flags.news ?? false },
      { id: 'press', label: 'Press Room', icon: 'press', enabled: flags.press ?? false },
      { id: 'weather', label: 'Weather', icon: 'weather', enabled: flags.weather ?? false },
    ],
    currentChannelId: 'social',
    hideWhenSingleChannel: false,
  }
}

function respondWith(flags: Flags) {
  mockGet.mockResolvedValue({ data: navConfig(flags), status: 200 } as never)
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  mockGet.mockReset()
  previewActive = false
})

describe('useEnabledChannels', () => {
  it('derives the enabled set from GET /channel-nav-config, sending no exercise id', async () => {
    respondWith({ social: true, news: true, weather: true })

    const { result } = renderHook(useEnabledChannels, { wrapper: makeWrapper(newQueryClient()) })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect([...result.current.enabledIds].sort()).toEqual(['news', 'social', 'weather'])
    expect(result.current.isEnabled('news')).toBe(true)
    expect(result.current.isEnabled('press')).toBe(false)
    expect(result.current.isEnabled('portal')).toBe(false)

    expect(mockGet).toHaveBeenCalledTimes(1)
    const [url, config] = mockGet.mock.calls[0] ?? []
    expect(url).toBe('/channel-nav-config')
    expect(JSON.stringify([url, config ?? null])).not.toContain('ex-test-enablement-0001')
  })

  it('reports loading (nothing enabled) before the first answer', () => {
    mockGet.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(useEnabledChannels, { wrapper: makeWrapper(newQueryClient()) })

    expect(result.current.status).toBe('loading')
    expect(result.current.isEnabled('social')).toBe(false)
  })

  it('fails closed to the social-only default when the config cannot be read', async () => {
    mockGet.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(useEnabledChannels, { wrapper: makeWrapper(newQueryClient()) })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect([...result.current.enabledIds]).toEqual(['social'])
    expect(result.current.isEnabled('news')).toBe(false)
  })

  it('shares the shell nav cache entry, so the nav and the guard agree', async () => {
    respondWith({ social: true, press: true })
    const wrapper = makeWrapper(newQueryClient())

    const { result } = renderHook(
      () => ({ nav: useChannelNav(), enabled: useEnabledChannels() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.enabled.status).toBe('ready'))
    const navIds = result.current.nav.channels.map(c => c.id)
    expect(navIds).toEqual([...result.current.enabled.enabledIds])
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('applies a toggle on the next mount (staleTime 0), without a reload', async () => {
    const queryClient = newQueryClient()
    respondWith({ social: true })
    const first = renderHook(useEnabledChannels, { wrapper: makeWrapper(queryClient) })
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(first.result.current.isEnabled('news')).toBe(false)
    first.unmount()

    respondWith({ social: true, news: true })
    const second = renderHook(useEnabledChannels, { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(second.result.current.isEnabled('news')).toBe(true))
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})

describe('<ChannelRoute>', () => {
  function renderRoute(channelId: string, queryClient = newQueryClient()) {
    return render(
      <ChannelRoute channelId={channelId}>
        <p>{channelId} channel content</p>
      </ChannelRoute>,
      { wrapper: makeWrapper(queryClient) },
    )
  }

  it.each(['news', 'press', 'weather', 'portal'])(
    'renders the participant ChannelNotFound for disabled %s, never a blank page',
    async channelId => {
      respondWith({ social: true })

      const { container } = renderRoute(channelId)

      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
      expect(screen.queryByText(`${channelId} channel content`)).not.toBeInTheDocument()
      expect(container.textContent).not.toMatch(/disabled|enabled|exercise|admin|404/i)
      expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    },
  )

  it.each(['news', 'press', 'weather', 'portal'])('renders enabled %s', async channelId => {
    respondWith({ social: true, [channelId]: true })

    renderRoute(channelId)

    expect(await screen.findByText(`${channelId} channel content`)).toBeInTheDocument()
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()
  })

  it('shows a busy placeholder, not a premature not-found, while loading', () => {
    mockGet.mockReturnValue(new Promise(() => {}))

    renderRoute('news')

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()
  })

  it('holds a cached "disabled" until the refetch answers, so a fresh enable never flashes not-found', async () => {
    const queryClient = newQueryClient()
    respondWith({ social: true })
    const first = renderRoute('news', queryClient)
    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()
    first.unmount()

    let answer: (value: unknown) => void = () => {}
    mockGet.mockReturnValue(new Promise(resolve => { answer = resolve }) as never)
    renderRoute('news', queryClient)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()

    answer({ data: navConfig({ social: true, news: true }), status: 200 })
    expect(await screen.findByText('news channel content')).toBeInTheDocument()
  })

  it('lets a staged staff preview render a disabled channel (staff are not blocked)', async () => {
    previewActive = true
    respondWith({ social: true })

    renderRoute('news')

    expect(await screen.findByText('news channel content')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument()
  })

  it('pilot mode (social only): social renders, every other channel is not found', async () => {
    respondWith({ social: true })
    const queryClient = newQueryClient()

    renderRoute('social', queryClient)
    expect(await screen.findByText('social channel content')).toBeInTheDocument()

    renderRoute('news', queryClient)
    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()
  })
})

describe('two worlds (static)', () => {
  const sources: Record<string, string> = import.meta.glob(['./*.ts', './*.tsx', '!./*.test.*'], {
    eager: true,
    query: '?raw',
    import: 'default',
  })

  it('scans every routing module (cannot vacuously pass)', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4)
  })

  it('imports no COBRA theme, no COBRA component and no MUI component', () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/from '[^']*(?:@\/theme|cobra)[^']*'/i)
      expect(source, file).not.toMatch(/from '@mui\//)
    }
  })
})
