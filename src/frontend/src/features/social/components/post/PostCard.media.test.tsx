/**
 * features/social/components/post/PostCard.media.test.tsx
 * ---------------------------------------------------------------------------
 * The media slot INSIDE the real `<PostCard>` (demo-polish F2): the headline demo
 * behaviour. A video plays inline from the post and a photo opens the viewer,
 * and NEITHER also opens the thread — while a tap on the card body still does.
 *
 * jsdom does no hit-testing and does not process CSS Modules, so the z-index tier
 * itself (slot wrapper `position: relative; z-index: 2; pointer-events: none`,
 * above the card's `z-index: 1` overlay; each interactive tile/player turns
 * pointer events back on) is pinned in the stylesheets' own comments and verified
 * in a browser; here the DOM contract is pinned: every interactive control stops
 * click propagation, and the card body still opens the thread.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaById, personaIdForHandle } from '@/features/personas'
import { installMediaElementStubs } from '../media/mediaTestUtils'
import { resetPlaybackForTests } from '../media/playbackCoordinator'
import { PostCard } from './PostCard'
import type { PostView } from './types'

function fulcoEm() {
  const persona = personaById(personaIdForHandle('FulcoEM'))
  if (persona === undefined) throw new Error('fixture missing seeded persona')
  return persona
}

function buildPost(overrides: Partial<PostView> = {}): PostView {
  return {
    id: 'post-media-1',
    author: fulcoEm(),
    text: 'Crews are on scene.',
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T13:00:00Z',
    ...overrides,
  }
}

const PHOTOS = [
  { id: 'a', kind: 'image' as const, url: '/mock-media/photos/a.svg', alt: 'Photo A', width: 1200, height: 800 },
  { id: 'b', kind: 'image' as const, url: '/mock-media/photos/b.svg', alt: 'Photo B', width: 1200, height: 800 },
]

const CLIP = {
  id: 'clip',
  kind: 'video' as const,
  url: '/mock-media/video/water-update.mp4',
  alt: 'A crew explains the advisory',
  durationSec: 4,
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>{children}</SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )
}

async function renderCard(post: PostView, onOpen = vi.fn()) {
  render(
    <Providers>
      <PostCard post={post} onOpen={onOpen} />
    </Providers>,
  )
  await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())
  return onOpen
}

beforeEach(() => {
  installMediaElementStubs()
  resetPlaybackForTests()
})

describe('PostCard — video plays inline and does not open the thread', () => {
  it('plays from the card, and no control in the player opens the thread', async () => {
    const user = userEvent.setup()
    const onOpen = await renderCard(buildPost({ media: [CLIP] }))
    const player = screen.getByRole('group', { name: CLIP.alt })

    await user.click(within(player).getByRole('button', { name: 'Play' }))
    await user.click(within(player).getByRole('button', { name: 'Mute' }))
    await user.click(within(player).getByRole('button', { name: 'Expand' }))
    await user.click(player)

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('still opens the thread from the card body (the overlay is intact)', async () => {
    const user = userEvent.setup()
    const onOpen = await renderCard(buildPost({ media: [CLIP] }))

    await user.click(screen.getByTestId('post-open-target'))

    expect(onOpen).toHaveBeenCalledWith('post-media-1')
  })
})

describe('PostCard — a photo opens the viewer, not the thread', () => {
  it('opens the lightbox on the tile, leaves the thread closed, and returns focus on Esc', async () => {
    const user = userEvent.setup()
    const onOpen = await renderCard(buildPost({ media: PHOTOS }))
    const tile = screen.getByRole('button', { name: 'Photo B' })

    await user.click(tile)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tile).toHaveFocus()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not trigger the card\'s open handler from inside the viewer either', async () => {
    const user = userEvent.setup()
    const onOpen = await renderCard(buildPost({ media: PHOTOS }))

    await user.click(screen.getByRole('button', { name: 'Photo A' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('img', { name: 'Photo A' }))
    await user.click(screen.getByTestId('media-viewer-next'))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpen).not.toHaveBeenCalled()
  })
})
