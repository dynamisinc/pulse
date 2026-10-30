/**
 * Regression (fix/noise-new-posts-clock; demo 10/20): "N new" with white noise on —
 * click it, the control disappears, no new rows at the top.
 *
 * Root cause: noise posts are stamped by the SERVER exercise clock, which lags the
 * browser wall clock by every Freeze, while human posts were stamped by the browser.
 * Fixed at the source (the server stamps every origin from its own clock; the client
 * reads the same clock), and defended here: the Live World merges pending by scenario
 * `ts`, and at MAX_ROWS the rows the controller just revealed must SURVIVE the cap —
 * the oldest EXISTING rows fall off instead.
 */
import { ThemeProvider } from '@mui/material/styles'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveFeed } from '@/features/social/services/feedService'
import { LiveWorldColumn } from './LiveWorldColumn'
import { MAX_ROWS } from './liveWorldModel'
import { createFakeSource, post, view, type FakeSource } from './liveWorldTestKit'

vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))
vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    useExerciseContext: () => ({ exerciseId: 'ex-1', exerciseName: 'X', timeZone: 'UTC' }),
  }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
let source: FakeSource

/** Wall-clock-stamped human post, `minutesAgo` before 12:00 on the demo day. */
function wallAt(minutesAgo: number): string {
  return new Date(Date.parse('2026-10-20T12:00:00Z') - minutesAgo * 60_000).toISOString()
}

const FREEZE_LAG_MIN = 20 // legacy case: noise stamped 20 min behind the wall clock

beforeEach(() => {
  source = createFakeSource()
  window.localStorage.clear()
  mockedResolveFeed.mockReset()
})

function renderColumn() {
  render(
    <ThemeProvider theme={cobraTheme}>
      <LiveWorldColumn onReplyAs={vi.fn()} source={source} />
    </ThemeProvider>,
  )
}

function rowIds(): string[] {
  return screen.queryAllByTestId('live-world-row').map(row => row.dataset.postId ?? '')
}

function scrollListTo(top: number) {
  const list = screen.getByTestId('live-world-list')
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: top })
  fireEvent.scroll(list)
}

describe('Live World "N new" with noise', () => {
  it('merged noise posts land at the TOP when stamped by the one (server) clock', async () => {
    // Baseline: 5 participant posts over the last 10 wall minutes.
    mockedResolveFeed.mockResolvedValue(
      [0, 2, 4, 6, 8].map(m => post(`human-${m}`, { scenarioTime: wallAt(m) })),
    )
    renderColumn()
    await screen.findAllByTestId('live-world-row')
    const topBefore = rowIds()[0]

    scrollListTo(240)
    act(() => {
      // Two noise posts published NOW, stamped by the same clock as the human rows.
      source.emit(view('noise-1', { scenarioTime: wallAt(-1) }))
      source.emit(view('noise-2', { scenarioTime: wallAt(-2) }))
    })
    const button = await screen.findByTestId('live-world-new')
    expect(button).toHaveTextContent('2 new')

    await userEvent.setup().click(button)

    expect(screen.queryByTestId('live-world-new')).toBeNull() // control is gone
    expect(rowIds().slice(0, 2)).toEqual(['noise-2', 'noise-1']) // the new rows lead the list
    expect(rowIds()[2]).toBe(topBefore)
    expect(rowIds()).toHaveLength(7)
  })

  it('at the MAX_ROWS cap the revealed posts survive; the oldest existing rows fall off', async () => {
    // A full list (300) of rows, all newer than the lagging noise stamp.
    mockedResolveFeed.mockResolvedValue(
      Array.from({ length: MAX_ROWS }, (_, i) => post(`h-${i}`, { scenarioTime: wallAt(i * 0.05) })),
    )
    renderColumn()
    await waitFor(() => expect(rowIds()).toHaveLength(MAX_ROWS))

    scrollListTo(240)
    act(() => {
      source.emit(view('noise-a', { scenarioTime: wallAt(FREEZE_LAG_MIN) }))
      source.emit(view('noise-b', { scenarioTime: wallAt(FREEZE_LAG_MIN - 0.5) }))
      source.emit(view('noise-c', { scenarioTime: wallAt(FREEZE_LAG_MIN - 1) }))
    })
    const button = await screen.findByTestId('live-world-new')
    expect(button).toHaveTextContent('3 new')

    await userEvent.setup().click(button)

    expect(screen.queryByTestId('live-world-new')).toBeNull()
    const ids = rowIds()
    expect(ids).toHaveLength(MAX_ROWS)
    // Even stamped OLDER than every row (the legacy lagging-clock case), nothing is lost...
    expect(ids.filter(id => id.startsWith('noise-')).sort()).toEqual(['noise-a', 'noise-b', 'noise-c'])
    // ...and it is the oldest EXISTING rows that were evicted to make room.
    expect(ids).not.toContain(`h-${MAX_ROWS - 1}`)
    expect(ids).not.toContain(`h-${MAX_ROWS - 3}`)
    expect(ids).toContain(`h-${MAX_ROWS - 4}`)
  })
})
