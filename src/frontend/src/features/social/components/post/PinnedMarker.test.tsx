/**
 * features/social/components/post/PinnedMarker.test.tsx
 * ---------------------------------------------------------------------------
 * The shared "Pinned" line (demo-feedback story 21; DF-34, NFR-001): the WORD carries the
 * meaning and is read by screen readers, the thumbtack is decoration (`aria-hidden`), the
 * copy is fiction-safe, and the id lets a card point `aria-describedby` at it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PINNED_MARKER_TEXT, PinnedMarker } from './PinnedMarker'

describe('PinnedMarker', () => {
  it('shows the word "Pinned" with a decorative thumbtack (never icon-only)', () => {
    render(<PinnedMarker id="m1" />)

    const marker = screen.getByTestId('pinned-for-all-label')
    expect(PINNED_MARKER_TEXT).toBe('Pinned')
    expect(marker).toHaveTextContent(/^Pinned$/)
    expect(marker).toHaveAttribute('id', 'm1')
    const icon = marker.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('data-icon', 'thumbtack')
  })

  it('is accessible text: a screen reader finds "Pinned" by its text', () => {
    render(<PinnedMarker />)
    expect(screen.getByText('Pinned')).toBeVisible()
  })

  it('never names who pinned it (fiction-safe)', () => {
    render(<PinnedMarker />)
    expect(screen.getByTestId('pinned-for-all-label'))
      .not.toHaveTextContent(/controller|exercise control|staff/i)
  })
})
