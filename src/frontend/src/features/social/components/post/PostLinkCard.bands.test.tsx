/**
 * features/social/components/post/PostLinkCard.bands.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06, Gate-1 M-4 ("EVERYTHING must be watermarked"): the link-preview
 * PHOTO carries the EXERCISE bands under the same rule as every other participant
 * image (`isWatermarkRequired`, driven through a mocked `useChromeConfig`); the text
 * label fallback (no media shown) never does.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PostLinkPreview } from '../../types/post'
import { PostLinkCard } from './PostLinkCard'

const ctl = vi.hoisted(() => ({ enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => true,
    useChromeConfig: (): ChromeConfig => ({
      enabled: ctl.enabled,
      watermark: ctl.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

const PREVIEW: PostLinkPreview = {
  title: 'Boil water advisory lifted',
  domain: 'fulco.gov',
  imageLabel: 'Advisory graphic',
  imageUrl: '/mock-media/photos/boil-advisory-sign.svg',
}

beforeEach(() => {
  ctl.enabled = true
  ctl.watermark = true
})

describe('PostLinkCard — EXERCISE bands on the preview photo', () => {
  it('marks the photo (top + bottom, inside its frame) when required', () => {
    render(<PostLinkCard linkPreview={PREVIEW} />)

    const frame = screen.getByTestId('post-link-image').parentElement
    if (frame === null) throw new Error('no photo frame')
    expect(within(frame).getByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    expect(within(frame).getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    // The title and domain are untouched.
    expect(screen.getByText('Boil water advisory lifted')).toBeInTheDocument()
  })

  it('renders NO band when not required (watermark off, banner on)', () => {
    ctl.watermark = false
    render(<PostLinkCard linkPreview={PREVIEW} />)

    expect(screen.getByTestId('post-link-image')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })

  it('marks it when the chrome is off even with the watermark switch off', () => {
    ctl.enabled = false
    ctl.watermark = false
    render(<PostLinkCard linkPreview={PREVIEW} />)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('puts no bands on the text-label fallback (no image, or one that failed)', () => {
    const { imageUrl: _imageUrl, ...noImage } = PREVIEW
    const { unmount } = render(<PostLinkCard linkPreview={noImage} />)
    expect(screen.getByText('Advisory graphic')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
    unmount()

    render(<PostLinkCard linkPreview={PREVIEW} />)
    fireEvent.error(screen.getByTestId('post-link-image'))
    expect(screen.getByText('Advisory graphic')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })
})
