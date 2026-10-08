/**
 * features/social/components/Avatar.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the R-004 interim avatar treatment: org accounts render a monogram,
 * human accounts render a duotone silhouette (raw initials are retired for
 * humans); the avatar is decorative (identity is carried by the name/handle
 * text, not this graphic).
 *
 * Demo-polish F5 (story 14) adds the photo: `persona.avatarUrl` renders as a
 * circular `<img alt="" loading="lazy">`, falls back to the monogram/silhouette on
 * a load error, an absent url or an unsafe url, and — SOC-052 — an unverified
 * lookalike with the same photo gets NO extra cue.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { personaById, type Persona } from '@/features/personas'
import { Avatar, type AvatarPersona } from './Avatar'

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

const PHOTO_URL = '/mock-media/avatars/fairhavenwater.svg'

describe('Avatar — photo (COR-024)', () => {
  it('renders avatarUrl as a decorative, lazy, circular <img alt="">', () => {
    render(<Avatar persona={{ ...ORG_PERSONA, avatarUrl: PHOTO_URL }} size={80} />)

    const avatar = screen.getByTestId('post-avatar')
    const img = avatar.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', PHOTO_URL)
    // Decorative: an EMPTY alt (not a missing one), loaded lazily.
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('loading', 'lazy')
    // Circular: the wrapper clips to a circle and the image fills it.
    expect(avatar.style.borderRadius).toBe('999px')
    expect(avatar.style.overflow).toBe('hidden')
    expect(img?.style.width).toBe('100%')
    expect(img?.style.height).toBe('100%')
    expect(img?.style.objectFit).toBe('cover')
    // The wrapper is still the same decorative, sized circle.
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar.style.width).toBe('80px')
    // The photo REPLACES the fallback (no monogram text, no silhouette behind it).
    expect(avatar).toHaveAttribute('data-avatar-image', 'photo')
    expect(avatar).not.toHaveTextContent('FW')
    expect(avatar.querySelector('svg')).not.toBeInTheDocument()
    // Hidden from assistive tech, so it is not exposed as an image role either.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps the persona colour behind the photo (the placeholder while it loads)', () => {
    render(<Avatar persona={{ ...HUMAN_PERSONA, avatarUrl: PHOTO_URL }} />)

    expect(screen.getByTestId('post-avatar').style.backgroundColor).not.toBe('')
  })
})

describe('Avatar — fallback to the monogram / silhouette', () => {
  it('falls back to the ORG MONOGRAM when the image fails to load', () => {
    render(<Avatar persona={{ ...ORG_PERSONA, avatarUrl: PHOTO_URL }} />)
    const avatar = screen.getByTestId('post-avatar')
    const img = avatar.querySelector('img')
    if (!img) throw new Error('expected the photo to render first')

    fireEvent.error(img)

    expect(avatar.querySelector('img')).not.toBeInTheDocument()
    expect(avatar).toHaveTextContent('FW')
    expect(avatar).toHaveAttribute('data-avatar-image', 'fallback')
    expect(avatar.querySelector('svg')).not.toBeInTheDocument()
  })

  it('falls back to the HUMAN SILHOUETTE when the image fails to load', () => {
    render(<Avatar persona={{ ...HUMAN_PERSONA, avatarUrl: PHOTO_URL }} />)
    const avatar = screen.getByTestId('post-avatar')
    const img = avatar.querySelector('img')
    if (!img) throw new Error('expected the photo to render first')

    fireEvent.error(img)

    expect(avatar.querySelector('img')).not.toBeInTheDocument()
    expect(avatar.querySelector('svg')).toBeInTheDocument()
    expect(avatar).not.toHaveTextContent('MV')
  })

  it('uses the fallback when there is no avatarUrl at all', () => {
    const { rerender } = render(<Avatar persona={ORG_PERSONA} />)
    expect(screen.getByTestId('post-avatar').querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('post-avatar')).toHaveTextContent('FW')

    rerender(<Avatar persona={{ ...HUMAN_PERSONA, avatarUrl: undefined }} />)
    expect(screen.getByTestId('post-avatar').querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('post-avatar').querySelector('svg')).toBeInTheDocument()
  })

  it('never renders an unsafe url as an image (javascript:, data:, protocol-relative, empty)', () => {
    for (const avatarUrl of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      '//evil.example/a.png',
      'relative/a.png',
      '   ',
    ]) {
      const { unmount } = render(<Avatar persona={{ ...ORG_PERSONA, avatarUrl }} />)
      const avatar = screen.getByTestId('post-avatar')
      expect(avatar.querySelector('img'), avatarUrl).not.toBeInTheDocument()
      expect(avatar).toHaveTextContent('FW')
      unmount()
    }
  })

  it('accepts https, http, blob and root-relative urls', () => {
    for (const avatarUrl of [
      'https://cdn.example/a.png?sig=abc',
      'http://127.0.0.1:10000/a.png',
      'blob:http://localhost/abc',
      '/mock-media/avatars/a.svg',
    ]) {
      const { unmount } = render(<Avatar persona={{ ...ORG_PERSONA, avatarUrl }} />)
      expect(screen.getByTestId('post-avatar').querySelector('img'), avatarUrl).toHaveAttribute(
        'src',
        avatarUrl,
      )
      unmount()
    }
  })

  it('retries when the persona later gets a DIFFERENT url after a failure', () => {
    const { rerender } = render(<Avatar persona={{ ...ORG_PERSONA, avatarUrl: '/a.svg' }} />)
    const first = screen.getByTestId('post-avatar').querySelector('img')
    if (!first) throw new Error('expected the photo to render first')
    fireEvent.error(first)
    expect(screen.getByTestId('post-avatar').querySelector('img')).not.toBeInTheDocument()

    rerender(<Avatar persona={{ ...ORG_PERSONA, avatarUrl: '/b.svg' }} />)

    expect(screen.getByTestId('post-avatar').querySelector('img')).toHaveAttribute('src', '/b.svg')
  })
})

describe('Avatar — no lookalike cue (SOC-052, impersonation training)', () => {
  it('renders an unverified lookalike with the SAME photo identically to the real account', () => {
    const real = personaById('persona-fairhavenwater')
    const fake = personaById('persona-fairhavenwaterupd')
    if (!real || !fake) throw new Error('expected the seeded lookalike pair')
    // The pair is verified vs unverified; a convincing impersonator uses the same image.
    expect(real.verified).toBe(true)
    expect(fake.verified).toBe(false)

    const sameImage = (persona: AvatarPersona): AvatarPersona => ({
      ...persona,
      avatarColor: '#19647e',
      avatarUrl: PHOTO_URL,
    })
    const a = render(<Avatar persona={sameImage(real)} />)
    const realHtml = a.container.innerHTML
    a.unmount()
    const b = render(<Avatar persona={sameImage(fake)} />)

    expect(b.container.innerHTML).toBe(realHtml)
  })

  it('cannot see a trust signal at all: the avatar persona has no `verified`', () => {
    const real = personaById('persona-fairhavenwater')
    if (!real) throw new Error('expected the seeded persona')
    // Passing the full (verified) persona must not leak into the markup either.
    const a = render(<Avatar persona={real} />)
    const withVerified = a.container.innerHTML
    a.unmount()
    const unverified: Persona = { ...real, verified: false }
    const b = render(<Avatar persona={unverified} />)

    expect(b.container.innerHTML).toBe(withVerified)
    expect(withVerified).not.toMatch(/verified/i)
  })
})
