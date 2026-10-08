/**
 * features/social/components/post/PostMediaSlot.test.tsx
 * ---------------------------------------------------------------------------
 * The media slot (demo-polish F2) wired end to end: images -> `MediaGrid` ->
 * `MediaViewer` (open on activation, page across the OPENABLE images only, Esc,
 * focus back to the thumbnail); a video -> `VideoPlayer` inline, with the modal
 * viewer as the fullscreen fallback; mixed and legacy `{kind, alt}` items; the
 * unsafe-URL fallback. Rendered under the real shell providers (the player reads
 * `useChromeConfig`), exactly as it is inside a `PostCard`.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PostMedia } from '../../types/post'
import { installMediaElementStubs, renderWithMediaProviders } from '../media/mediaTestUtils'
import { resetPlaybackForTests } from '../media/playbackCoordinator'
import { PostMediaSlot } from './PostMediaSlot'

function image(n: number, overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: `m${n}`,
    kind: 'image',
    url: `/mock-media/photos/p${n}.svg`,
    alt: `Photo ${n}`,
    width: 1200,
    height: 800,
    ...overrides,
  }
}

const CLIP: PostMedia = {
  id: 'clip',
  kind: 'video',
  url: '/mock-media/video/water-update.mp4',
  posterUrl: '/mock-media/video/water-update.poster.svg',
  alt: 'A crew explains the advisory',
  width: 640,
  height: 360,
  durationSec: 24,
}

beforeEach(() => {
  installMediaElementStubs()
  resetPlaybackForTests()
})

async function mount(media: PostMedia[]) {
  const utils = renderWithMediaProviders(<PostMediaSlot postId="p1" media={media} />)
  await screen.findByTestId('post-media')
  return utils
}

describe('PostMediaSlot — images', () => {
  it('renders the grid for photos, each in a button named by its alt', async () => {
    await mount([image(1), image(2), image(3)])

    expect(screen.getByTestId('media-grid')).toHaveAttribute('data-count', '3')
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-haspopup'))).toEqual([
      'dialog', 'dialog', 'dialog',
    ])
    expect(screen.getByRole('button', { name: 'Photo 2' })).toBeInTheDocument()
  })

  it('opens the viewer on the activated photo; Esc closes it and focus returns to that thumbnail', async () => {
    const user = userEvent.setup()
    await mount([image(1), image(2), image(3)])
    const tile = screen.getByRole('button', { name: 'Photo 2' })

    await user.click(tile)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'Photo 2')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tile).toHaveFocus()
  })

  it('pages across the post\'s images with the arrow keys', async () => {
    const user = userEvent.setup()
    await mount([image(1), image(2), image(3)])

    await user.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = screen.getByRole('dialog')
    await user.keyboard('{ArrowRight}{ArrowRight}')

    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'Photo 3')
  })

  it('opens the keyboard way: Tab to a thumbnail, Enter', async () => {
    const user = userEvent.setup()
    await mount([image(1), image(2)])

    await user.tab()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('skips an image with no usable URL when paging (it has no thumbnail button either)', async () => {
    const user = userEvent.setup()
    await mount([image(1), image(2, { url: 'javascript:alert(1)' }), image(3)])

    expect(screen.getAllByRole('button')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Photo 1' }))
    const dialog = screen.getByRole('dialog')
    await user.keyboard('{ArrowRight}')

    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'Photo 3')
    expect(dialog).toHaveTextContent('2 / 2')
  })

  it('renders a legacy { kind, alt } item (no url) as the accessible placeholder, as F0 did', async () => {
    await mount([{ id: 'old', kind: 'image', alt: 'Photo of flooded Main Street' } as PostMedia])

    expect(screen.getByRole('img', { name: 'Photo of flooded Main Street' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keys by media id, so two attachments with the same alt both render', async () => {
    await mount([image(1, { alt: 'Same' }), image(2, { alt: 'Same' })])
    expect(screen.getAllByRole('img', { name: 'Same' })).toHaveLength(2)
  })

  it('caps the grid at four images', async () => {
    await mount([image(1), image(2), image(3), image(4), image(5)])
    expect(screen.getByTestId('media-grid')).toHaveAttribute('data-count', '4')
  })
})

describe('PostMediaSlot — video', () => {
  it('plays inline: a player (not the image grid), named by the alt, with the duration', async () => {
    await mount([CLIP])

    expect(screen.queryByTestId('media-grid')).not.toBeInTheDocument()
    const player = screen.getByRole('group', { name: 'A crew explains the advisory' })
    expect(player.querySelector('video')).toHaveAttribute('controls')
    expect(within(player).getByTestId('video-duration')).toHaveTextContent('0:24')
  })

  it('opens the modal viewer as the Expand fallback and returns focus to the player', async () => {
    const user = userEvent.setup()
    await mount([CLIP])
    const player = screen.getByRole('group', { name: 'A crew explains the advisory' })

    // jsdom has no Fullscreen API, so Expand takes the modal fallback.
    await user.click(within(player).getByRole('button', { name: 'Expand' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('group', { name: 'A crew explains the advisory' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('media-watermark-slot')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(player).toHaveFocus()
  })

  it('renders a mixed post (grid first, then the player) rather than failing', async () => {
    await mount([image(1), CLIP])

    expect(screen.getByTestId('media-grid')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'A crew explains the advisory' })).toBeInTheDocument()
  })

  it('shows the alt-text placeholder for a video with an unsafe URL', async () => {
    await mount([{ ...CLIP, url: 'javascript:alert(1)' }])

    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByTestId('media-fallback')).toHaveTextContent('A crew explains the advisory')
  })
})

describe('PostMediaSlot — empty', () => {
  it('renders nothing for undefined or empty media', () => {
    // No providers on purpose: with nothing to show the slot touches no context at all.
    expect(render(<PostMediaSlot postId="p" />).container).toBeEmptyDOMElement()
    expect(render(<PostMediaSlot postId="p" media={[]} />).container).toBeEmptyDOMElement()
  })
})
