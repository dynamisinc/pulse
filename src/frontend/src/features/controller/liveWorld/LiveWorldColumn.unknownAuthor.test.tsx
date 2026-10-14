/**
 * features/controller/liveWorld/LiveWorldColumn.unknownAuthor.test.tsx
 * ---------------------------------------------------------------------------
 * "A controller must see every post" (demo-polish C2, orchestrator ruling on
 * review item L-1): a post whose author is not in the persona directory is LISTED
 * as "UNKNOWN AUTHOR · <short id>" rather than skipped, and a NEW unknown author
 * triggers a refresh of the persona directory (`invalidatePersonas()`), throttled
 * to at most once per UNKNOWN_AUTHOR_REFRESH_MS (30s).
 *
 * The labelling/rendering is also covered in `LiveWorldColumn.test.tsx`; this file
 * owns the THROTTLE, which needs fake timers (restored in `afterEach`):
 *  - no unknown author -> never refreshes;
 *  - an unknown author at load refreshes once, immediately, and an author that
 *    STAYS unknown is not retried in a loop;
 *  - further new unknown authors inside the window are coalesced into ONE trailing
 *    refresh at the end of the window (never two refreshes < 30s apart);
 *  - the trailing refresh is cancelled if the directory catches up first;
 *  - nothing is hammered while the directory is loading or has failed.
 *
 * `usePersonas`/`invalidatePersonas` are replaced with deterministic fakes (a
 * fixed cast, a call recorder); `resolveFeed` is mocked; the transport is the fake
 * source. `performance.now()` (the throttle's clock) is faked with the timers.
 */
import { act, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveFeed } from '@/features/social/services/feedService'
import { invalidatePersonas, usePersonas } from '@/features/personas/personaService'
import { SEEDED_PERSONAS } from '@/features/personas/personaService'
import { ARRIVAL_BATCH_MS } from './useLiveWorldFeed'
import { LiveWorldColumn, UNKNOWN_AUTHOR_REFRESH_MS } from './LiveWorldColumn'
import { at, createFakeSource, post, view, WATER, type FakeSource } from './liveWorldTestKit'

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

vi.mock('@/features/personas/personaService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas/personaService')>()
  return { ...actual, usePersonas: vi.fn(), invalidatePersonas: vi.fn() }
})

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    useExerciseContext: () => ({
      exerciseId: 'ex-1',
      exerciseName: 'Exercise One',
      timeZone: 'America/New_York',
    }),
  }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
const mockedUsePersonas = vi.mocked(usePersonas)
const mockedInvalidate = vi.mocked(invalidatePersonas)

/** The fixed cast the fake directory knows. */
const KNOWN = SEEDED_PERSONAS.filter(persona => persona.id === WATER)
let source: FakeSource
let refreshTimes: number[]

function directory(personas = KNOWN) {
  mockedUsePersonas.mockReturnValue({ personas, loading: false, error: undefined })
}

beforeEach(() => {
  vi.useFakeTimers()
  source = createFakeSource()
  refreshTimes = []
  mockedResolveFeed.mockReset()
  mockedInvalidate.mockReset()
  mockedInvalidate.mockImplementation(() => {
    refreshTimes.push(performance.now())
  })
  directory()
})

afterEach(() => {
  vi.useRealTimers()
})

