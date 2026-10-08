/**
 * features/controller/liveWorld/LiveWorldColumn.test.tsx
 * ---------------------------------------------------------------------------
 * Acceptance tests for the console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md), one `describe` per AC:
 *
 *  1. MIRROR OF THE WORLD  rows incl. replies, newest first; name, @handle,
 *     VERIFIED as text + icon, scenario time (in the exercise zone), body, media
 *     thumbnail (video: poster + "VIDEO 0:24"), the counts, "↳ replying to @x";
 *     read through `resolveFeed('all', { includeReplies: true })`.
 *  2. UNMISTAKABLY STAFF   "LIVE WORLD" title, a REALTIME / POLLING / CONNECTING
 *     status as TEXT, a bordered panel. (The no-participant-import guard is
 *     `liveWorldTwoWorlds.test.ts`.)
 *  3. REAL TIME WITHOUT DISORIENTATION  arrivals insert in place at the top, are
 *     held behind "N new" when scrolled down (or focused below the top), and
 *     "N new" merges + returns to the top; the log is aria-live="off".
 *  4. FILTERS              All / hashtag / persona; survives re-render and
 *     arrivals; active-filter chip with clear; polite count announcement.
 *  5. ROW ACTIONS          `onReplyAs` payload (excerpt <= 140), `renderRowActions`,
 *     J / K / R and Tab reachability; keys in a portalled popover are ignored.
 *  6. ISOLATION AND SCOPE  no exerciseId on the wire, error + Retry (never an
 *     empty "all quiet"), an exercise switch remounts clean.
 *
 * The shared transport is replaced by a controllable fake source; `resolveFeed`
 * is mocked per test; personas are the REAL seeded mock cast (`usePersonas`).
 * Real timers: the 150ms arrival batch is awaited with `findBy*`/`waitFor`.
 */
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveFeed } from '@/features/social/services/feedService'
import { invalidatePersonas, usePersonas } from '@/features/personas/personaService'
import { LiveWorldColumn, type LiveWorldColumnProps } from './LiveWorldColumn'
import type { LiveWorldPost } from './liveWorldModel'
import { MAX_ROWS, REPLY_EXCERPT_MAX } from './liveWorldModel'
import {
  at,
  createFakeSource,
  LOOKALIKE,
  MVEGA,
  post,
  view,
  WATER,
  type FakeSource,
} from './liveWorldTestKit'

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

// The persona hooks are wrapped (not replaced): they run for real unless a test overrides them.
vi.mock('@/features/personas/personaService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas/personaService')>()
  return {
    ...actual,
    usePersonas: vi.fn(actual.usePersonas),
    invalidatePersonas: vi.fn(actual.invalidatePersonas),
  }
})

let scope = { exerciseId: 'ex-1', exerciseName: 'Exercise One', timeZone: 'America/New_York' }
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: () => scope }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
const mockedUsePersonas = vi.mocked(usePersonas)
const mockedInvalidatePersonas = vi.mocked(invalidatePersonas)
const realUsePersonas = mockedUsePersonas.getMockImplementation()

let source: FakeSource

beforeEach(() => {
  scope = { exerciseId: 'ex-1', exerciseName: 'Exercise One', timeZone: 'America/New_York' }
  source = createFakeSource()
  mockedResolveFeed.mockReset()
  mockedInvalidatePersonas.mockClear()
  if (realUsePersonas) mockedUsePersonas.mockImplementation(realUsePersonas)
})

afterEach(() => {
  vi.useRealTimers()
})

/** The fixture feed: a verified video post, a reply, and an unverified lookalike. */
function feedFixture() {
  return [
    post('p-lookalike', {
      authorPersonaId: LOOKALIKE,
      text: 'Do NOT drink the tap water. #WaterIssues',
      scenarioTime: at(40),
      counts: { reply: 2, repost: 9, like: 999 },
    }),
    post('p-reply', {
      authorPersonaId: MVEGA,
      text: 'Is this safe for the baby?',
      scenarioTime: at(35),
      inReplyTo: { postId: 'p-video', authorHandle: 'FairhavenWater' },
      counts: { reply: 0, repost: 0, like: 0 },
    }),
    post('p-video', {
      authorPersonaId: WATER,
      text: 'Boil water notice for Zone 3. #WaterIssues #boil',
      scenarioTime: at(30),
      counts: { reply: 12, repost: 3, like: 1450, share: 120 },
      media: [{
        id: 'vid-1',
        kind: 'video',
        url: '/mock-media/v.mp4',
        posterUrl: '/mock-media/v.png',
        alt: 'Crew at the pump station',
        durationSec: 24,
      }],
    }),
  ]
}

function renderColumn(props: Partial<LiveWorldColumnProps> = {}, ui?: ReactNode) {
  const onReplyAs = vi.fn()
  const element = (extra: Partial<LiveWorldColumnProps> = {}) => (
    <ThemeProvider theme={cobraTheme}>
      {ui ?? <LiveWorldColumn onReplyAs={onReplyAs} source={source} {...props} {...extra} />}
    </ThemeProvider>
  )
  const utils = render(element())
  return { ...utils, onReplyAs, rerenderColumn: (extra?: Partial<LiveWorldColumnProps>) =>
    utils.rerender(element(extra)) }
}

async function loadedRows() {
  return screen.findAllByTestId('live-world-row')
}

function rowIds(): string[] {
  return screen.queryAllByTestId('live-world-row').map(row => row.dataset.postId ?? '')
}

function rowFor(id: string): HTMLElement {
  const row = screen.getAllByTestId('live-world-row').find(el => el.dataset.postId === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

/** Simulates the controller having scrolled the log to `top` px. */
function scrollListTo(top: number) {
  const list = screen.getByTestId('live-world-list')
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: top })
  fireEvent.scroll(list)
  return list
}

