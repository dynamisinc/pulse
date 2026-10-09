/**
 * features/social/components/NewPostsPill.spoken.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 low (NFR-001, NFR-002/SOC-071): the SPOKEN label is throttled during a
 * burst while the VISIBLE count stays live.
 *
 *  - the visible pill updates on every count change but sits OUTSIDE the polite live
 *    region, so its changes are not announced one by one;
 *  - the polite region (always mounted, same node) speaks the first arrival at once, holds
 *    changes for 3 s, then speaks the LATEST label -- a 60-step burst is at most a couple
 *    of announcements, not 60;
 *  - a count back at 0 clears the region at once and the next burst announces immediately;
 *  - unmounting mid-cooldown leaves no timer behind.
 *
 * Fake timers; real timers are restored in `afterEach`.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewPostsPill } from './NewPostsPill'

const noop = () => {}
const THROTTLE_MS = 3000

function region(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[aria-live]')
  if (node === null) throw new Error('no live region')
  return node
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NewPostsPill — the spoken label is throttled, the visible count is live', () => {
  it('keeps the visible pill OUTSIDE the polite region (its changes are not announced)', () => {
    const { container } = render(<NewPostsPill count={3} onLoad={noop} />)

    expect(region(container).contains(screen.getByTestId('new-posts-pill'))).toBe(false)
    expect(region(container)).toHaveAttribute('aria-live', 'polite')
  })

  it('announces the first arrival at once, and shows the visible count immediately', () => {
    const { container, rerender } = render(<NewPostsPill count={0} onLoad={noop} />)
    expect(region(container)).toHaveTextContent('')

    rerender(<NewPostsPill count={1} onLoad={noop} />)

    expect(region(container)).toHaveTextContent('1 new post')
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('1 new post')
  })

  it('holds burst changes for 3 s, then speaks the LATEST label; the visible count never lags', () => {
    const { container, rerender } = render(<NewPostsPill count={1} onLoad={noop} />)
    const live = region(container)
    expect(live).toHaveTextContent('1 new post')

    for (const count of [2, 3, 4, 5, 6, 7, 8]) {
      rerender(<NewPostsPill count={count} onLoad={noop} />)
      // Visible: live. Spoken: still the first one.
      expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(`${count} new posts`)
      expect(live).toHaveTextContent('1 new post')
    }

    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS - 1)
    })
    expect(live).toHaveTextContent('1 new post')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(live).toHaveTextContent('8 new posts')
    // Same node throughout (a polite region must pre-exist its content changes).
    expect(region(container)).toBe(live)
  })

  it('a long burst is a handful of announcements, not one per arrival', () => {
    const { container, rerender } = render(<NewPostsPill count={1} onLoad={noop} />)
    const live = region(container)
    const announcements = [live.textContent]

    // 120 posts/min for 10 s: one arrival every 500 ms (20 arrivals).
    for (let step = 2; step <= 21; step += 1) {
      act(() => {
        vi.advanceTimersByTime(500)
      })
      rerender(<NewPostsPill count={step} onLoad={noop} />)
      const text = live.textContent
      if (text !== announcements[announcements.length - 1]) announcements.push(text)
    }
    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS)
    })
    if (live.textContent !== announcements[announcements.length - 1]) {
      announcements.push(live.textContent)
    }

    // 21 distinct visible counts, but the region spoke once per 3 s window: 10 s -> <= 5.
    expect(announcements.length).toBeLessThanOrEqual(5)
    expect(announcements.length).toBeGreaterThan(1)
    expect(live).toHaveTextContent('21 new posts')
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('21 new posts')
  })

  it('clears at once at count 0, and the next burst is announced immediately again', () => {
    const { container, rerender } = render(<NewPostsPill count={5} onLoad={noop} />)
    const live = region(container)
    expect(live).toHaveTextContent('5 new posts')
    rerender(<NewPostsPill count={9} onLoad={noop} />) // inside the cooldown

    rerender(<NewPostsPill count={0} onLoad={noop} />)
    expect(live).toHaveTextContent('')
    // The held "9" must not be spoken later.
    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS * 2)
    })
    expect(live).toHaveTextContent('')

    rerender(<NewPostsPill count={1} onLoad={noop} />)
    expect(live).toHaveTextContent('1 new post')
  })

  it('does not re-announce an unchanged label when the cooldown ends', () => {
    const { container, rerender } = render(<NewPostsPill count={4} onLoad={noop} />)
    const live = region(container)
    rerender(<NewPostsPill count={5} onLoad={noop} />)
    rerender(<NewPostsPill count={4} onLoad={noop} />) // back to what was spoken

    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS)
    })

    expect(live).toHaveTextContent('4 new posts')
  })

  it('leaves no timer behind on unmount', () => {
    const { rerender, unmount } = render(<NewPostsPill count={1} onLoad={noop} />)
    rerender(<NewPostsPill count={2} onLoad={noop} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
