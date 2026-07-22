/**
 * features/social/components/NewPostsPill.test.tsx
 * ---------------------------------------------------------------------------
 * Test pass for feeds-discovery/04 "Realtime new-posts pill" (#123) —
 * `<NewPostsPill>`'s own presentational contract (AC3, NFR-001/002):
 *
 *  - the `aria-live="polite"` wrapper is PERSISTENT (present in the DOM even
 *    at count 0, and the SAME node across a count change) — never
 *    `assertive`;
 *  - at count 0 nothing visible renders (no button);
 *  - at count > 0 a real `<button>` renders, calls `onLoad` when activated,
 *    and conveys the count as TEXT (not color/icon alone — NFR-001);
 *  - the display caps at `99+` and pluralises correctly (burst legibility,
 *    NFR-002/SOC-071).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewPostsPill } from './NewPostsPill'

describe('NewPostsPill — persistent polite live region (AC3, NFR-001)', () => {
  it('renders no visible pill at count 0, but the aria-live="polite" wrapper is present', () => {
    const { container } = render(<NewPostsPill count={0} onLoad={() => {}} />)

    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
    const region = container.querySelector('[aria-live]')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('never uses aria-live="assertive" at any count', () => {
    const { container, rerender } = render(<NewPostsPill count={0} onLoad={() => {}} />)
    expect(container.querySelector('[aria-live="assertive"]')).toBeNull()

    rerender(<NewPostsPill count={5} onLoad={() => {}} />)
    expect(container.querySelector('[aria-live="assertive"]')).toBeNull()
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('keeps the SAME live-region DOM node across a 0 → N count change (required for reliable AT announcement)', () => {
    const { container, rerender } = render(<NewPostsPill count={0} onLoad={() => {}} />)
    const before = container.querySelector('[aria-live]')

    rerender(<NewPostsPill count={3} onLoad={() => {}} />)
    const after = container.querySelector('[aria-live]')

    expect(after).toBe(before)
  })
})

describe('NewPostsPill — a real, activatable button when count > 0 (AC3 a11y)', () => {
  it('renders a native <button type="button"> and calls onLoad on activation', () => {
    const onLoad = vi.fn()
    render(<NewPostsPill count={3} onLoad={onLoad} />)

    const pill = screen.getByTestId('new-posts-pill')
    expect(pill.tagName).toBe('BUTTON')
    expect(pill).toHaveAttribute('type', 'button')

    fireEvent.click(pill)
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('conveys the count as text, with a decorative (aria-hidden) icon — never color/icon alone (NFR-001)', () => {
    const { container } = render(<NewPostsPill count={4} onLoad={() => {}} />)

    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('4 new posts')
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('NewPostsPill — legible burst display (NFR-002/SOC-071)', () => {
  it.each([
    [1, '1 new post'],
    [2, '2 new posts'],
    [99, '99 new posts'],
    [100, '99+ new posts'],
    [250, '99+ new posts'],
  ])('count=%i renders "%s"', (count, expected) => {
    render(<NewPostsPill count={count} onLoad={() => {}} />)
    expect(screen.getByTestId('new-posts-pill')).toHaveTextContent(expected)
  })
})