describe('AC1 — mirror of the world', () => {
  it('reads the feed WITH replies and lists every post newest-first', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    expect(mockedResolveFeed).toHaveBeenCalledWith('all', { includeReplies: true })
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])
  })

  it('shows display name, @handle, body, and VERIFIED as icon + text (only when verified)', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const verified = within(rowFor('p-video'))
    expect(verified.getByText('Fairhaven Water Utility')).toBeInTheDocument()
    expect(verified.getByText('@FairhavenWater')).toBeInTheDocument()
    expect(verified.getByText(/Boil water notice for Zone 3/)).toBeInTheDocument()
    const mark = verified.getByTestId('live-world-verified')
    expect(mark).toHaveTextContent('VERIFIED')
    expect(mark.querySelector('svg')).not.toBeNull() // the icon, alongside the word

    // The unverified lookalike (SOC-052) carries no mark: its absence is the only tell.
    expect(within(rowFor('p-lookalike')).queryByTestId('live-world-verified')).toBeNull()
    expect(within(rowFor('p-lookalike')).getByText('@FairhavenWaterUpd')).toBeInTheDocument()
  })

  it('renders the timestamp in SCENARIO time in the exercise zone, never wall-clock', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const time = within(rowFor('p-video')).getByTestId('live-world-time')
    // 10:30Z on 2033-09-04 is 6:30 AM EDT.
    expect(time).toHaveTextContent('Sep 4, 2033, 6:30 AM')
    expect(time).toHaveAttribute('datetime', at(30))
    expect(screen.getByTestId('live-world-zone')).toHaveTextContent('SCENARIO TIME · America/New_York')
    expect(screen.getByTestId('live-world-column')).not.toHaveTextContent(
      String(new Date().getFullYear()),
    )
  })

  it('renders the zone the exercise carries (a different zone gives a different time)', async () => {
    scope = { ...scope, timeZone: 'America/Los_Angeles' }
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()
    expect(within(rowFor('p-video')).getByTestId('live-world-time'))
      .toHaveTextContent('Sep 4, 2033, 3:30 AM')
  })

  it('marks a reply "↳ replying to @x" and not a top-level post', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    expect(within(rowFor('p-reply')).getByTestId('live-world-reply-marker'))
      .toHaveTextContent('↳ replying to @FairhavenWater')
    expect(rowFor('p-reply')).toHaveAttribute('data-kind', 'reply')
    expect(within(rowFor('p-video')).queryByTestId('live-world-reply-marker')).toBeNull()
  })

  it('shows a video thumbnail as its poster with the text label "VIDEO 0:24"', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const media = within(rowFor('p-video')).getByTestId('live-world-media-item')
    expect(media).toHaveAttribute('data-kind', 'video')
    expect(within(media).getByText('VIDEO 0:24')).toBeInTheDocument()
    const poster = within(media).getByRole('img', { name: 'Crew at the pump station' })
    expect(poster).toHaveAttribute('src', '/mock-media/v.png')
    // No <video> element is ever created in the staff column.
    expect(document.querySelector('video')).toBeNull()
  })

  it('shows an image thumbnail, and falls back to a labelled placeholder for an unsafe URL', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p-img', {
        scenarioTime: at(10),
        media: [
          { id: 'i1', kind: 'image', url: '/mock-media/a.png', alt: 'Flooded road' },
          { id: 'i2', kind: 'image', url: 'javascript:alert(1)', alt: 'Hostile image' },
          { id: 'i3', kind: 'video', url: '/mock-media/v.mp4', alt: 'No poster clip' },
        ],
      }),
    ])
    renderColumn()
    await loadedRows()

    const row = within(rowFor('p-img'))
    expect(row.getByRole('img', { name: 'Flooded road' })).toHaveAttribute('src', '/mock-media/a.png')
    // The hostile URL never becomes an <img src>; the placeholder keeps the alt text.
    const hostile = row.getByRole('img', { name: 'Hostile image' })
    expect(hostile.tagName).not.toBe('IMG')
    expect(document.querySelector('img[src^="javascript"]')).toBeNull()
    // A poster-less video is a labelled placeholder: the type is still in TEXT.
    expect(row.getByText('VIDEO')).toBeInTheDocument()
    expect(row.getAllByText('IMAGE')).toHaveLength(2)
  })

  it('shows the counts compactly with spoken equivalents, and NO share cell when none is reported', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const withShare = within(rowFor('p-video'))
    expect(withShare.getByTestId('live-world-count-reply')).toHaveTextContent('12')
    expect(withShare.getByTestId('live-world-count-repost')).toHaveTextContent('3')
    expect(withShare.getByTestId('live-world-count-like')).toHaveTextContent('1.4K')
    expect(withShare.getByTestId('live-world-count-like')).toHaveTextContent('1.4 thousand likes')
    expect(withShare.getByTestId('live-world-count-share')).toHaveTextContent('120')

    // The server never sends `share`: no cell at all (not a "0", not a dash).
    const noShare = within(rowFor('p-reply'))
    expect(noShare.queryByTestId('live-world-count-share')).toBeNull()
    expect(noShare.getAllByRole('listitem')).toHaveLength(3)
    expect(noShare.getByTestId('live-world-counts')).not.toHaveTextContent(/share/i)
    expect(noShare.getByTestId('live-world-counts')).not.toHaveTextContent('–')
  })

  it('renders post text as plain text, never as HTML', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p-xss', { text: '<img src=x onerror="alert(1)"><b>bold</b>', scenarioTime: at(1) }),
    ])
    renderColumn()
    await loadedRows()

    const text = within(rowFor('p-xss')).getByTestId('live-world-text')
    expect(text.textContent).toBe('<img src=x onerror="alert(1)"><b>bold</b>')
    expect(text.querySelector('img, b')).toBeNull()
  })

  it('never shows provenance: nothing from origin / actingHumanId / wall-clock reaches the DOM', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p-prov', {
        origin: 'inject',
        injectId: 'INJ-042',
        actingHumanId: 'human-secret-77',
        createdWallClock: '2031-02-03T04:05:06.000Z',
        scenarioTime: at(2),
      }),
    ])
    renderColumn()
    await loadedRows()

    const html = screen.getByTestId('live-world-column').innerHTML
    for (const leak of ['INJ-042', 'human-secret-77', '2031-02-03', 'controller-as-persona']) {
      expect(html).not.toContain(leak)
    }
  })

  it('LISTS a post whose author is not in the cast as UNKNOWN AUTHOR (a controller sees every post)', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p-ghost', { authorPersonaId: '3f9a1c2b-7d4e-4a10-9c55-0a1b2c3d4e5f', scenarioTime: at(50) }),
      post('p-mock', { authorPersonaId: 'persona-nobody', scenarioTime: at(40) }),
      post('p-ok', { scenarioTime: at(10) }),
    ])
    renderColumn()
    await loadedRows()

    expect(rowIds()).toEqual(['p-ghost', 'p-mock', 'p-ok'])
    const ghost = within(rowFor('p-ghost'))
    // First 8 characters of the id, as a staff label — text, not colour.
    expect(ghost.getByTestId('live-world-author')).toHaveTextContent('UNKNOWN AUTHOR · 3f9a1c2b')
    expect(rowFor('p-ghost')).toHaveAttribute('data-author-unknown', 'true')
    expect(ghost.queryByTestId('live-world-verified')).toBeNull()
    expect(ghost.queryByText(/^@/)).toBeNull() // no invented handle line
    // The mock cast's `persona-` prefix is dropped so the 8 characters mean something.
    expect(within(rowFor('p-mock')).getByTestId('live-world-author'))
      .toHaveTextContent('UNKNOWN AUTHOR · nobody')
    // The rest of the row still works: text, counts, Reply as….
    expect(ghost.getByText('text of p-ghost')).toBeInTheDocument()
    expect(ghost.getByTestId('live-world-reply-as')).toBeEnabled()
    // A known author is unaffected.
    expect(within(rowFor('p-ok')).getByText('Fairhaven Water Utility')).toBeInTheDocument()
  })

  it('hands renderRowActions an unknown-author post flagged authorUnknown (placeholder handle)', async () => {
    const renderRowActions = vi.fn(() => null)
    mockedResolveFeed.mockResolvedValue([post('p-ghost', { authorPersonaId: 'persona-nobody' })])
    renderColumn({ renderRowActions })
    await loadedRows()
    expect(renderRowActions).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p-ghost',
      authorUnknown: true,
      authorDisplayName: 'UNKNOWN AUTHOR · nobody',
      authorHandle: 'unknown-nobody',
      authorVerified: false,
    }))
  })

  it('counts unknown-author arrivals in "N new" too', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()
    scrollListTo(90)
    act(() => source.emit(view('u1', { authorPersonaId: 'persona-nobody', scenarioTime: at(55) })))
    expect(await screen.findByTestId('live-world-new')).toHaveTextContent('1 new')
  })
})

