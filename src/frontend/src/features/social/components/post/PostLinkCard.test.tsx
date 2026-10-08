/**
 * features/social/components/post/PostLinkCard.test.tsx
 * ---------------------------------------------------------------------------
 * The in-sim link card's preview IMAGE (demo-polish F2 — MOCK-VERIFIED only: the
 * server sends no link previews this push). `linkPreview.imageUrl` renders as a
 * lazy, decorative image in a reserved-ratio frame when it passes the safe-URL
 * allow-list; a missing / unsafe / failed image falls back to the F0 label.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PostLinkPreview } from '../../types/post'
import { PostLinkCard } from './PostLinkCard'

const PREVIEW: PostLinkPreview = {
  title: 'Boil water advisory lifted',
  domain: 'fulco.gov',
  imageLabel: 'Advisory graphic',
}

describe('PostLinkCard — preview image', () => {
  it('renders the image when imageUrl is a safe same-origin path, lazy and decorative', () => {
    render(<PostLinkCard linkPreview={{ ...PREVIEW, imageUrl: '/mock-media/photos/boil-advisory-sign.svg' }} />)

    const img = screen.getByTestId('post-link-image')
    expect(img).toHaveAttribute('src', '/mock-media/photos/boil-advisory-sign.svg')
    expect(img).toHaveAttribute('loading', 'lazy')
    // Decorative: the title right below carries the meaning (alt="" is correct here).
    expect(img).toHaveAttribute('alt', '')
    expect(screen.queryByText('Advisory graphic')).not.toBeInTheDocument()
    expect(screen.getByText('Boil water advisory lifted')).toBeInTheDocument()
    expect(screen.getByText('fulco.gov')).toBeInTheDocument()
  })

  it('accepts an https URL', () => {
    render(<PostLinkCard linkPreview={{ ...PREVIEW, imageUrl: 'https://cdn.example.net/og.jpg' }} />)
    expect(screen.getByTestId('post-link-image')).toHaveAttribute('src', 'https://cdn.example.net/og.jpg')
  })

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    '//evil.example.net/og.png',
    'http://example.org/og.png',
    '',
  ])('drops the unsafe image %j and keeps the label (NFR-004)', imageUrl => {
    const { container } = render(<PostLinkCard linkPreview={{ ...PREVIEW, imageUrl }} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    expect(screen.getByText('Advisory graphic')).toBeInTheDocument()
  })

  it('falls back to the label when the image fails to load', () => {
    render(<PostLinkCard linkPreview={{ ...PREVIEW, imageUrl: '/mock-media/missing.png' }} />)

    fireEvent.error(screen.getByTestId('post-link-image'))

    expect(screen.queryByTestId('post-link-image')).not.toBeInTheDocument()
    expect(screen.getByText('Advisory graphic')).toBeInTheDocument()
  })

  it('keeps the F0 label card when there is no imageUrl', () => {
    render(<PostLinkCard linkPreview={PREVIEW} />)
    expect(screen.getByText('Advisory graphic')).toBeInTheDocument()
    expect(screen.queryByTestId('post-link-image')).not.toBeInTheDocument()
  })

  it('renders nothing without a preview', () => {
    expect(render(<PostLinkCard />).container).toBeEmptyDOMElement()
  })
})
