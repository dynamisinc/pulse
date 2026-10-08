/**
 * features/social/explore/useTrending.test.tsx
 * ---------------------------------------------------------------------------
 * `useTrending`'s clock handling (demo-polish F6, fold M4, COR-053): the window is the
 * exercise clock's, and posts stamped more than 15 scenario minutes ahead of it are
 * skipped in a live build -- while the dev mock (`USE_MOCK_DATA`), whose fixtures are
 * dated 2033 against a wall-clock mock clock, lifts that tolerance so they trend.
 * The baseline is stubbed and `USE_MOCK_DATA` is switched per file section with
 * `vi.doMock`, so each build mode is exercised for real.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView } from '@/features/social'

const NOW = '2033-09-04T16:00:00.000Z'

function view(id: string, text: string, at: string): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-a',
    text,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: at,
  }
}

const POSTS = [
  view('now-1', 'a recent one #Recent', '2033-09-04T15:30:00Z'),
  view('skew-1', 'a little ahead #Skew', '2033-09-04T16:10:00Z'), // 10 min ahead: inside
  view('future-1', 'a fixture from the future #Future', '2033-09-11T10:00:00Z'), // a week ahead
]

/**
 * Loads `useTrending` fresh, with `USE_MOCK_DATA` and the baseline stubbed. The clock is
 * set through the SAME fresh `@/core/clock` instance the hook imports (a reset registry
 * would otherwise leave the test and the hook holding two clocks).
 */
async function loadHook(mock: boolean, nowIso: string) {
  vi.resetModules()
  vi.doMock('@/core/config/mockData', () => ({ USE_MOCK_DATA: mock }))
  vi.doMock('./useExploreFeed', () => ({
    useExploreBaseline: () => ({ posts: POSTS, loading: false, failed: false }),
  }))
  const { setExerciseClock } = await import('@/core/clock')
  setExerciseClock({ scenarioNow: () => new Date(nowIso) })
  const { useTrending } = await import('./useTrending')
  return useTrending
}

afterEach(async () => {
  const { resetExerciseClock } = await import('@/core/clock')
  resetExerciseClock()
  vi.doUnmock('@/core/config/mockData')
  vi.doUnmock('./useExploreFeed')
  vi.resetModules()
})

describe('useTrending — future-dated posts', () => {
  it('in a live build, skips posts stamped beyond the 15-minute tolerance', async () => {
    const useTrending = await loadHook(false, NOW)
    const { result } = renderHook(() => useTrending())

    expect(result.current.topics.map(topic => topic.tag).sort()).toEqual(['recent', 'skew'])
  })

  it('in the dev mock, lifts the tolerance so the 2033 fixtures trend', async () => {
    const useTrending = await loadHook(true, NOW)
    const { result } = renderHook(() => useTrending())

    expect(result.current.topics.map(topic => topic.tag).sort()).toEqual([
      'future',
      'recent',
      'skew',
    ])
  })

  it('measures the window from the exercise clock, floored to the minute', async () => {
    const useTrending = await loadHook(false, '2033-09-04T16:00:42.000Z')
    const { result } = renderHook(() => useTrending())

    // 15:30 is 30 minutes before the floored 16:00:00 "now": weight 0.5^(30/180).
    const recent = result.current.topics.find(topic => topic.tag === 'recent')
    expect(recent?.score).toBeCloseTo(0.5 ** (30 / 180), 6)
  })

  it('returns the same topics array across re-renders that change nothing', async () => {
    const useTrending = await loadHook(false, NOW)
    const { result, rerender } = renderHook(() => useTrending())
    const first = result.current.topics
    rerender()
    expect(result.current.topics).toBe(first)
  })
})
