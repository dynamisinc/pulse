/**
 * features/social/components/media/MediaTabGrid.bands.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06 (DF-4): the profile Media tab marks its thumbnails. A photo, a
 * video poster and a video first frame each carry a top + bottom EXERCISE band when
 * the exercise requires marking, none otherwise; the alt-text placeholder never does.
 * The tile keeps its alt-text name, its "Video" description and play badge, and opens
 * the post as before.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { personaById, personaIdForHandle } from '@/features/personas'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PostMedia } from '../../types/post'
import type { PostView } from '../post'
import { MediaTabGrid } from './MediaTabGrid'

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

function post(id: string, media: PostMedia[]): PostView {
  const persona = personaById(personaIdForHandle('FulcoEM'))
  if (persona === undefined) throw new Error('fixture missing seeded persona')
  return {
    id,
    author: persona,
    text: `post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T13:00:00Z',
    media,
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
const { posterUrl: _poster, ...CLIP_NO_POSTER } = { ...CLIP, id: 'np', alt: 'A clip without a poster' }

beforeEach(() => {
  ctl.enabled = true
  ctl.watermark = true
})

describe('MediaTabGrid — EXERCISE bands', () => {
  it('marks a photo, a video poster and a video first frame (top + bottom each)', () => {
    render(
      <MediaTabGrid
        posts={[post('a', [PHOTO]), post('b', [CLIP]), post('c', [CLIP_NO_POSTER])]}
        onOpenPost={vi.fn()}
      />,
    )

    const tiles = screen.getAllByTestId('media-tab-tile')
    expect(tiles).toHaveLength(3)
    for (const tile of tiles) {
      expect(within(tile).getByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
      expect(within(tile).getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    }
  })

  it('keeps the tile name, the "Video" description and the play badge on a marked video', () => {
    render(<MediaTabGrid posts={[post('b', [CLIP])]} onOpenPost={vi.fn()} />)

    const tile = screen.getByRole('button', { name: 'A crew explains the advisory' })
    expect(tile).toHaveAccessibleDescription('Video')
    expect(within(tile).getByTestId('media-tab-play-badge')).toBeInTheDocument()
    expect(within(tile).getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('still opens the post through the bands', async () => {
    const user = userEvent.setup()
    const onOpenPost = vi.fn()
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} onOpenPost={onOpenPost} />)

    await user.click(screen.getByRole('button', { name: 'Floodwater on Main Street' }))
    expect(onOpenPost).toHaveBeenCalledWith('a')
  })

  it('marks inert tiles (no onOpenPost) too', () => {
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} />)

    // The inert tile is a `role="img"` box named by the alt (the <img> inside shares the name).
    const tile = screen.getAllByRole('img', { name: 'Floodwater on Main Street' })
      .find(el => el.tagName === 'DIV')
    if (tile === undefined) throw new Error('no inert tile')
    expect(within(tile).getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('renders NO band when not required (watermark off, banner on)', () => {
    ctl.watermark = false
    render(<MediaTabGrid posts={[post('a', [PHOTO]), post('b', [CLIP])]} onOpenPost={vi.fn()} />)

    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })

  it('draws them when the chrome is off even with the watermark switch off', () => {
    ctl.enabled = false
    ctl.watermark = false
    render(<MediaTabGrid posts={[post('a', [PHOTO])]} onOpenPost={vi.fn()} />)

    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('gives the alt-text placeholder (no media shown) no bands', () => {
    render(
      <MediaTabGrid posts={[post('a', [{ ...PHOTO, url: 'javascript:alert(1)' }])]} onOpenPost={vi.fn()} />,
    )

    expect(screen.getByTestId('media-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })
})