function element() {
  return (
    <ThemeProvider theme={cobraTheme}>
      <LiveWorldColumn onReplyAs={vi.fn()} source={source} />
    </ThemeProvider>
  )
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mountWith(posts: ReturnType<typeof post>[]) {
  mockedResolveFeed.mockResolvedValue(posts)
  const utils = render(element())
  await settle()
  return utils
}

async function arrive(authorPersonaId: string, id: string) {
  act(() => source.emit(view(id, { authorPersonaId, scenarioTime: at(30) })))
  await settle(ARRIVAL_BATCH_MS)
}

function rowFor(id: string): HTMLElement {
  const row = screen.getAllByTestId('live-world-row').find(el => el.dataset.postId === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

describe('unknown author: listed, and the directory refresh is throttled', () => {
  it('lists the post as UNKNOWN AUTHOR and never refreshes when every author is known', async () => {
    await mountWith([post('known', { authorPersonaId: WATER })])
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 4)
    expect(mockedInvalidate).not.toHaveBeenCalled()
    expect(screen.queryByText(/UNKNOWN AUTHOR/)).toBeNull()
  })

  it('refreshes ONCE, immediately, for an unknown author at load — and does not loop on it', async () => {
    await mountWith([post('ghost-post', { authorPersonaId: 'persona-ghost-1' })])

    expect(within(rowFor('ghost-post')).getByTestId('live-world-author'))
      .toHaveTextContent('UNKNOWN AUTHOR · ghost-1')
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)

    // The author stays unknown (a removed persona): no retry loop, however long we wait.
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 10)
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
  })

  it('does not refresh again for the SAME unknown author arriving in more posts', async () => {
    await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    await settle(UNKNOWN_AUTHOR_REFRESH_MS + 1)
    await arrive('persona-ghost-1', 'p2')
    await arrive('persona-ghost-1', 'p3')
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 3)
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
  })

  it('coalesces NEW unknown authors inside the window into one trailing refresh (>= 30s apart)', async () => {
    await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    expect(mockedInvalidate).toHaveBeenCalledTimes(1) // t = 0

    await settle(10_000)
    await arrive('persona-ghost-2', 'p2') // a new unknown author, 10s in: throttled
    await arrive('persona-ghost-3', 'p3') // and another: coalesced with it
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)

    await settle(UNKNOWN_AUTHOR_REFRESH_MS - 10_000 - ARRIVAL_BATCH_MS * 2 - 1)
    expect(mockedInvalidate).toHaveBeenCalledTimes(1) // still inside the window
    await settle(1)
    expect(mockedInvalidate).toHaveBeenCalledTimes(2) // the single trailing refresh

    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 5)
    expect(mockedInvalidate).toHaveBeenCalledTimes(2)
    for (let i = 1; i < refreshTimes.length; i += 1) {
      expect((refreshTimes[i] ?? 0) - (refreshTimes[i - 1] ?? 0))
        .toBeGreaterThanOrEqual(UNKNOWN_AUTHOR_REFRESH_MS)
    }
  })

  it('refreshes immediately for a new unknown author once the window has passed', async () => {
    await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    await settle(UNKNOWN_AUTHOR_REFRESH_MS + 1)
    await arrive('persona-ghost-2', 'p2')
    expect(mockedInvalidate).toHaveBeenCalledTimes(2)
  })

  it('cancels the trailing refresh if the directory catches up first', async () => {
    const { rerender } = await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)

    await settle(5_000)
    await arrive('persona-ghost-2', 'p2') // throttled: a trailing refresh is pending
    // The directory now knows both ghosts (the first refresh landed).
    const ghosts = ['persona-ghost-1', 'persona-ghost-2'].map(id => ({
      ...(KNOWN[0] ?? SEEDED_PERSONAS[0]),
      id,
      displayName: `Ghost ${id}`,
      handle: id,
    }))
    directory([...KNOWN, ...ghosts] as typeof KNOWN)
    rerender(element())
    await settle()
    expect(within(rowFor('p2')).getByTestId('live-world-author')).toHaveTextContent('Ghost')

    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 3)
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
  })

  it('never refreshes while the directory is loading', async () => {
    mockedUsePersonas.mockReturnValue({ personas: [], loading: true, error: undefined })
    await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 3)
    expect(mockedInvalidate).not.toHaveBeenCalled()
  })

  it('never refreshes behind the persona-directory error (its own Retry owns that)', async () => {
    mockedUsePersonas.mockReturnValue({
      personas: [],
      loading: false,
      error: new Error('personas down'),
    })
    await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 3)
    expect(mockedInvalidate).not.toHaveBeenCalled()
    // ... yet the post is still listed.
    expect(rowFor('p1')).toBeInTheDocument()
  })

  it('clears the pending trailing refresh on unmount', async () => {
    const { unmount } = await mountWith([post('p1', { authorPersonaId: 'persona-ghost-1' })])
    await arrive('persona-ghost-2', 'p2') // throttled: a timer is pending
    unmount()
    await settle(UNKNOWN_AUTHOR_REFRESH_MS * 3)
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
