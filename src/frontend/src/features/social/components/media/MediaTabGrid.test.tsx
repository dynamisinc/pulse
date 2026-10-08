/**
 * features/social/components/media/MediaTabGrid.test.tsx
 * ---------------------------------------------------------------------------
 * The profile Media tab grid (demo-polish F2 content for F5's mount): a
 * 3-column grid of square thumbnails, one per media post — a photo, or a video's
 * poster with a play badge — each a button named by the media's alt text that
 * opens the THREAD (`onOpenPost(postId)`); inert (no focusable no-op) without a
 * handler; nothing at all when no post has media; unsafe URLs never become a src.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle } from '@/features/personas'
import type { PostMedia } from '../../types/post'
import type { PostView } from '../post'
import { MediaTabGrid } from './MediaTabGrid'

function fulcoEm() {
  const persona = personaById(personaIdForHandle('FulcoEM'))
  if (persona === undefined) throw new Error('fixture missing seeded persona')
  return persona
}

function post(id: string, media?: PostMedia[]): PostView {
  return {
    id,
    author: fulcoEm(),
    text: `post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T13:00:00Z',
    ...(media !== undefined ? { media } : {}),
  }
}

const PHOTO: PostMedia = {
  id: 'ph', kind: 'image', url: '/mock-media/photos/flood-main-street.svg',
  alt: 'Floodwater on Main Street', width: 1600, height: 900,
}
const CLIP: PostMedia = {
  id: 'cl', kind: 'video', url: '/mock-media/video/water-update.mp4',
  posterUrl: '/mock-media/video/water-update.poster.svg',
  alt: 'A crew explains the advisory', durationSec: 4,
}

describe('MediaTabGrid', () => {
  it('renders nothing when there are no posts or none carries media', () => {
    expect(render(<MediaTabGrid posts={[]} />).container).toBeEmptyDOMElement()
    expect(render(<MediaTabGrid posts={[post('a'), post('b', [])]} />).container).toBeEmptyDOMElement()
  })

  it('renders one square thumbnail per media post, in order, in a labelled grid', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO]), post('skip'), post('b', [CLIP])]} onOpenPost={vi.fn()} />)

    const grid = screen.getByTestId('media-tab-grid')
    expect(grid).toHaveAccessibleName('Media')
    const tiles = within(grid).getAllByTestId('media-tab-tile')
    expect(tiles.map(t => t.getAttribute('data-post-id'))).toEqual(['a', 'b'])
  })

  it('names every thumbnail by its media alt text', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO]), post('b', [CLIP])]} onOpenPost={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Floodwater on Main Street' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A crew explains the advisory' })).toBeInTheDocument()
  })

  it('shows a photo as an <img>, lazy, with its alt', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} onOpenPost={vi.fn()} />)

    const img = screen.getByAltText('Floodwater on Main Street')
    expect(img).toHaveAttribute('src', PHOTO.url)
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('shows a video\'s poster with a play badge, and says "Video" to assistive tech', () => {
    render(<MediaTabGrid posts={[post('b', [CLIP])]} onOpenPost={vi.fn()} />)

    expect(screen.getByAltText('A crew explains the advisory')).toHaveAttribute('src', CLIP.posterUrl)
    expect(screen.getByTestId('media-tab-play-badge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A crew explains the advisory' }))
      .toHaveAccessibleDescription('Video')
  })

  it('has no play badge on a photo tile', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} onOpenPost={vi.fn()} />)
    expect(screen.queryByTestId('media-tab-play-badge')).not.toBeInTheDocument()
  })

  it('uses a muted first-frame <video> thumbnail (#t=0.1) for a video with no poster', () => {
    const { posterUrl: _poster, ...noPoster } = CLIP
    const { container } = render(<MediaTabGrid posts={[post('b', [noPoster])]} onOpenPost={vi.fn()} />)

    const thumb = container.querySelector('video')
    expect(thumb?.getAttribute('src')).toBe(`${CLIP.url}#t=0.1`)
    expect(thumb?.muted).toBe(true)
    expect(thumb).not.toHaveAttribute('controls')
    expect(screen.getByTestId('media-tab-play-badge')).toBeInTheDocument()
  })

  it('opens the thread (post id) on click and on Enter / Space', async () => {
    const user = userEvent.setup()
    const onOpenPost = vi.fn()
    render(<MediaTabGrid posts={[post('a', [PHOTO]), post('b', [CLIP])]} onOpenPost={onOpenPost} />)

    await user.click(screen.getByRole('button', { name: 'Floodwater on Main Street' }))
    expect(onOpenPost).toHaveBeenLastCalledWith('a')

    // The click focused the first tile; one Tab reaches the second.
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onOpenPost).toHaveBeenLastCalledWith('b')
    await user.keyboard(' ')
    expect(onOpenPost).toHaveBeenCalledTimes(3)
  })

  it('renders inert labelled boxes (no focusable no-op) when nothing is wired to open', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Floodwater on Main Street' }).length).toBeGreaterThan(0)
  })

  it.each([
    ['an image', { ...PHOTO, url: 'javascript:alert(1)' }],
    ['a video poster + url', { ...CLIP, url: 'data:video/mp4;base64,AAAA', posterUrl: '//evil.example.net/p.png' }],
  ])('drops unsafe urls for %s and shows the alt-text placeholder', (_label, media) => {
    const { container } = render(<MediaTabGrid posts={[post('a', [media])]} onOpenPost={vi.fn()} />)

    expect(container.querySelector('[src]')).toBeNull()
    expect(screen.getByTestId('media-fallback')).toHaveTextContent(media.alt)
  })

  it('renders a legacy { kind, alt } post (no url) as a labelled placeholder tile', () => {
    const legacy = { id: 'old', kind: 'image', alt: 'Photo of flooded Main Street' } as PostMedia
    render(<MediaTabGrid posts={[post('a', [legacy])]} onOpenPost={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Photo of flooded Main Street' })).toBeInTheDocument()
  })
})
