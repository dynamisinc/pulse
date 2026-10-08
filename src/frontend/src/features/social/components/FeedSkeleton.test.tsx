/**
 * features/social/components/FeedSkeleton.test.tsx
 * ---------------------------------------------------------------------------
 * The F0 STUB's contract, which F5 must keep when it fills in skeleton rows:
 * a polite `role="status"` text alternative reading "Loading posts…" with no
 * exercise/admin language (NFR-001; the feed's loading-state AC).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeedSkeleton } from './FeedSkeleton'

describe('FeedSkeleton (stub)', () => {
  it('announces loading as a status with calm in-fiction text', () => {
    render(<FeedSkeleton />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading posts…')
    expect(status.textContent ?? '').not.toMatch(/exercise|admin|scenario|controller|inject|mock/i)
  })
})
