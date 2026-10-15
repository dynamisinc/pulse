/**
 * features/social/components/media/MediaGrid.bands.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06 (DF-4): the feed and thread image tiles carry the EXERCISE bands.
 * Every tile that SHOWS a picture gets a top + bottom band when the exercise requires
 * marking (driven through the real `isWatermarkRequired`), none otherwise, and the
 * alt-text placeholder (no media) never does. The bands change nothing else: the tile
 * keeps its alt-text name, stays activatable by mouse and keyboard, and the frame's
 * reserved aspect ratio is identical either way (no layout shift).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PostMedia } from '../../types/post'
import { MediaGrid } from './MediaGrid'

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

function image(n: number, overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: `m${n}`,
    kind: 'image',
    url: `/mock-media/photos/p${n}.svg`,
    alt: `Photo ${n} of the flooded street`,
    width: 1600,
    height: 900,
    ...overrides,
  }
}

const photos = (count: number): PostMedia[] =>
  Array.from({ length: count }, (_unused, i) => image(i + 1))

beforeEach(() => {
  ctl.enabled = true
  ctl.watermark = true
})

describe('MediaGrid — EXERCISE bands', () => {
  it.each([1, 2, 3, 4])('puts a top AND a bottom band on each of %s tile(s) when required', count => {
    render(<MediaGrid media={photos(count)} onOpen={vi.fn()} />)

    const tiles = screen.getAllByTestId('media-tile')
    expect(tiles).toHaveLength(count)
    for (const tile of tiles) {
      expect(within(tile).getByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
      expect(within(tile).getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    }
  })

  it('marks inert (non-activatable) tiles too', () => {
    render(<MediaGrid media={photos(2)} />)

    expect(screen.getAllByTestId('exercise-bands')).toHaveLength(2)
  })

  it('draws them when the chrome is off even with the watermark switch off', () => {
    ctl.enabled = false
    ctl.watermark = false
    render(<MediaGrid media={photos(2)} onOpen={vi.fn()} />)

    expect(screen.getAllByTestId('exercise-bands')).toHaveLength(2)
  })

  it('renders NO band when not required (watermark off, banner on)', () => {
    ctl.watermark = false
    render(<MediaGrid media={photos(4)} onOpen={vi.fn()} />)

    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
    expect(screen.queryByText('EXERCISE EXERCISE EXERCISE')).not.toBeInTheDocument()
  })

  it('shifts nothing: the frame, its ratio and the tiles are the same with or without bands', () => {
    ctl.watermark = false
    const { rerender } = render(<MediaGrid media={[image(1, { width: 800, height: 1000 })]} />)
    const grid = screen.getByTestId('media-grid')
    const styleOff = grid.getAttribute('style')
    const img = screen.getByRole('img')

    ctl.watermark = true
    rerender(<MediaGrid media={[image(1, { width: 800, height: 1000 })]} />)

    expect(screen.getByTestId('media-grid')).toBe(grid)
    expect(grid.getAttribute('style')).toBe(styleOff)
    expect(screen.getByRole('img')).toBe(img)
    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('keeps each tile named by its alt text and activatable (click and keyboard)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<MediaGrid media={photos(2)} onOpen={onOpen} />)

    const second = screen.getByRole('button', { name: 'Photo 2 of the flooded street' })
    await user.click(second)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }), second)

    screen.getByRole('button', { name: 'Photo 1 of the flooded street' }).focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm1' }), expect.anything())
  })

  it('gives the alt-text placeholder (no media shown) no bands', () => {
    render(<MediaGrid media={[image(1, { url: 'javascript:alert(1)' }), image(2)]} onOpen={vi.fn()} />)

    expect(screen.getByTestId('media-fallback')).toBeInTheDocument()
    expect(within(screen.getByTestId('media-fallback')).queryByTestId('exercise-bands')).toBeNull()
    expect(screen.getAllByTestId('exercise-bands')).toHaveLength(1)
  })
})