describe('AC2 — unmistakably staff', () => {
  it('has a titled "LIVE WORLD" header in a bordered panel', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    expect(screen.getByRole('heading', { level: 2, name: 'LIVE WORLD' })).toBeInTheDocument()
    const panel = screen.getByTestId('live-world-column')
    expect(getComputedStyle(panel).borderTopWidth).toBe('1px')
    expect(getComputedStyle(panel).borderTopStyle).toBe('solid')
  })

  it('shows the transport as TEXT: REALTIME, POLLING, CONNECTING', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    for (const [mode, label] of [
      ['realtime', 'REALTIME'],
      ['polling', 'POLLING'],
      ['connecting', 'CONNECTING'],
    ] as const) {
      source = createFakeSource(mode)
      const { unmount } = renderColumn()
      await loadedRows()
      const badge = screen.getByTestId('live-world-transport')
      expect(badge).toHaveTextContent(label)
      expect(badge).toHaveAttribute('data-mode', mode)
      expect(badge.querySelector('svg')).not.toBeNull() // icon + text, never colour alone
      unmount()
    }
  })

  it('uses monospaced metadata and the staff look: no participant avatars or cards', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const handle = within(rowFor('p-video')).getByText('@FairhavenWater')
    expect(getComputedStyle(handle).fontFamily).toMatch(/monospace|Menlo|Consolas/i)
    expect(screen.getByTestId('live-world-column').querySelector('[class*="avatar" i]')).toBeNull()
  })
})

describe('visually-hidden text (M-1) and list containment', () => {
  it('srOnly is a true 1px clip box under MUI sx (not 100% x 100% / -8px)', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const announcer = screen.getByTestId('live-world-announcer')
    const style = getComputedStyle(announcer)
    expect(style.position).toBe('absolute')
    expect(style.width).toBe('1px')
    expect(style.height).toBe('1px')
    expect(style.marginTop).toBe('-1px')
    expect(style.overflow).toBe('hidden')
  })

  it('no absolutely-positioned box inside the log is larger than 1px (they would inflate the column)', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const list = screen.getByTestId('live-world-list')
    // (The decorative, aria-hidden play badge on a video thumbnail is the one
    // legitimate absolutely-positioned box; everything else is sr-only text.)
    const absolute = Array.from(list.querySelectorAll<HTMLElement>('*'))
      .filter(el => getComputedStyle(el).position === 'absolute')
      .filter(el => el.getAttribute('aria-hidden') !== 'true')
    expect(absolute.length).toBeGreaterThanOrEqual(10) // the sr-only text on every row
    for (const el of absolute) {
      expect(getComputedStyle(el).width).toBe('1px')
      expect(getComputedStyle(el).height).toBe('1px')
    }
  })

  it('the log is the positioned scroller that contains every row\'s hidden text', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    const list = screen.getByTestId('live-world-list')
    expect(getComputedStyle(list).position).toBe('relative')
    expect(getComputedStyle(list).overflowY).toBe('auto')
    for (const row of screen.getAllByTestId('live-world-row')) {
      for (const hidden of Array.from(row.querySelectorAll<HTMLElement>('*'))
        .filter(el => getComputedStyle(el).position === 'absolute')) {
        expect(list).toContainElement(hidden)
      }
    }
  })
})

