/**
 * features/social/components/media/MediaGrid.test.tsx
 * ---------------------------------------------------------------------------
 * The image grid (demo-polish F2): the 1/2/3/4 layout matrix incl. a portrait,
 * the no-layout-shift aspect ratio from width/height (16:9 fallback, 4:5...16:9
 * clamp), `loading="lazy"`, a non-empty `alt` on EVERY `<img>`, the on-error
 * alt-text tile, the NFR-004 unsafe-URL fallback (a rejected URL never becomes a
 * `src`), the legacy `{kind, alt}` item with no url, and activation (stops
 * propagation so a tap never opens the thread; hands the viewer its trigger).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PostMedia } from '../../types/post'
import { MediaGrid } from './MediaGrid'

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

/** The frame's reserved ratio (jsdom serialises `aspect-ratio: 1.5` as "1.5 / 1"). */
function reservedRatio(el: HTMLElement): number {
  const [numerator, denominator = '1'] = el.style.aspectRatio.split('/')
  return Number(numerator) / Number(denominator)
}

const photos = (count: number): PostMedia[] =>
  Array.from({ length: count }, (_unused, i) => image(i + 1))

describe('MediaGrid — layouts', () => {
  it.each([1, 2, 3, 4])('renders %s image(s) in the %s-up layout, one <img> each', count => {
    render(<MediaGrid media={photos(count)} />)

    const grid = screen.getByTestId('media-grid')
    expect(grid).toHaveAttribute('data-count', String(count))
    expect(within(grid).getAllByRole('img')).toHaveLength(count)
  })

  it('renders nothing for an empty list', () => {
    expect(render(<MediaGrid media={[]} />).container).toBeEmptyDOMElement()
  })

  it('shows at most four images (the contract caps a post at 4)', () => {
    render(<MediaGrid media={photos(6)} />)
    expect(screen.getByTestId('media-grid')).toHaveAttribute('data-count', '4')
    expect(screen.getAllByRole('img')).toHaveLength(4)
  })

  it('lays a portrait-led 3-up grid out the same 16:9 frame (the first tile spans both rows)', () => {
    render(
      <MediaGrid
        media={[image(1, { width: 800, height: 1200 }), image(2), image(3)]}
      />,
    )
    const grid = screen.getByTestId('media-grid')
    expect(grid).toHaveAttribute('data-count', '3')
    // Multi-image frames are a fixed 16:9 in CSS; only the single-image frame is inline-sized.
    expect(grid.style.aspectRatio).toBe('')
  })
})

describe('MediaGrid — aspect ratio (no layout shift)', () => {
  it('reserves the natural ratio of a single landscape image before it loads', () => {
    render(<MediaGrid media={[image(1, { width: 1200, height: 800 })]} />)
    expect(reservedRatio(screen.getByTestId('media-grid'))).toBeCloseTo(1.5)
  })

  it('clamps a single tall portrait to 4:5', () => {
    render(<MediaGrid media={[image(1, { width: 800, height: 1200 })]} />)
    expect(reservedRatio(screen.getByTestId('media-grid'))).toBeCloseTo(0.8)
  })

  it('clamps a single panorama to 16:9', () => {
    render(<MediaGrid media={[image(1, { width: 4000, height: 1000 })]} />)
    expect(reservedRatio(screen.getByTestId('media-grid'))).toBeCloseTo(16 / 9)
  })

  it('falls back to 16:9 without width/height', () => {
    const { width: _w, height: _h, ...bare } = image(1)
    render(<MediaGrid media={[bare]} />)
    expect(reservedRatio(screen.getByTestId('media-grid'))).toBeCloseTo(16 / 9)
  })
})

describe('MediaGrid — every <img>', () => {
  it('is lazy-loaded and carries the contract alt', () => {
    render(<MediaGrid media={photos(4)} />)

    for (const [i, img] of screen.getAllByRole('img').entries()) {
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(img).toHaveAttribute('alt', `Photo ${i + 1} of the flooded street`)
      expect(img.getAttribute('src')).toBe(`/mock-media/photos/p${i + 1}.svg`)
    }
  })

  it('never renders an empty alt, even for a blank contract alt', () => {
    render(<MediaGrid media={[image(1, { alt: '' }), image(2, { alt: '   ' })]} />)

    for (const img of screen.getAllByRole('img')) {
      expect(img.getAttribute('alt')?.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('MediaGrid — error tile', () => {
  it('swaps a failed <img> for a tile showing its alt text (not a broken-image icon)', () => {
    render(<MediaGrid media={photos(2)} />)
    const [first] = screen.getAllByRole('img')
    if (first === undefined) throw new Error('no image')

    fireEvent.error(first)

    const tile = screen.getByTestId('media-fallback')
    expect(tile).toHaveTextContent('Photo 1 of the flooded street')
    expect(tile).toHaveAccessibleName('Photo 1 of the flooded street')
    // The other image is untouched.
    expect(screen.getByAltText('Photo 2 of the flooded street')).toBeInTheDocument()
    expect(screen.queryByAltText('Photo 1 of the flooded street')).not.toBeInTheDocument()
  })
})

describe('MediaGrid — safe URLs only (NFR-004)', () => {
  const unsafe = [
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.net/a.png',
    'http://example.org/a.png',
    'https://user:pw@example.org/a.png',
    '',
  ]

  it.each(unsafe)('drops %j and shows the alt-text placeholder instead', url => {
    const { container } = render(<MediaGrid media={[image(1, { url })]} onOpen={vi.fn()} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    expect(screen.getByTestId('media-fallback')).toHaveTextContent('Photo 1 of the flooded street')
    // A placeholder is not an activatable tile.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('accepts https, a same-origin path and a blob: URL', () => {
    render(
      <MediaGrid
        media={[
          image(1, { url: 'https://store.blob.core.windows.net/m/a.jpg?sig=x' }),
          image(2, { url: '/mock-media/photos/b.svg' }),
          image(3, { url: 'blob:http://localhost/1234-5678' }),
        ]}
      />,
    )
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.queryByTestId('media-fallback')).not.toBeInTheDocument()
  })

  it('renders a legacy { kind, alt } item (no url) as the accessible placeholder', () => {
    const legacy = { id: 'old', kind: 'image', alt: 'Photo of flooded Main Street' } as PostMedia
    render(<MediaGrid media={[legacy]} onOpen={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Photo of flooded Main Street' })).toBeInTheDocument()
    expect(screen.getByTestId('media-fallback')).toHaveTextContent('Photo of flooded Main Street')
  })
})

describe('MediaGrid — activation', () => {
  it('renders each image in a button named by its alt, and opens with the item + trigger', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<MediaGrid media={photos(3)} onOpen={onOpen} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[1]).toHaveAccessibleName('Photo 2 of the flooded street')

    await user.click(buttons[1] as HTMLElement)

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(photos(3)[1], buttons[1])
  })

  it('is operable from the keyboard (Enter and Space on a focused tile)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<MediaGrid media={photos(2)} onOpen={onOpen} />)

    await user.tab()
    expect(screen.getAllByRole('button')[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('stops click propagation so a tap never also opens the thread', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <MediaGrid media={photos(1)} onOpen={vi.fn()} />
      </div>,
    )

    await user.click(screen.getByRole('button'))

    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('renders inert images (no buttons) when nothing is wired to open them', () => {
    render(<MediaGrid media={photos(2)} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
