/**
 * features/social/components/FeedSkeleton.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Skeletons" AC: `FeedSkeleton` shows >= 3 post-shaped
 * placeholders in ONE polite status region (`role="status"`, `aria-busy`) whose
 * accessible text is "Loading posts" — in-fiction, no exercise/admin language —
 * and the decorative boxes are hidden from assistive tech. (Supersedes the F0
 * stub's contract: a status line reading "Loading posts…".)
 *
 * The no-layout-jump and reduced-motion rules live in the stylesheet, so they are
 * pinned from the source CSS (Vitest blanks `*.css` imports, so it is read off disk
 * via `src/test/readSource.ts`).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { FeedSkeleton, SKELETON_ROW_COUNT } from './FeedSkeleton'

const OUT_OF_FICTION = /exercise|admin|scenario|controller|inject|mock|simulat/i

describe('FeedSkeleton', () => {
  it('is one polite, busy status region announcing "Loading posts"', () => {
    render(<FeedSkeleton />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Loading posts')
    expect(status.textContent ?? '').not.toMatch(OUT_OF_FICTION)
    // Exactly one status region: the skeleton must not stack several announcements.
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('renders at least three post-shaped placeholder rows', () => {
    render(<FeedSkeleton />)

    expect(SKELETON_ROW_COUNT).toBeGreaterThanOrEqual(3)
    const rows = screen.getAllByTestId('skeleton-post-row')
    expect(rows.length).toBe(SKELETON_ROW_COUNT)
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('hides the decorative boxes from assistive tech, leaving only the status text', () => {
    render(<FeedSkeleton />)

    for (const row of screen.getAllByTestId('skeleton-post-row')) {
      expect(row).toHaveAttribute('aria-hidden', 'true')
    }
    // Nothing in the placeholder rows is announced as text or a control.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toBe('Loading posts')
  })

  it('has no live-region churn: a re-render keeps the same single status node', () => {
    const { rerender } = render(<FeedSkeleton />)
    const first = screen.getByRole('status')

    rerender(<FeedSkeleton />)

    expect(screen.getByRole('status')).toBe(first)
  })
})

describe('FeedSkeleton stylesheet', () => {
  const css = readSrcFile('features/social/components/FeedSkeleton.module.css')

  it('turns the decorative shimmer off under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.block\s*\{[^}]*animation:\s*none/,
    )
  })

  it('mirrors the real card box model so content does not jump in (padding, gap, rule, width)', () => {
    const card = readSrcFile('features/social/components/post/PostCard.module.css')
    expect(css.length).toBeGreaterThan(0)
    expect(card.length).toBeGreaterThan(0)
    for (const declaration of [
      'max-width: 600px',
      'padding: 12px 16px',
      'gap: 12px',
      'border-bottom: 1px solid',
    ]) {
      expect(card, `PostCard has ${declaration}`).toContain(declaration)
      expect(css, `skeleton row has ${declaration}`).toContain(declaration)
    }
    // And the avatar placeholder is the real 42px avatar.
    expect(css).toMatch(/\.avatar\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/)
  })
})