describe('AC3 — real time without disorientation', () => {
  async function loaded() {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    const utils = renderColumn()
    await loadedRows()
    return utils
  }

  it('is a log region with aria-live="off" (no chatty live region on a dense surface)', async () => {
    await loaded()
    const list = screen.getByRole('log')
    expect(list).toHaveAttribute('aria-live', 'off')
    expect(list).toHaveAccessibleName(/live world posts/i)
  })

  it('subscribes to the shared transport and releases it on unmount', async () => {
    const { unmount } = await loaded()
    expect(source.start).toHaveBeenCalledTimes(1)
    expect(source.subscriberCount()).toBe(1)
    unmount()
    expect(source.stop).toHaveBeenCalledTimes(1)
    expect(source.subscriberCount()).toBe(0)
  })

  it('inserts an arrival IN PLACE at the top, with no "N new" control', async () => {
    await loaded()
    act(() => source.emit(view('arrived', { scenarioTime: at(59), text: 'fresh news' })))

    await waitFor(() => expect(rowIds()[0]).toBe('arrived'))
    expect(rowIds()).toEqual(['arrived', 'p-lookalike', 'p-reply', 'p-video'])
    expect(screen.queryByTestId('live-world-new')).toBeNull()
  })

  it('shows an arriving reply with its marker (replies come over the realtime feed too)', async () => {
    await loaded()
    act(() => source.emit(view('live-reply', {
      scenarioTime: at(58),
      authorPersonaId: MVEGA,
      inReplyTo: { postId: 'p-video', authorHandle: 'FairhavenWater' },
    })))

    const row = await screen.findByText('text of live-reply')
    expect(row).toBeInTheDocument()
    expect(within(rowFor('live-reply')).getByTestId('live-world-reply-marker'))
      .toHaveTextContent('replying to @FairhavenWater')
  })

  it('holds arrivals behind "N new" while scrolled down, then merges and returns to the top', async () => {
    await loaded()
    scrollListTo(240)
    act(() => {
      source.emit(view('n1', { scenarioTime: at(51) }))
      source.emit(view('n2', { scenarioTime: at(52) }))
    })

    const button = await screen.findByTestId('live-world-new')
    expect(button).toHaveTextContent('2 new')
    expect(button).toHaveAccessibleName('Show 2 new posts')
    // The list did NOT shift under the controller.
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])

    await userEvent.setup().click(button)

    expect(rowIds()).toEqual(['n2', 'n1', 'p-lookalike', 'p-reply', 'p-video'])
    expect(screen.queryByTestId('live-world-new')).toBeNull()
    expect(screen.getByTestId('live-world-list').scrollTop).toBe(0)

    // A MOUSE click leaves the list live: focus is not dragged into it (which would
    // count as "reading" and hold the next arrival behind "N new" again).
    expect(screen.getByTestId('live-world-list')).not.toContainElement(
      document.activeElement as HTMLElement,
    )
    act(() => source.emit(view('n3', { scenarioTime: at(53) })))
    await waitFor(() => expect(rowIds()[0]).toBe('n3'))
    expect(screen.queryByTestId('live-world-new')).toBeNull()
  })

  it('counts a single arrival as "1 new" and keeps counting as more arrive', async () => {
    await loaded()
    scrollListTo(100)
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    expect(await screen.findByTestId('live-world-new')).toHaveTextContent('1 new')
    expect(screen.getByTestId('live-world-new')).toHaveAccessibleName('Show 1 new post')

    act(() => source.emit(view('n2', { scenarioTime: at(52) })))
    await waitFor(() => expect(screen.getByTestId('live-world-new')).toHaveTextContent('2 new'))
  })

  it('merges the held arrivals when the controller scrolls back to the top', async () => {
    await loaded()
    scrollListTo(300)
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    await screen.findByTestId('live-world-new')

    scrollListTo(0)

    await waitFor(() => expect(rowIds()[0]).toBe('n1'))
    expect(screen.queryByTestId('live-world-new')).toBeNull()
  })

  it('holds arrivals while focus is on the FIRST row too: the focused row is not pushed down', async () => {
    await loaded()
    const first = rowFor('p-lookalike')
    first.focus()

    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    expect(await screen.findByTestId('live-world-new')).toHaveTextContent('1 new')
    act(() => source.emit(view('n2', { scenarioTime: at(52) })))
    await waitFor(() => expect(screen.getByTestId('live-world-new')).toHaveTextContent('2 new'))

    // Two batches later the focused row is still the first row, still focused, in place.
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])
    expect(first).toHaveFocus()
    expect(screen.getByTestId('live-world-list').firstElementChild).toBe(first)
  })

  it('also holds arrivals while keyboard focus is on a row below the top, and merges on leaving', async () => {
    await loaded()
    rowFor('p-reply').focus()
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))

    expect(await screen.findByTestId('live-world-new')).toHaveTextContent('1 new')
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])

    act(() => rowFor('p-reply').blur())

    await waitFor(() => expect(rowIds()[0]).toBe('n1'))
    expect(screen.queryByTestId('live-world-new')).toBeNull()
  })

  it('makes the "N new" control keyboard-reachable BEFORE the list in tab order', async () => {
    await loaded()
    scrollListTo(50)
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    const button = await screen.findByTestId('live-world-new')
    const list = screen.getByTestId('live-world-list')
    expect(button.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    button.focus()
    expect(button).toHaveFocus()
  })

  it('does not stay latched in "reading" when the focused row is removed (filtered out)', async () => {
    await loaded()
    rowFor('p-reply').focus() // below the top: arrivals would be held...
    // ... then the filter removes that row WITHOUT moving focus first (no blur event).
    fireEvent.change(screen.getByTestId('live-world-filter'), { target: { value: 'tag:boil' } })
    await waitFor(() => expect(rowIds()).toEqual(['p-video']))
    expect(document.body).toHaveFocus()

    act(() => source.emit(view('match', { text: 'more #boil news', scenarioTime: at(55) })))

    await waitFor(() => expect(rowIds()).toEqual(['match', 'p-video']))
    expect(screen.queryByTestId('live-world-new')).toBeNull()
  })

  it('N activates "N new" from inside the list, merges, and lands on the newest row', async () => {
    await loaded()
    const user = userEvent.setup()
    rowFor('p-reply').focus()
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    await screen.findByTestId('live-world-new')

    await user.keyboard('n')

    expect(rowIds()[0]).toBe('n1')
    expect(screen.queryByTestId('live-world-new')).toBeNull()
    expect(rowFor('n1')).toHaveFocus()
  })

  it('N does nothing when nothing is held', async () => {
    await loaded()
    const user = userEvent.setup()
    rowFor('p-reply').focus()
    await user.keyboard('n')
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])
    expect(rowFor('p-reply')).toHaveFocus()
  })

  it('does not merge "N new" away while it has focus (no focus loss for keyboard users)', async () => {
    await loaded()
    const user = userEvent.setup()
    rowFor('p-reply').focus()
    act(() => source.emit(view('n1', { scenarioTime: at(51) })))
    const button = await screen.findByTestId('live-world-new')

    await user.tab({ shift: true }) // away from the row (to a previous tab stop)
    button.focus() // ... and onto the control
    expect(button).toHaveFocus()
    expect(screen.getByTestId('live-world-new')).toBeInTheDocument()

    // Scrolling to the top while the control is focused must not remove it either.
    scrollListTo(0)
    expect(screen.getByTestId('live-world-new')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(rowIds()[0]).toBe('n1')
    expect(rowFor('n1')).toHaveFocus()
  })

  it('absorbs a burst of 120 posts: every one lands, in order, with the list still usable', async () => {
    await loaded()
    act(() => {
      for (let i = 0; i < 120; i += 1) {
        source.emit(view(`burst-${i}`, {
          scenarioTime: new Date(Date.UTC(2033, 8, 4, 11, 0, i)).toISOString(),
        }))
      }
    })
    await waitFor(() => expect(rowIds()).toHaveLength(3 + 120))
    expect(rowIds()[0]).toBe('burst-119') // newest first
    expect(screen.queryByTestId('live-world-new')).toBeNull() // at the top: inserted in place
  })

  it('bounds the list: only the newest MAX_ROWS rows are kept', async () => {
    const many = Array.from({ length: 5 }, (_, i) => post(`seed-${i}`, { scenarioTime: at(i) }))
    mockedResolveFeed.mockResolvedValue(many)
    renderColumn()
    await loadedRows()

    act(() => {
      for (let i = 0; i < MAX_ROWS + 20; i += 1) {
        source.emit(view(`b-${i}`, {
          scenarioTime: new Date(Date.UTC(2033, 8, 4, 12, 0, 0) + i * 1000).toISOString(),
        }))
      }
    })
    await waitFor(() => expect(rowIds()[0]).toBe(`b-${MAX_ROWS + 19}`))
    expect(rowIds()).toHaveLength(MAX_ROWS)
    expect(rowIds()).not.toContain('seed-0') // the oldest fell off the tail
  })

  it('does not announce arrivals (the log is aria-live="off"; only filters announce)', async () => {
    await loaded()
    const announcer = screen.getByTestId('live-world-announcer')
    await waitFor(() => expect(announcer).toHaveTextContent('3 posts shown'))
    const before = announcer.textContent
    act(() => source.emit(view('n1', { scenarioTime: at(59) })))
    await waitFor(() => expect(rowIds()[0]).toBe('n1'))
    expect(announcer.textContent).toBe(before)
  })
})

