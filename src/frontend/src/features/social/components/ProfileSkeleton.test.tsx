/**
 * features/social/components/ProfileSkeleton.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Skeletons" AC: `ProfileSkeleton` replaces the plain "Loading
 * profile…" text with a profile-shaped placeholder in ONE polite status region
 * (`role="status"`, `aria-busy`) whose accessible text is "Loading profile", with
 * the decorative shapes hidden from assistive tech and the geometry matching the
 * real page (banner height, avatar size) so nothing jumps when the profile lands.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { ProfileSkeleton } from './ProfileSkeleton'

describe('ProfileSkeleton', () => {
  it('is one polite, busy status region announcing "Loading profile"', () => {
    render(<ProfileSkeleton />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Loading profile')
    expect(status.textContent ?? '').not.toMatch(/exercise|admin|scenario|controller|mock|simulat/i)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('sketches the page: banner, avatar lockup, tab strip and post rows, all decorative', () => {
    const { container } = render(<ProfileSkeleton />)

    const decorative = container.querySelector('[aria-hidden="true"]')
    expect(decorative).not.toBeNull()
    // Only the status text is exposed.
    expect(screen.getByRole('status').textContent).toBe('Loading profile')
    // Two post-shaped rows under the header.
    expect(screen.getAllByTestId('skeleton-post-row').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

describe('ProfileSkeleton stylesheet', () => {
  const skeletonCss = readSrcFile('features/social/components/ProfileSkeleton.module.css')
  const profileCss = readSrcFile('features/social/pages/Profile.module.css')

  it('uses the real profile geometry (150px banner, 80px avatar, -42px lockup overlap)', () => {
    expect(skeletonCss).toMatch(/\.banner\s*\{[^}]*height:\s*150px/)
    expect(profileCss).toMatch(/\.banner\s*\{[^}]*height:\s*150px/)
    expect(skeletonCss).toMatch(/\.avatar\s*\{[^}]*width:\s*80px[^}]*height:\s*80px/)
    expect(skeletonCss).toContain('margin-top: -42px')
    expect(profileCss).toContain('margin-top: -42px')
    expect(skeletonCss).toContain('max-width: 600px')
  })

  it('turns the decorative shimmer off under prefers-reduced-motion', () => {
    expect(skeletonCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.block\s*\{[^}]*animation:\s*none/,
    )
  })
})
