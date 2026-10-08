/**
 * features/social/explore/ExplorePage.test.tsx
 * ---------------------------------------------------------------------------
 * The F0 STUB is a labelled landmark with the page heading (F6 fills in trending
 * and search; F1 mounts it at `/explore`). It must be a real, accessible page
 * rather than a blank one.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExplorePage } from './ExplorePage'

describe('ExplorePage (stub)', () => {
  it('is a landmark named by its h1 heading', () => {
    render(<ExplorePage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Explore' })).toBeInTheDocument()
  })
})
