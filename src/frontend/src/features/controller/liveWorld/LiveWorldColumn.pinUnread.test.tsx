/**
 * features/controller/liveWorld/LiveWorldColumn.pinUnread.test.tsx
 * ---------------------------------------------------------------------------
 * Story 08 (docs/features/demo-feedback/08-live-world-pin-unread.md), one `describe` per AC:
 *
 *  1. PIN FOR EVERYONE   Pin / Unpin beside the row's actions call the pin service (PUT /
 *     DELETE), the row updates from its own response (icon + "Pinned for everyone"), a
 *     failure is a visible alert (nothing swallowed), the wire's `pinnedForAll` seeds the
 *     marker, and a `PostPinChanged` from another console (a `pinChangeSource` DOUBLE with
 *     story 07's frozen signature) updates the row live.
 *  2. UNREAD             a live arrival is bold + accent bar + "New"; the baseline is read;
 *     "N unread" in the header; read after half the row has been visible for 1 s (a fake
 *     IntersectionObserver), not before; Mark all read.
 *  3. PERSISTENCE        per browser, per exercise: a remount keeps arrivals since the last
 *     visit unread and the rest of the baseline read; another exercise shares nothing; a
 *     throwing localStorage is tolerated (nothing is remembered).
 *  4. "N NEW" COMPOSES   held arrivals merge in unread.
 *  5. PERFORMANCE        a 120-post burst re-renders no settled row (memoized rows stay
 *     memoized), counted through `renderRowActions`, which a row calls on every render.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveFeed } from '@/features/social/services/feedService'
import type { Post } from '@/features/social'
import { LiveWorldColumn, type LiveWorldColumnProps } from './LiveWorldColumn'
import type { LiveWorldPost } from './liveWorldModel'
import { at, createFakeSource, LOOKALIKE, post, view, type FakeSource } from './liveWorldTestKit'
import { liveWorldTokens } from './liveWorldStyles'
import type { PinChangedHandler, PinChangeSource } from './pinChangeSource'
import { PinForAllError, setPinnedForAll } from './pinForAllService'
import { ARRIVAL_BATCH_MS } from './useLiveWorldFeed'
import { READ_DWELL_MS, unreadStorageKey } from './useLiveWorldUnread'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

vi.mock('./pinForAllService', async importOriginal => {
  const actual = await importOriginal<typeof import('./pinForAllService')>()
  return { ...actual, setPinnedForAll: vi.fn() }
})

let scope = { exerciseId: 'ex-1', exerciseName: 'Exercise One', timeZone: 'America/New_York' }
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: () => scope }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
const mockedSetPinned = vi.mocked(setPinnedForAll)

// ---------------------------------------------------------------------------
// A controllable IntersectionObserver (jsdom has none).
// ---------------------------------------------------------------------------
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  private readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit | undefined
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element) { this.observed.add(element) }
  unobserve(element: Element) { this.observed.delete(element) }
  disconnect() { this.observed.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  /** Reports `element` at `ratio` visible (as the browser would on a threshold crossing). */
  report(element: Element, ratio: number) {
    if (!this.observed.has(element)) return
    const entry = {
      target: element,
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
    } as unknown as IntersectionObserverEntry
    this.callback([entry], this as unknown as IntersectionObserver)
  }
}

function observer(): FakeIntersectionObserver {
  const last = FakeIntersectionObserver.instances.at(-1)
  if (last === undefined) throw new Error('no IntersectionObserver was created')
  return last
}