describe('AC4 — filters', () => {
  async function loaded() {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    const utils = renderColumn()
    await loadedRows()
    return utils
  }

  it('defaults to ALL posts and offers the hashtags seen and the cast', async () => {
    await loaded()
    const select = screen.getByTestId('live-world-filter') as HTMLSelectElement
    expect(select.value).toBe('all')
    expect(screen.queryByTestId('live-world-filter-chip')).toBeNull()

    const options = within(select).getAllByRole('option').map(o => o.textContent)
    expect(options).toContain('All posts')
    expect(options).toContain('#waterissues') // seen on two posts
    expect(options).toContain('#boil')
    expect(options).toContain('Marisol Vega (@mvega_fh)') // from usePersonas()
    expect(options).not.toContain('#nobodyposted')
  })

  it('filters by hashtag: matching rows only, a chip, the count, and a polite announcement', async () => {
    await loaded()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#boil')

    expect(rowIds()).toEqual(['p-video'])
    expect(screen.getByTestId('live-world-filter-chip')).toHaveTextContent('FILTER: #boil')
    expect(screen.getByTestId('live-world-count')).toHaveTextContent('1 of 3 posts')
    await waitFor(() =>
      expect(screen.getByTestId('live-world-announcer')).toHaveTextContent('1 post matches #boil'))
    expect(screen.getByTestId('live-world-announcer')).toHaveAttribute('aria-live', 'polite')
  })

  it('filters by persona (the picker is over usePersonas())', async () => {
    await loaded()
    await userEvent.setup().selectOptions(
      screen.getByTestId('live-world-filter'),
      'Marisol Vega (@mvega_fh)',
    )

    expect(rowIds()).toEqual(['p-reply'])
    expect(screen.getByTestId('live-world-filter-chip')).toHaveTextContent('FILTER: @mvega_fh')
    await waitFor(() =>
      expect(screen.getByTestId('live-world-announcer')).toHaveTextContent('1 post by @mvega_fh'))
  })

  it('announces a plural count politely', async () => {
    await loaded()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#waterissues')
    await waitFor(() =>
      expect(screen.getByTestId('live-world-announcer'))
        .toHaveTextContent('2 posts match #waterissues'))
  })

  it('clears the filter from the chip, restores every row, and returns focus to the picker', async () => {
    await loaded()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    await user.click(screen.getByRole('button', { name: /clear filter #boil/i }))

    expect(screen.queryByTestId('live-world-filter-chip')).toBeNull()
    expect(rowIds()).toHaveLength(3)
    expect(screen.getByTestId('live-world-filter')).toHaveFocus()
    await waitFor(() =>
      expect(screen.getByTestId('live-world-announcer')).toHaveTextContent('3 posts shown'))
  })

  it('survives a re-render and live arrivals; a non-matching arrival stays hidden', async () => {
    const { rerenderColumn } = await loaded()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#boil')

    rerenderColumn()
    expect(rowIds()).toEqual(['p-video'])

    act(() => {
      source.emit(view('match', { text: 'more #boil news', scenarioTime: at(55) }))
      source.emit(view('other', { text: 'unrelated', scenarioTime: at(56) }))
    })
    await waitFor(() => expect(rowIds()).toEqual(['match', 'p-video']))
    expect((screen.getByTestId('live-world-filter') as HTMLSelectElement).value).toBe('tag:boil')
  })

  it('counts only MATCHING arrivals in "N new" while a filter is active and the list is scrolled', async () => {
    await loaded()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    scrollListTo(80)
    act(() => {
      source.emit(view('match', { text: '#boil', scenarioTime: at(55) }))
      source.emit(view('other-1', { text: 'x', scenarioTime: at(56) }))
      source.emit(view('other-2', { text: 'y', scenarioTime: at(57) }))
    })
    expect(await screen.findByTestId('live-world-new')).toHaveTextContent('1 new')
  })

  it('lists the hashtag options ALPHABETICALLY, and keeps them put as usage changes', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('t1', { text: '#zulu #zulu-ish #alpha', scenarioTime: at(1) }),
      post('t2', { text: '#zulu', scenarioTime: at(2) }),
      post('t3', { text: '#mike', scenarioTime: at(3) }),
    ])
    renderColumn()
    await loadedRows()
    const tagOptions = () => within(screen.getByTestId('live-world-filter')).getAllByRole('option')
      .map(option => option.textContent ?? '')
      .filter(text => text.startsWith('#'))

    // 'zulu' is the most used, 'alpha' the least: the order is alphabetical regardless.
    expect(tagOptions()).toEqual(['#alpha', '#mike', '#zulu'])

    act(() => source.emit(view('t4', { text: '#alpha #alpha #beta', scenarioTime: at(4) })))
    await waitFor(() => expect(tagOptions()).toContain('#beta'))
    expect(tagOptions()).toEqual(['#alpha', '#beta', '#mike', '#zulu'])
  })

  it('keeps an active hashtag selectable, in alphabetical position, after its posts scroll out', async () => {
    await loaded()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    const select = screen.getByTestId('live-world-filter') as HTMLSelectElement
    expect(select.value).toBe('tag:boil')
    expect(within(select).getByRole('option', { name: '#boil' })).toBeInTheDocument()
  })

  it('clears the polite region before writing, so an identical announcement is spoken again', async () => {
    await loaded()
    const announcer = screen.getByTestId('live-world-announcer')
    // Record every value the region takes (timing-independent: no snapshot races).
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(announcer.textContent ?? ''))
    observer.observe(announcer, { childList: true, characterData: true, subtree: true })
    const user = userEvent.setup()

    await user.selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    await waitFor(() => expect(announcer).toHaveTextContent('1 post matches #boil'))
    await user.click(screen.getByRole('button', { name: /clear filter #boil/i }))
    await waitFor(() => expect(announcer).toHaveTextContent('3 posts shown'))
    // The very same text as before, announced a second time.
    await user.selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    await waitFor(() => expect(seen.filter(v => v === '1 post matches #boil')).toHaveLength(2))
    observer.disconnect()

    // Every announcement was PRECEDED by an empty region: a change a screen reader speaks.
    const texts = seen.map((value, i) => ({ value, prev: seen[i - 1] }))
      .filter(({ value }) => value !== '')
    expect(texts.length).toBeGreaterThanOrEqual(3)
    for (const { prev } of texts) expect(prev ?? '').toBe('') // (undefined: the first write)
  })

  it('says so when nothing matches, rather than showing a blank list', async () => {
    await loaded()
    await userEvent.setup().selectOptions(
      screen.getByTestId('live-world-filter'),
      'Fulton County EM (@FulcoEM)',
    )
    expect(rowIds()).toEqual([])
    expect(screen.getByTestId('live-world-empty')).toHaveTextContent('No posts match this filter.')
    expect(screen.getByTestId('live-world-filter-chip')).toBeInTheDocument()
  })
})

describe('AC5 — row actions', () => {
  async function loaded(props: Partial<LiveWorldColumnProps> = {}) {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    const utils = renderColumn(props)
    await loadedRows()
    return utils
  }

  it('calls onReplyAs with a ReplyTarget for the clicked row', async () => {
    const { onReplyAs } = await loaded()
    await userEvent.setup().click(within(rowFor('p-reply')).getByTestId('live-world-reply-as'))

    expect(onReplyAs).toHaveBeenCalledTimes(1)
    expect(onReplyAs).toHaveBeenCalledWith({
      postId: 'p-reply',
      authorHandle: 'mvega_fh',
      authorDisplayName: 'Marisol Vega',
      excerpt: 'Is this safe for the baby?',
    })
  })

  it('cuts the excerpt to at most 140 characters', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('p-long', { text: `${'word '.repeat(80)}end`, scenarioTime: at(3) }),
    ])
    const { onReplyAs } = renderColumn()
    await loadedRows()
    await userEvent.setup().click(screen.getByTestId('live-world-reply-as'))

    const target = onReplyAs.mock.calls[0]?.[0] as { excerpt: string }
    expect(target.excerpt.length).toBeLessThanOrEqual(REPLY_EXCERPT_MAX)
    expect(target.excerpt.endsWith('…')).toBe(true)
  })

  it('names the control "Reply as…" with the author, and advertises the R shortcut', async () => {
    await loaded()
    const button = within(rowFor('p-video')).getByRole('button', {
      name: 'Reply as… to Fairhaven Water Utility',
    })
    expect(button).toHaveTextContent('Reply as…')
    expect(button).toHaveAttribute('aria-keyshortcuts', 'R')
  })

  it('mounts renderRowActions per row with the LiveWorldPost, and renders nothing when absent', async () => {
    const renderRowActions = vi.fn((p: LiveWorldPost) => (
      <button type="button" data-testid="row-action">{`Act on ${p.id}`}</button>
    ))
    await loaded({ renderRowActions })

    expect(screen.getAllByTestId('row-action')).toHaveLength(3)
    expect(within(rowFor('p-video')).getByRole('button', { name: 'Act on p-video' }))
      .toBeInTheDocument()
    const seen = renderRowActions.mock.calls.map(call => call[0]).find(p => p.id === 'p-reply')
    expect(seen).toMatchObject({
      id: 'p-reply',
      authorHandle: 'mvega_fh',
      authorDisplayName: 'Marisol Vega',
      inReplyTo: { postId: 'p-video', authorHandle: 'FairhavenWater' },
    })
  })

  it('renders no extra action when renderRowActions is absent (absent, not disabled)', async () => {
    await loaded()
    for (const row of screen.getAllByTestId('live-world-row')) {
      expect(within(row).getAllByRole('button')).toHaveLength(1) // only Reply as…
      expect(within(row).queryByRole('button', { name: /take down/i })).toBeNull()
    }
  })

  describe('isRowRemoved — a taken-down post stays listed, marked, and unreplyable', () => {
    const removedIds = (...ids: string[]) => (p: LiveWorldPost) => ids.includes(p.id)

    it('marks only the removed row: REMOVED as icon + text, other rows untouched', async () => {
      await loaded({ isRowRemoved: removedIds('p-reply') })

      const removed = within(rowFor('p-reply'))
      const marker = removed.getByTestId('live-world-removed')
      expect(marker).toHaveTextContent('REMOVED')
      expect(marker.querySelector('svg')).not.toBeNull() // never colour alone
      expect(rowFor('p-reply')).toHaveAttribute('data-removed', 'true')
      // It stays listed, in order, with its text (for the record).
      expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])
      expect(removed.getByText('Is this safe for the baby?')).toBeInTheDocument()

      for (const id of ['p-lookalike', 'p-video']) {
        expect(within(rowFor(id)).queryByTestId('live-world-removed')).toBeNull()
        expect(within(rowFor(id)).getByTestId('live-world-reply-as')).toBeEnabled()
      }
    })

    it('names the marker in the row\'s accessible name', async () => {
      await loaded({ isRowRemoved: removedIds('p-reply') })
      expect(rowFor('p-reply')).toHaveAccessibleName(/REMOVED/)
    })

    it('disables Reply as… and explains why via aria-describedby; clicking does nothing', async () => {
      const { onReplyAs } = await loaded({ isRowRemoved: removedIds('p-reply') })
      const button = within(rowFor('p-reply')).getByTestId('live-world-reply-as')

      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(
        'This post was taken down. Replying to it is unavailable.',
      )
      expect(button).not.toHaveAttribute('aria-keyshortcuts')
      // The disabled button has `pointer-events: none`; click through it anyway.
      await userEvent.setup({ pointerEventsCheck: 0 }).click(button)
      expect(onReplyAs).not.toHaveBeenCalled()
    })

    it('makes the R shortcut a no-op on the removed row, but not on its neighbours', async () => {
      const { onReplyAs } = await loaded({ isRowRemoved: removedIds('p-reply') })
      const user = userEvent.setup()

      rowFor('p-reply').focus()
      await user.keyboard('r')
      expect(onReplyAs).not.toHaveBeenCalled()

      await user.keyboard('j')
      await user.keyboard('r')
      expect(onReplyAs).toHaveBeenCalledTimes(1)
      expect(onReplyAs.mock.calls[0]?.[0]).toMatchObject({ postId: 'p-video' })
    })

    it('still renders renderRowActions on a removed row (the action shows its own state)', async () => {
      const renderRowActions = (p: LiveWorldPost) => (
        <span data-testid="row-action">{`state of ${p.id}`}</span>
      )
      await loaded({ renderRowActions, isRowRemoved: removedIds('p-reply') })
      expect(within(rowFor('p-reply')).getByTestId('row-action')).toBeInTheDocument()
    })

    it('updates when the caller passes a new function (the removed set changed)', async () => {
      const { rerenderColumn } = await loaded({ isRowRemoved: removedIds() })
      expect(screen.queryByTestId('live-world-removed')).toBeNull()

      rerenderColumn({ isRowRemoved: removedIds('p-video') })
      expect(within(rowFor('p-video')).getByTestId('live-world-removed')).toBeInTheDocument()
      expect(within(rowFor('p-video')).getByTestId('live-world-reply-as')).toBeDisabled()

      rerenderColumn({ isRowRemoved: removedIds() })
      expect(screen.queryByTestId('live-world-removed')).toBeNull()
      expect(within(rowFor('p-video')).getByTestId('live-world-reply-as')).toBeEnabled()
    })

    it('marks nothing when the prop is absent', async () => {
      await loaded()
      expect(screen.queryByTestId('live-world-removed')).toBeNull()
    })
  })

  it('J / K move the row focus; they stop at the ends', async () => {
    await loaded()
    const user = userEvent.setup()
    rowFor('p-lookalike').focus()

    await user.keyboard('j')
    expect(rowFor('p-reply')).toHaveFocus()
    await user.keyboard('J')
    expect(rowFor('p-video')).toHaveFocus()
    await user.keyboard('j') // at the last row: stays
    expect(rowFor('p-video')).toHaveFocus()
    await user.keyboard('k')
    expect(rowFor('p-reply')).toHaveFocus()
    await user.keyboard('K')
    await user.keyboard('k') // at the first row: stays
    expect(rowFor('p-lookalike')).toHaveFocus()
  })

  it('R runs Reply as… for the focused row (also from one of its own controls)', async () => {
    const { onReplyAs } = await loaded()
    const user = userEvent.setup()
    rowFor('p-video').focus()
    await user.keyboard('r')
    expect(onReplyAs).toHaveBeenCalledTimes(1)
    expect(onReplyAs.mock.calls[0]?.[0]).toMatchObject({ postId: 'p-video' })

    within(rowFor('p-reply')).getByTestId('live-world-reply-as').focus()
    await user.keyboard('R')
    expect(onReplyAs).toHaveBeenCalledTimes(2)
    expect(onReplyAs.mock.calls[1]?.[0]).toMatchObject({ postId: 'p-reply' })
  })

  it('ignores shortcuts with a modifier held, and while typing in a field', async () => {
    const renderRowActions = (p: LiveWorldPost) => (
      <input aria-label={`note ${p.id}`} data-testid="row-input" />
    )
    const { onReplyAs } = await loaded({ renderRowActions })
    const user = userEvent.setup()

    rowFor('p-video').focus()
    await user.keyboard('{Control>}r{/Control}')
    await user.keyboard('{Meta>}r{/Meta}')
    expect(onReplyAs).not.toHaveBeenCalled()

    within(rowFor('p-video')).getByTestId('row-input').focus()
    await user.keyboard('rjk')
    expect(onReplyAs).not.toHaveBeenCalled()
    expect(within(rowFor('p-video')).getByTestId('row-input')).toHaveValue('rjk')
  })

  it('ignores keys typed in a popover PORTALLED out of a row (React events bubble through portals)', async () => {
    const renderRowActions = (p: LiveWorldPost) => p.id === 'p-video'
      ? createPortal(<input aria-label="popover field" data-testid="portal-input" />, document.body)
      : null
    const { onReplyAs } = await loaded({ renderRowActions })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('portal-input'))
    await user.keyboard('rrr')
    expect(onReplyAs).not.toHaveBeenCalled()
  })

  it('uses a roving tab stop: Tab reaches the list once, then the row controls', async () => {
    const renderRowActions = (p: LiveWorldPost) => (
      <button type="button">{`Take down ${p.id}`}</button>
    )
    await loaded({ renderRowActions })
    const user = userEvent.setup()

    const rows = screen.getAllByTestId('live-world-row')
    expect(rows[0]).toHaveAttribute('tabindex', '0')
    expect(rows.slice(1).every(row => row.getAttribute('tabindex') === '-1')).toBe(true)

    rows[0]?.focus()
    await user.tab()
    expect(within(rows[0] as HTMLElement).getByTestId('live-world-reply-as')).toHaveFocus()
    await user.tab()
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: /^Take down/ }))
      .toHaveFocus()
  })

  it('moves the roving tab stop to the row that has focus', async () => {
    await loaded()
    rowFor('p-video').focus()
    await waitFor(() => expect(rowFor('p-video')).toHaveAttribute('tabindex', '0'))
    expect(rowFor('p-lookalike')).toHaveAttribute('tabindex', '-1')
  })

  it('names each row for assistive technology: author line as name, text as description', async () => {
    await loaded()
    const row = rowFor('p-reply')
    expect(row).toHaveAccessibleName(/Marisol Vega\s+@mvega_fh/)
    expect(row).toHaveAccessibleDescription('Is this safe for the baby?')
  })
})

