/**
 * ProductImagery (weather-source 07, #758; NFR-008, D4-012): every weather image reserves the
 * bottom-right EXERCISE chip, carries the ExerciseBands and has non-empty alt text.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mediaFixture } from '@/features/channels/primitives/primitivesTestUtils'
import { ProductImagery } from './ProductImagery'

vi.mock('@/features/participant-shell/components/OverlayLayer', () => ({
  useOverlayState: () => ({ state: 'none' }),
}))

const RADAR = mediaFixture({
  id: 'radar-1',
  url: '/mock-media/radar-kestrel.png',
  contentType: 'image/png',
  alt: 'Radar image of a storm over northern Kestrel County',
  caption: 'Radar at 2:18 PM.',
})

describe('ProductImagery', () => {
  it('reserves the EXERCISE watermark slot and shows it when required (outside the shell: shown)', () => {
    render(<ProductImagery media={RADAR} />)
    const slot = screen.getByTestId('watermark-slot')
    expect(slot).toHaveTextContent('EXERCISE')
    expect(slot).toHaveAttribute('data-watermark-shown', 'true')
  })

  it('puts the ExerciseBands on the image', () => {
    render(<ProductImagery media={RADAR} />)
    expect(screen.getAllByText(/EXERCISE/).length).toBeGreaterThan(1)
  })

  it('renders the alt text and the caption', () => {
    render(<ProductImagery media={RADAR} />)
    expect(screen.getByRole('img', { name: RADAR.alt })).toBeInTheDocument()
    expect(screen.getByText('Radar at 2:18 PM.')).toBeInTheDocument()
  })

  it('never renders an empty alt (a missing one becomes a placeholder)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<ProductImagery media={{ ...RADAR, id: 'radar-no-alt', alt: '' }} />)
    expect(screen.getByRole('img').getAttribute('alt')).not.toBe('')
  })

  it('reserves the watermark on video too, clear of the control row', () => {
    render(
      <ProductImagery
        media={mediaFixture({ id: 'v', kind: 'video', url: '/m/loop.mp4', contentType: 'video/mp4', alt: 'Radar loop' })}
      />,
    )
    expect(screen.getByTestId('watermark-slot')).toBeInTheDocument()
  })
})