// ---------------------------------------------------------------------------
// A pin-change source DOUBLE with story 07's frozen signature.
// ---------------------------------------------------------------------------
function createPinDouble(): PinChangeSource & { emit: PinChangedHandler; count(): number } {
  const handlers = new Set<PinChangedHandler>()
  return {
    subscribePinChanged(handler) {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
    emit(event) { for (const handler of [...handlers]) handler(event) },
    count: () => handlers.size,
  }
}

let source: FakeSource
let pins: ReturnType<typeof createPinDouble>

beforeEach(() => {
  scope = { exerciseId: 'ex-1', exerciseName: 'Exercise One', timeZone: 'America/New_York' }
  source = createFakeSource()
  pins = createPinDouble()
  mockedResolveFeed.mockReset()
  mockedSetPinned.mockReset()
  mockedSetPinned.mockResolvedValue(undefined)
  window.localStorage.clear()
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  // The controller is looking: the tab is visible and the window focused (see `attention`).
  attention = { visible: true, focused: true }
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (attention.visible ? 'visible' : 'hidden'),
  })
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => attention.focused,
  })
})

afterEach(() => {
  // Back to jsdom's own (prototype) implementations.
  delete (document as unknown as Record<string, unknown>).visibilityState
  delete (document as unknown as Record<string, unknown>).hasFocus
})

let attention = { visible: true, focused: true }