describe('AC6 — isolation and scope', () => {
  it('sends no exerciseId to the feed read', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()

    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)
    const args = mockedResolveFeed.mock.calls[0] ?? []
    expect(args).toEqual(['all', { includeReplies: true }])
    expect(JSON.stringify(args)).not.toMatch(/exercise/i)
  })

  it('shows an inline error with Retry on a failed read — never an empty "all quiet"', async () => {
    mockedResolveFeed.mockRejectedValueOnce(new Error('boom'))
    mockedResolveFeed.mockResolvedValueOnce(feedFixture())
    renderColumn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('could not be loaded')
    expect(screen.queryByText(/no posts in this exercise yet/i)).toBeNull()
    expect(screen.queryAllByTestId('live-world-row')).toHaveLength(0)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))

    await loadedRows()
    expect(rowIds()).toHaveLength(3)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockedResolveFeed).toHaveBeenCalledTimes(2)
  })

  it('keeps showing the error if Retry fails again', async () => {
    mockedResolveFeed.mockRejectedValue(new Error('still down'))
    renderColumn()
    await screen.findByRole('alert')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mockedResolveFeed).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/no posts in this exercise yet/i)).toBeNull()
  })

  it('shows an inline error with Retry when the persona directory fails — authors read UNKNOWN, no post hidden', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    mockedUsePersonas.mockReturnValue({
      personas: [],
      loading: false,
      error: new Error('personas down'),
    })
    renderColumn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('persona directory could not be loaded')
    // Nothing is hidden because the directory failed: every post is listed, authors unknown.
    await loadedRows()
    expect(rowIds()).toEqual(['p-lookalike', 'p-reply', 'p-video'])
    expect(within(rowFor('p-video')).getByTestId('live-world-author'))
      .toHaveTextContent(/^UNKNOWN AUTHOR · /)
    expect(screen.queryByText(/no posts in this exercise yet/i)).toBeNull()
    // ... and the failed directory is not hammered by the unknown-author refresh.
    expect(mockedInvalidatePersonas).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(mockedInvalidatePersonas).toHaveBeenCalledTimes(1)
  })

  it('keeps showing posts when a persona REFETCH failed but the cast is already loaded', async () => {
    mockedResolveFeed.mockResolvedValue(feedFixture())
    renderColumn()
    await loadedRows()
    mockedUsePersonas.mockImplementation(() => ({
      ...(realUsePersonas ? realUsePersonas() : { personas: [], loading: false, error: undefined }),
      error: new Error('refetch failed'),
    }))
    await act(async () => {
      invalidatePersonas()
    })
    expect(rowIds()).toHaveLength(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says "No posts in this exercise yet." only after a SUCCESSFUL empty read', async () => {
    mockedResolveFeed.mockResolvedValue([])
    renderColumn()
    expect(await screen.findByText('No posts in this exercise yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a loading state, not "all quiet", while the first read is in flight', async () => {
    mockedResolveFeed.mockReturnValue(new Promise(() => {}))
    renderColumn()
    expect(await screen.findByText('Loading the live world…')).toBeInTheDocument()
    expect(screen.queryByText(/no posts in this exercise yet/i)).toBeNull()
  })

  it('still lists arrivals that land while the baseline is loading, once it resolves (de-duplicated)', async () => {
    let resolveFeedRead: (posts: ReturnType<typeof feedFixture>) => void = () => {}
    mockedResolveFeed.mockReturnValue(new Promise(resolve => {
      resolveFeedRead = resolve
    }))
    renderColumn()
    await screen.findByText('Loading the live world…')

    act(() => {
      source.emit(view('p-video', { scenarioTime: at(30) })) // also in the baseline
      source.emit(view('early', { scenarioTime: at(45) }))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200))
      resolveFeedRead(feedFixture())
    })

    await waitFor(() => expect(rowIds()).toEqual(['early', 'p-lookalike', 'p-reply', 'p-video']))
  })

  it('remounts clean when the session exercise changes: no rows, filter or buffer carry over', async () => {
    mockedResolveFeed.mockResolvedValueOnce(feedFixture())
    const { rerenderColumn } = renderColumn()
    await loadedRows()
    await userEvent.setup().selectOptions(screen.getByTestId('live-world-filter'), '#boil')
    expect(rowIds()).toEqual(['p-video'])

    scope = { exerciseId: 'ex-2', exerciseName: 'Exercise Two', timeZone: 'America/Chicago' }
    mockedResolveFeed.mockResolvedValueOnce([post('other-exercise-post', { scenarioTime: at(5) })])
    rerenderColumn()

    await waitFor(() => expect(rowIds()).toEqual(['other-exercise-post']))
    expect((screen.getByTestId('live-world-filter') as HTMLSelectElement).value).toBe('all')
    expect(screen.queryByTestId('live-world-filter-chip')).toBeNull()
    expect(screen.getByTestId('live-world-zone')).toHaveTextContent('America/Chicago')
    expect(mockedResolveFeed).toHaveBeenCalledTimes(2)
    // The old exercise's transport hold was released and re-taken (one live hold).
    expect(source.subscriberCount()).toBe(1)
  })
})
