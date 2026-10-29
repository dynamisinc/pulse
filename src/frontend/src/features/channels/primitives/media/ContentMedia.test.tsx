/**
 * ContentMedia: images, video via the shared core player, download-only documents
 * (NWS-014, NWS-032, Q-03, NFR-001, NFR-004, NFR-008).
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { mediaFixture } from '../primitivesTestUtils'
import { ContentMedia } from './ContentMedia'
import { documentFileName, MISSING_ALT_TEXT } from './contentMediaModel'

const ctl = vi.hoisted(() => ({ coarse: false }))

vi.mock('@/core/hooks/useCoarsePointer', () => ({ useCoarsePointer: () => ctl.coarse }))

// Outside the shell: no overlay state to read, no chrome config (bands fail toward marking).
vi.mock('@/features/participant-shell/components/OverlayLayer', () => ({
  useOverlayState: () => ({ state: 'none' }),
}))

beforeEach(() => {
  ctl.coarse = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ContentMedia: image', () => {
  it('renders the image with its alt, the EXERCISE bands and the caption', () => {
    render(<ContentMedia media={mediaFixture()} />)
    const img = screen.getByRole('img', { name: 'Floodwater covering Main Street' })
    expect(img).toHaveAttribute('src', '/mock-media/flood-hero.jpg')
    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
    expect(screen.getByText('Main Street at noon.').tagName).toBe('FIGCAPTION')
  })

  it('reserves its box from the contract dimensions (no layout shift)', () => {
    render(<ContentMedia media={mediaFixture({ width: 1200, height: 900 })} />)
    const frame = screen.getByRole('img').parentElement as HTMLElement
    expect(frame.style.aspectRatio).toContain(String(1200 / 900))
  })

  it('a missing alt becomes a non-empty placeholder and warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<ContentMedia media={mediaFixture({ id: 'no-alt', alt: '  ' })} />)
    expect(screen.getByRole('img', { name: MISSING_ALT_TEXT.image })).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no-alt'))
  })

  it('an unsafe URL never becomes a request: the alt-text tile shows instead', () => {
    const { container } = render(<ContentMedia media={mediaFixture({ url: 'javascript:alert(1)' })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Floodwater covering Main Street')).toBeInTheDocument()
  })

  it('watermark adds the bottom-right EXERCISE chip slot (high-risk container)', () => {
    const { rerender } = render(<ContentMedia media={mediaFixture()} />)
    expect(screen.queryByTestId('watermark-slot')).toBeNull()
    rerender(<ContentMedia media={mediaFixture()} watermark />)
    expect(screen.getByTestId('watermark-slot')).toBeInTheDocument()
  })
})

describe('ContentMedia: video', () => {
  const video = mediaFixture({
    id: 'vid-1',
    kind: 'video',
    url: '/mock-media/briefing.mp4',
    posterUrl: '/mock-media/briefing.jpg',
    contentType: 'video/mp4',
    durationSec: 24,
    alt: 'Mayor briefing',
  })

  it('plays through the shared inline player (named by the alt text, with its bands)', () => {
    render(<ContentMedia media={video} />)
    const player = screen.getByTestId('video-player')
    expect(player).toHaveAttribute('aria-label', 'Mayor briefing')
    expect(player.querySelector('video')).toHaveAttribute('poster', '/mock-media/briefing.jpg')
    expect(screen.getByTestId('video-duration')).toHaveTextContent('0:24')
    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('with watermark, the chip clears the video control row', () => {
    render(<ContentMedia media={video} watermark />)
    expect(screen.getByTestId('watermark-slot').className).toMatch(/clearControls/)
  })

  it('imports the player from core/media, never from Social (news FU-9)', () => {
    const source = readSrcFile('features/channels/primitives/media/ContentMedia.tsx')
    expect(source).toMatch(/from '@\/core\/media\/player'/)
    expect(source).not.toMatch(/features\/social|from '@\/features\/social/)
  })
})

describe('ContentMedia: document (Q-03, download-only)', () => {
  const pdf = mediaFixture({
    id: 'doc-1',
    kind: 'document',
    role: 'attachment',
    url: '/media/press/advisory-3.pdf',
    contentType: 'application/pdf',
    width: null,
    height: null,
    alt: 'Press advisory 3',
    caption: null,
  })

  it('renders a download link with its file name, and nothing else', () => {
    const { container } = render(<ContentMedia media={pdf} />)
    const link = screen.getByRole('link', { name: 'Download Press advisory 3 (advisory-3.pdf)' })
    expect(link).toHaveAttribute('href', '/media/press/advisory-3.pdf')
    expect(link).toHaveAttribute('download', 'advisory-3.pdf')
    expect(link).toHaveTextContent('advisory-3.pdf')
    expect(link).toHaveTextContent('PDF')
    expect(container.querySelector('img, video, iframe, object, embed')).toBeNull()
  })

  it('an unsafe URL is shown as plain text, never a link', () => {
    render(<ContentMedia media={{ ...pdf, url: 'javascript:alert(1)' }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('content-media-document-unavailable')).toHaveTextContent('unavailable')
  })

  it('meets the 44px touch target on a coarse pointer', () => {
    ctl.coarse = true
    render(<ContentMedia media={pdf} />)
    expect(screen.getByRole('link').className).toMatch(/coarse/)
    const css = readSrcFile('features/channels/primitives/media/ContentMedia.module.css')
    expect(/\.coarse\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/min-height:\s*44px/)
  })

  it.each([
    [{ url: '/m/advisory-3.pdf', alt: 'x', contentType: 'application/pdf' }, 'advisory-3.pdf'],
    [{ url: '/m/Situation%20Report.pdf?sig=abc', alt: 'x', contentType: 'application/pdf' }, 'Situation Report.pdf'],
    [{ url: '/m/7f3a9c2e', alt: 'Press advisory 3', contentType: 'application/pdf' }, 'Press advisory 3.pdf'],
    [{ url: '/m/7f3a9c2e', alt: '', contentType: 'text/plain' }, 'document'],
  ])('documentFileName(%o) => %s', (media, expected) => {
    expect(documentFileName(media)).toBe(expected)
  })
})