/** Hides / shows the tab, as the browser would (state first, then the event). */
function setTabVisible(visible: boolean) {
  attention.visible = visible
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

/** Moves focus to another window and back. */
function setWindowFocused(focused: boolean) {
  attention.focused = focused
  act(() => { window.dispatchEvent(new Event(focused ? 'focus' : 'blur')) })
}

/** Under FAKE timers: delivers one live arrival and lets its batch land. */
function arriveNow(id: string, minute: number) {
  act(() => source.emit(view(id, { scenarioTime: at(minute), text: `live ${id}` })))
  act(() => { vi.advanceTimersByTime(ARRIVAL_BATCH_MS) })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function baseline(): Post[] {
  return [
    post('b-2', { scenarioTime: at(20), text: 'second baseline' }),
    post('b-1', { scenarioTime: at(10), text: 'first baseline', authorPersonaId: LOOKALIKE }),
  ]
}

function renderColumn(props: Partial<LiveWorldColumnProps> = {}) {
  const onReplyAs = vi.fn()
  const element = (extra: Partial<LiveWorldColumnProps> = {}) => (
    <ThemeProvider theme={cobraTheme}>
      <LiveWorldColumn
        onReplyAs={onReplyAs}
        source={source}
        pinChangeSource={pins}
        {...props}
        {...extra}
      />
    </ThemeProvider>
  )
  const utils = render(element())
  return { ...utils, rerenderColumn: (extra?: Partial<LiveWorldColumnProps>) =>
    utils.rerender(element(extra)) }
}

async function loaded(props: Partial<LiveWorldColumnProps> = {}, feed: Post[] = baseline()) {
  mockedResolveFeed.mockResolvedValue(feed)
  const utils = renderColumn(props)
  await screen.findAllByTestId('live-world-row')
  // Personas resolve asynchronously: wait until every author is a real persona.
  await waitFor(() => expect(screen.queryAllByText(/UNKNOWN AUTHOR/)).toHaveLength(0))
  return utils
}

function rowFor(id: string): HTMLElement {
  const row = screen.getAllByTestId('live-world-row').find(el => el.dataset.postId === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

function unreadCountText(): string {
  return screen.getByTestId('live-world-unread-count').textContent ?? ''
}

async function arrive(id: string, minute: number) {
  act(() => source.emit(view(id, { scenarioTime: at(minute), text: `live ${id}` })))
  await waitFor(() => expect(rowFor(id)).toBeInTheDocument())
}

// ---------------------------------------------------------------------------
describe('AC — Pin for everyone / Unpin', () => {
  it('pins from the row beside Take down: PUT via the service, row updates from the response', async () => {
    const renderRowActions = (p: LiveWorldPost) => <button type="button">{`Take down ${p.id}`}</button>
    await loaded({ renderRowActions })
    const row = within(rowFor('b-1'))
    expect(row.queryByTestId('live-world-pinned')).toBeNull()

    // Beside Take down: the pin control immediately precedes the action slot.
    const pin = row.getByTestId('live-world-pin')
    expect(pin.nextElementSibling).toHaveTextContent('Take down b-1')
    expect(pin).toHaveAccessibleName('Pin for everyone: the post by Fairhaven Water Update')

    await userEvent.setup().click(pin)
    expect(mockedSetPinned).toHaveBeenCalledWith('b-1', true)

    const marker = await row.findByTestId('live-world-pinned')
    expect(marker).toHaveTextContent('Pinned for everyone') // text, never colour alone
    expect(marker.querySelector('svg')).not.toBeNull() // and an icon
    expect(rowFor('b-1')).toHaveAttribute('data-pinned', 'true')
    expect(row.getByTestId('live-world-pin')).toHaveTextContent('Unpin')
    // Only that row.
    expect(within(rowFor('b-2')).queryByTestId('live-world-pinned')).toBeNull()
  })

  it('unpins with the service (pinned: false) and drops the marker', async () => {
    await loaded({}, [post('b-1', { scenarioTime: at(10), pinnedForAll: true } as Partial<Post>)])
    const row = within(rowFor('b-1'))
    expect(row.getByTestId('live-world-pinned')).toBeInTheDocument() // seeded from the wire

    await userEvent.setup().click(row.getByTestId('live-world-pin'))
    expect(mockedSetPinned).toHaveBeenCalledWith('b-1', false)
    await waitFor(() => expect(row.queryByTestId('live-world-pinned')).toBeNull())
    expect(row.getByTestId('live-world-pin')).toHaveTextContent('Pin for everyone')
  })

  it('shows "Pinning…" while in flight and ignores a second click', async () => {
    let resolve: () => void = () => {}
    mockedSetPinned.mockImplementation(() => new Promise<void>(r => { resolve = r }))
    await loaded()
    const user = userEvent.setup()
    const pin = within(rowFor('b-1')).getByTestId('live-world-pin')
    await user.click(pin)
    expect(pin).toHaveTextContent('Pinning…')
    expect(pin).toHaveAttribute('aria-disabled', 'true')
    await user.click(pin)
    expect(mockedSetPinned).toHaveBeenCalledTimes(1)
    await act(async () => { resolve() })
    await within(rowFor('b-1')).findByTestId('live-world-pinned')
  })

  it('shows a failure as a visible alert with the reason; state unchanged; Dismiss clears it', async () => {
    mockedSetPinned.mockRejectedValueOnce(
      new PinForAllError('That post no longer exists in this exercise, or it was taken down.', 404))
    await loaded()
    const user = userEvent.setup()
    const row = within(rowFor('b-1'))
    await user.click(row.getByTestId('live-world-pin'))

    const alert = await row.findByRole('alert')
    expect(alert).toHaveTextContent('That post no longer exists in this exercise, or it was taken down.')
    expect(row.queryByTestId('live-world-pinned')).toBeNull()
    expect(row.getByTestId('live-world-pin')).toHaveTextContent('Pin for everyone')

    await user.click(row.getByTestId('live-world-pin-dismiss'))
    expect(row.queryByRole('alert')).toBeNull()
    expect(row.getByTestId('live-world-pin')).toHaveFocus()
  })

  it('a non-PinForAllError failure still shows a readable alert', async () => {
    mockedSetPinned.mockRejectedValueOnce(new Error('boom'))
    await loaded()
    await userEvent.setup().click(within(rowFor('b-1')).getByTestId('live-world-pin'))
    expect(await within(rowFor('b-1')).findByRole('alert')).toHaveTextContent(/not pinned/)
  })

  it('updates live from another console\'s PostPinChanged (subscribePinChanged double)', async () => {
    const { unmount } = await loaded()
    expect(pins.count()).toBe(1)

    act(() => pins.emit({ postId: 'b-2', pinnedForAll: true }))
    expect(await within(rowFor('b-2')).findByTestId('live-world-pinned')).toBeInTheDocument()
    expect(within(rowFor('b-2')).getByTestId('live-world-pin')).toHaveTextContent('Unpin')

    act(() => pins.emit({ postId: 'b-2', pinnedForAll: false }))
    await waitFor(() => expect(within(rowFor('b-2')).queryByTestId('live-world-pinned')).toBeNull())

    // An id the column does not hold is ignored.
    act(() => pins.emit({ postId: 'elsewhere', pinnedForAll: true }))
    expect(screen.queryAllByTestId('live-world-pinned')).toHaveLength(0)

    unmount()
    expect(pins.count()).toBe(0)
  })

  it('a pin change reaches a post held behind "N new" too', async () => {
    await loaded()
    scrollListTo(200)
    act(() => source.emit(view('held', { scenarioTime: at(50) })))
    await screen.findByTestId('live-world-new')
    act(() => pins.emit({ postId: 'held', pinnedForAll: true }))
    fireEvent.click(screen.getByTestId('live-world-new'))
    expect(await within(rowFor('held')).findByTestId('live-world-pinned')).toBeInTheDocument()
  })

  it('offers no Pin on a taken-down row', async () => {
    await loaded({ isRowRemoved: p => p.id === 'b-1' })
    expect(within(rowFor('b-1')).queryByTestId('live-world-pin')).toBeNull()
    expect(within(rowFor('b-2')).getByTestId('live-world-pin')).toBeInTheDocument()
  })

  it('offers Unpin ONLY on a taken-down row that is still pinned', async () => {
    await loaded({ isRowRemoved: p => p.id === 'b-1' }, [
      post('b-1', { scenarioTime: at(10), pinnedForAll: true } as Partial<Post>),
      post('b-2', { scenarioTime: at(5), authorPersonaId: LOOKALIKE }),
    ])
    const pin = within(rowFor('b-1')).getByTestId('live-world-pin')
    expect(pin).toHaveTextContent('Unpin')
    await userEvent.setup().click(pin)
    expect(mockedSetPinned).toHaveBeenCalledWith('b-1', false)
    // Unpinned and taken down: no Pin is offered.
    await waitFor(() => expect(within(rowFor('b-1')).queryByTestId('live-world-pin')).toBeNull())
  })

  it('announces a successful pin and unpin politely', async () => {
    await loaded()
    const row = within(rowFor('b-1'))
    expect(row.queryByTestId('live-world-pin-announcer')).toBeNull() // untouched rows carry none
    const user = userEvent.setup()
    await user.click(row.getByTestId('live-world-pin'))
    const region = row.getByTestId('live-world-pin-announcer')
    expect(region).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(region).toHaveTextContent('Pinned for everyone'))
    await user.click(row.getByTestId('live-world-pin'))
    await waitFor(() => expect(region).toHaveTextContent('Unpinned'))
  })
})

// ---------------------------------------------------------------------------
/** Simulates the controller having scrolled the log to `top` px. */
function scrollListTo(top: number) {
  const list = screen.getByTestId('live-world-list')
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: top })
  fireEvent.scroll(list)
}

describe('AC — Unread', () => {
  it('the opening baseline is read; a live arrival is unread: bold, accent bar, "New" chip', async () => {
    await loaded()
    expect(screen.queryAllByTestId('live-world-unread')).toHaveLength(0)
    expect(unreadCountText()).toBe('0 unread')

    await arrive('live-1', 40)
    const row = rowFor('live-1')
    expect(row).toHaveAttribute('data-unread', 'true')
    expect(within(row).getByTestId('live-world-unread')).toHaveTextContent('New')
    expect(row).toHaveAccessibleName(/New/) // in the name: never colour alone
    expect(within(row).getByTestId('live-world-text')).toHaveStyle({ fontWeight: '700' })
    expect(row).toHaveStyle(`border-left: 3px solid ${liveWorldTokens.unread}`) // COBRA cobalt bar
    expect(within(rowFor('b-1')).getByTestId('live-world-text')).toHaveStyle({ fontWeight: '400' })
    expect(rowFor('b-1')).not.toHaveStyle(`border-left: 3px solid ${liveWorldTokens.unread}`)
    expect(unreadCountText()).toBe('1 unread')
  })

  it('becomes read once at least half the row has been visible for one second', async () => {
    await loaded()
    await arrive('live-1', 40)
    const io = observer()
    expect(io.options?.root).toBe(screen.getByTestId('live-world-list'))
    expect(io.options?.threshold).toEqual([0.5])
    const row = rowFor('live-1')
    expect(io.observed.has(row)).toBe(true)
    expect(io.observed.has(rowFor('b-1'))).toBe(false) // read rows are not watched

    vi.useFakeTimers()
    try {
      act(() => io.report(row, 0.6))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS - 1) })
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
      act(() => { vi.advanceTimersByTime(1) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(rowFor('live-1')).not.toHaveAttribute('data-unread'))
    expect(within(rowFor('live-1')).queryByTestId('live-world-unread')).toBeNull()
    expect(unreadCountText()).toBe('0 unread')
  })

  it('stays unread when less than half is visible, or it leaves view before one second', async () => {
    await loaded()
    await arrive('live-1', 40)
    const io = observer()
    const row = rowFor('live-1')
    vi.useFakeTimers()
    try {
      act(() => io.report(row, 0.3))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS * 2) })
      act(() => io.report(row, 0.6))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS / 2) })
      act(() => io.report(row, 0))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS * 2) })
    } finally {
      vi.useRealTimers()
    }
    expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
  })

  it('an arrival mid-dwell does not restart it: 600 ms, an arrival, 400 ms => read', async () => {
    await loaded()
    await arrive('live-1', 40)
    const io = observer()
    vi.useFakeTimers()
    try {
      act(() => io.report(rowFor('live-1'), 1))
      act(() => { vi.advanceTimersByTime(600) })
      // An arrival lands (a re-render of the list) while live-1 is being read; its batch
      // takes ARRIVAL_BATCH_MS of the remaining 400 ms.
      arriveNow('live-2', 41)
      expect(rowFor('live-2')).toHaveAttribute('data-unread', 'true')
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
      act(() => { vi.advanceTimersByTime(400 - ARRIVAL_BATCH_MS - 1) })
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
      act(() => { vi.advanceTimersByTime(1) })
      expect(rowFor('live-1')).not.toHaveAttribute('data-unread')
      expect(rowFor('live-2')).toHaveAttribute('data-unread', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('only counts the dwell while the tab is visible AND the window has focus', async () => {
    await loaded()
    await arrive('live-1', 40)
    const io = observer()
    vi.useFakeTimers()
    try {
      // The controller is in another window when the row comes into view: nothing counts.
      setWindowFocused(false)
      act(() => io.report(rowFor('live-1'), 1))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS * 3) })
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')

      // Back in the window: the dwell starts from zero.
      setWindowFocused(true)
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS / 2) })
      // The tab is hidden half-way through: the dwell stops (and does not resume mid-way).
      setTabVisible(false)
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS * 3) })
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')

      setTabVisible(true)
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS - 1) })
      expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
      act(() => { vi.advanceTimersByTime(1) })
      expect(rowFor('live-1')).not.toHaveAttribute('data-unread')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an arrival while the controller is in another window stays unread', async () => {
    await loaded()
    vi.useFakeTimers()
    try {
      setWindowFocused(false)
      arriveNow('away-1', 40)
      act(() => observer().report(rowFor('away-1'), 1)) // in view, but nobody is looking
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS * 5) })
      expect(rowFor('away-1')).toHaveAttribute('data-unread', 'true')
      expect(unreadCountText()).toBe('1 unread')
    } finally {
      vi.useRealTimers()
    }
  })

  it('Mark all read marks every listed row read; aria-disabled (not disabled) at zero', async () => {
    await loaded()
    const markAll = screen.getByTestId('live-world-mark-all-read')
    expect(markAll).toHaveAttribute('aria-disabled', 'true')
    expect(markAll).not.toBeDisabled()
    await arrive('live-1', 40)
    await arrive('live-2', 41)
    expect(unreadCountText()).toBe('2 unread')
    expect(screen.getByTestId('live-world-mark-all-read')).toHaveAttribute('aria-disabled', 'false')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('live-world-mark-all-read'))
    expect(screen.queryAllByTestId('live-world-unread')).toHaveLength(0)
    expect(unreadCountText()).toBe('0 unread')
    // Focus stays on the control (never dropped to <body>), which is now aria-disabled.
    expect(screen.getByTestId('live-world-mark-all-read')).toHaveFocus()
    expect(screen.getByTestId('live-world-mark-all-read')).toHaveAttribute('aria-disabled', 'true')
    // Activating it at zero is a harmless no-op.
    await user.keyboard('{Enter}')
    expect(unreadCountText()).toBe('0 unread')
    expect(screen.getByTestId('live-world-mark-all-read')).toHaveFocus()
  })

  it('works without IntersectionObserver (nothing read by sight; Mark all read still works)', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    await loaded()
    await arrive('live-1', 40)
    expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
    await userEvent.setup().click(screen.getByTestId('live-world-mark-all-read'))
    expect(rowFor('live-1')).not.toHaveAttribute('data-unread')
  })
})

