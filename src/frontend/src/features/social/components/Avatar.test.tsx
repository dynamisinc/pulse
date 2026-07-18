/**
 * features/social/components/Avatar.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the R-004 interim avatar treatment: org accounts render a monogram,
 * human accounts render a duotone silhouette (raw initials are retired for
 * humans); the avatar is decorative (identity is carried by the name/handle
 * text, not this graphic).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

const ORG_PERSONA = {
  kind: 'org' as const,
  avatarColor: '#19647e',
  initials: 'FW',
  displayName: 'Fairhaven Water Utility',
}

const HUMAN_PERSONA = {
  kind: 'human' as const,
  avatarColor: '#8a4f7d',
  initials: 'MV',
  displayName: 'Marisol Vega',
}

describe('Avatar', () => {
  it('renders a monogram (initials) for an org/institutional persona', () => {
    render(<Avatar persona={ORG_PERSONA} />)

    const avatar = screen.getByTestId('post-avatar')
    expect(avatar).toHaveAttribute('data-avatar-kind', 'org')
    expect(avatar).toHaveTextContent('FW')
    // Raw-initials-as-the-only-treatment is retired for humans, but the org
    // monogram legitimately IS initials-on-a-color — no silhouette SVG here.
    expect(avatar.querySelector('svg')).not.toBeInTheDocument()
  })

  it('renders a duotone silhouette (no initials text) for a human persona', () => {
    render(<Avatar persona={HUMAN_PERSONA} />)

    const avatar = screen.getByTestId('post-avatar')
    expect(avatar).toHaveAttribute('data-avatar-kind', 'human')
    expect(avatar.querySelector('svg')).toBeInTheDocument()
    expect(avatar).not.toHaveTextContent('MV')
  })

  it('is decorative — hidden from assistive tech, no alt text duplicating identity', () => {
    render(<Avatar persona={HUMAN_PERSONA} />)

    const avatar = screen.getByTestId('post-avatar')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
  })

  it('defaults to 42px and honors a custom size prop', () => {
    const { rerender } = render(<Avatar persona={ORG_PERSONA} />)
    let avatar = screen.getByTestId('post-avatar')
    expect(avatar.style.width).toBe('42px')
    expect(avatar.style.height).toBe('42px')

    rerender(<Avatar persona={ORG_PERSONA} size={110} />)
    avatar = screen.getByTestId('post-avatar')
    expect(avatar.style.width).toBe('110px')
    expect(avatar.style.height).toBe('110px')
  })
})
