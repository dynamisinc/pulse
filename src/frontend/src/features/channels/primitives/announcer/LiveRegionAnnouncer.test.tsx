/**
 * LiveRegionAnnouncer: one polite region, "N new stories", at most once per 5 s.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_WINDOW_MS, arrivalMessage, createArrivalCoalescer } from './arrivalCoalescer'
import { LiveRegionAnnouncer } from './LiveRegionAnnouncer'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const text = () => screen.getByTestId('live-region-announcer').textContent?.trim()

describe('createArrivalCoalescer', () => {
  it('speaks at once after a quiet window, then folds a burst into one announcement per window', () => {
    const spoken: number[] = []
    const coalescer = createArrivalCoalescer(count => spoken.push(count))
    coalescer.add(1)
    expect(spoken).toEqual([1])
    coalescer.add(2)
    coalescer.add(1)
    vi.advanceTimersByTime(ANNOUNCE_WINDOW_MS - 1)
    expect(spoken).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(spoken).toEqual([1, 3])
    // 120 posts/min for a minute: never more than one announcement per window.
    for (let second = 0; second < 60; second += 1) {
      coalescer.add(2)
      vi.advanceTimersByTime(1000)
    }
    expect(spoken.length).toBeLessThanOrEqual(2 + 60 / 5)
    expect(spoken.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4 + 120)
    coalescer.dispose()
  })

  it('ignores zero, negative and non-finite counts', () => {
    const spoken: number[] = []
    const coalescer = createArrivalCoalescer(count => spoken.push(count))
    coalescer.add(0)
    coalescer.add(-3)
    coalescer.add(Number.NaN)
    expect(spoken).toEqual([])
  })

  it.each([
    [1, '1 new story'],
    [4, '4 new stories'],
  ])('arrivalMessage(%i) => %s', (count, expected) => {
    expect(arrivalMessage(count, { one: 'story', other: 'stories' })).toBe(expected)
  })
})

describe('LiveRegionAnnouncer', () => {
  it('is one polite, atomic status region (never assertive: alerts belong to the alert bar)', () => {
    render(<LiveRegionAnnouncer arrivals={0} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(text()).toBe('')
  })

  it('announces the arrival delta, coalesced to once per 5 s', () => {
    const { rerender } = render(<LiveRegionAnnouncer arrivals={0} />)
    rerender(<LiveRegionAnnouncer arrivals={1} />)
    expect(text()).toBe('1 new story')
    rerender(<LiveRegionAnnouncer arrivals={3} />)
    rerender(<LiveRegionAnnouncer arrivals={6} />)
    expect(text()).toBe('1 new story')
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_WINDOW_MS)
    })
    expect(text()).toBe('5 new stories')
  })

  it('a repeated identical count is still a change in the region (so it is re-announced)', () => {
    const { rerender } = render(<LiveRegionAnnouncer arrivals={0} />)
    rerender(<LiveRegionAnnouncer arrivals={2} />)
    const first = screen.getByTestId('live-region-announcer').textContent
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_WINDOW_MS)
    })
    rerender(<LiveRegionAnnouncer arrivals={4} />)
    const second = screen.getByTestId('live-region-announcer').textContent
    expect(second?.trim()).toBe('2 new stories')
    expect(second).not.toBe(first)
  })

  it('a count that goes down is a new baseline, not an announcement', () => {
    const { rerender } = render(<LiveRegionAnnouncer arrivals={5} />)
    rerender(<LiveRegionAnnouncer arrivals={0} />)
    expect(text()).toBe('')
    rerender(<LiveRegionAnnouncer arrivals={1} />)
    expect(text()).toBe('1 new story')
  })

  it('uses the channel noun', () => {
    const { rerender } = render(<LiveRegionAnnouncer arrivals={0} noun={{ one: 'product', other: 'products' }} />)
    rerender(<LiveRegionAnnouncer arrivals={2} noun={{ one: 'product', other: 'products' }} />)
    expect(text()).toBe('2 new products')
  })
})