// ---------------------------------------------------------------------------
describe('AC — read state per browser and per exercise', () => {
  it('a remount (reload) marks the baseline read and keeps arrivals since the last visit unread', async () => {
    const { unmount } = await loaded()
    await arrive('live-1', 40)
    await arrive('live-2', 41)
    // live-2 is read by sight before the "reload".
    vi.useFakeTimers()
    try {
      act(() => observer().report(rowFor('live-2'), 1))
      act(() => { vi.advanceTimersByTime(READ_DWELL_MS) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(rowFor('live-2')).not.toHaveAttribute('data-unread'))
    unmount()

    // The reload's baseline now includes both arrivals.
    await loaded({}, [
      post('live-2', { scenarioTime: at(41) }),
      post('live-1', { scenarioTime: at(40) }),
      ...baseline(),
    ])
    expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
    expect(rowFor('live-2')).not.toHaveAttribute('data-unread')
    expect(rowFor('b-1')).not.toHaveAttribute('data-unread')
    expect(unreadCountText()).toBe('1 unread')
  })

  it('a post that arrived while the console was closed is unread on the next visit', async () => {
    const { unmount } = await loaded()
    unmount() // the last visit knew b-1 and b-2

    await loaded({}, [post('while-away', { scenarioTime: at(45) }), ...baseline()])
    expect(rowFor('while-away')).toHaveAttribute('data-unread', 'true')
    expect(rowFor('b-1')).not.toHaveAttribute('data-unread')
    expect(rowFor('b-2')).not.toHaveAttribute('data-unread')
    expect(unreadCountText()).toBe('1 unread')
  })

  it('a first visit (nothing stored) reads the whole baseline as read', async () => {
    expect(window.localStorage.getItem(unreadStorageKey('ex-1'))).toBeNull()
    await loaded({}, [post('never-seen', { scenarioTime: at(45) }), ...baseline()])
    expect(screen.queryAllByTestId('live-world-unread')).toHaveLength(0)
  })

  it('stores the known ids beside the unread ones, bounded', async () => {
    const { unmount } = await loaded()
    await arrive('live-1', 40)
    unmount()
    const stored = JSON.parse(window.localStorage.getItem(unreadStorageKey('ex-1')) ?? '{}') as {
      unread?: string[]; known?: string[]
    }
    expect(stored.unread).toEqual(['live-1'])
    expect(stored.known).toEqual(['live-1', 'b-2', 'b-1'])
  })

  it('is scoped per exercise: another exercise remembers nothing of this one', async () => {
    const { unmount } = await loaded()
    await arrive('live-1', 40)
    unmount()
    expect(window.localStorage.getItem(unreadStorageKey('ex-1'))).toContain('live-1')

    scope = { exerciseId: 'ex-2', exerciseName: 'Exercise Two', timeZone: 'America/New_York' }
    await loaded({}, [post('live-1', { scenarioTime: at(40) }), ...baseline()])
    expect(rowFor('live-1')).not.toHaveAttribute('data-unread')
  })

  it('tolerates a storage failure: the column works and nothing is remembered', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { unmount } = await loaded()
    await arrive('live-1', 40)
    expect(rowFor('live-1')).toHaveAttribute('data-unread', 'true')
    expect(screen.queryByTestId('live-world-error')).toBeNull()
    unmount()

    await loaded({}, [post('live-1', { scenarioTime: at(40) }), ...baseline()])
    expect(rowFor('live-1')).not.toHaveAttribute('data-unread') // nothing was remembered
  })

  it('ignores a malformed stored value', async () => {
    window.localStorage.setItem(unreadStorageKey('ex-1'), '{not json')
    await loaded()
    expect(screen.queryAllByTestId('live-world-unread')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('AC — "N new" composes with unread', () => {
  it('arrivals held while reading merge in UNREAD; "N new" itself is unchanged', async () => {
    await loaded()
    scrollListTo(200)
    act(() => {
      source.emit(view('held-1', { scenarioTime: at(50) }))
      source.emit(view('held-2', { scenarioTime: at(51) }))
    })
    const control = await screen.findByTestId('live-world-new')
    expect(control).toHaveTextContent('2 new')
    expect(screen.queryByText('live held-1')).toBeNull()
    // Held posts are not counted as listed unread rows until merged.
    expect(unreadCountText()).toBe('0 unread')

    fireEvent.click(control)
    await waitFor(() => expect(rowFor('held-1')).toHaveAttribute('data-unread', 'true'))
    expect(rowFor('held-2')).toHaveAttribute('data-unread', 'true')
    expect(unreadCountText()).toBe('2 unread')
  })
})

// ---------------------------------------------------------------------------
describe('Performance — a 120 posts/min burst re-renders no settled row', () => {
  it('memoized rows stay memoized while unread arrivals stream in', async () => {
    const renders = new Map<string, number>()
    const renderRowActions = (p: LiveWorldPost) => {
      renders.set(p.id, (renders.get(p.id) ?? 0) + 1)
      return null
    }
    const settled = Array.from({ length: 40 }, (_, i) =>
      post(`s-${i}`, { scenarioTime: at(0, i) }))
    await loaded({ renderRowActions }, settled)
    await waitFor(() => expect(screen.getAllByTestId('live-world-row')).toHaveLength(40))
    renders.clear()

    // One minute of a 120/min burst, delivered in 12 waves of 10 (each wave lands as one batch).
    for (let wave = 0; wave < 12; wave += 1) {
      act(() => {
        for (let i = 0; i < 10; i += 1) {
          const n = wave * 10 + i
          source.emit(view(`burst-${n}`, { scenarioTime: at(30 + Math.floor(n / 60), n % 60) }))
        }
      })
      await waitFor(() => expect(rowFor(`burst-${wave * 10 + 9}`)).toBeInTheDocument())
    }
    expect(screen.getAllByTestId('live-world-unread')).toHaveLength(120)
    expect(unreadCountText()).toBe('120 unread')

    // Settled rows: only the old top row re-renders, once, as the roving tab stop moves off it.
    const settledRenders = [...renders].filter(([id]) => id.startsWith('s-'))
    expect(settledRenders.filter(([id]) => id !== 's-39')).toEqual([])
    expect(renders.get('s-39') ?? 0).toBeLessThanOrEqual(1)
    // Each burst row renders a bounded number of times (mount, and at most the tab stop moving).
    for (const [id, count] of renders) {
      if (id.startsWith('burst-')) expect(count, id).toBeLessThanOrEqual(3)
    }
  })
})
