/**
 * features/social/pages/Profile.mediaSmoke.test.tsx
 * ---------------------------------------------------------------------------
 * Unmocked smoke test for the profile Media tab (demo-polish F5 + F2): the page
 * mounts F2's REAL `<MediaTabGrid>`, so the whole seam is exercised end to end —
 * the persona's authored media posts become square thumbnails named by their alt
 * text, and activating one opens that POST's thread. (`Profile.media.test.tsx`
 * mocks the grid to pin the props contract in isolation; this file proves the real
 * component honours it.)
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { compareNewestFirst } from '../services/feedService'
import { postStore } from '../services/postStore'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { Profile } from './Profile'

const NEWSLINE_ID = 'persona-newsline7'

function renderProfile(onOpenThread: (postId: string) => void) {
  // A QueryClient: the Posts tab (the default) renders Newsline's video card, and F2's
  // VideoPlayer reads `useChromeConfig()` (React Query) for the exercise watermark.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <SocialDirectoryProvider>
              <Profile personaId={NEWSLINE_ID} onOpenThread={onOpenThread} />
            </SocialDirectoryProvider>
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests({ withDemoFixtures: true })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  postStore.resetForTests()
  vi.restoreAllMocks()
})

describe('Profile Media tab with the real <MediaTabGrid>', () => {
  it('renders the persona’s media posts as alt-named thumbnails, newest first, not as cards', async () => {
    const user = userEvent.setup()
    renderProfile(vi.fn())
    await screen.findByRole('heading', { name: 'Newsline 7' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))

    const grid = await screen.findByTestId('media-tab-grid')
    const expected = postStore
      .getPosts()
      .filter(p => p.authorPersonaId === NEWSLINE_ID)
      .filter(p => p.inReplyTo === undefined && (p.media?.length ?? 0) > 0)
      .sort((a, b) => compareNewestFirst(a.scenarioTime, b.scenarioTime))
    expect(expected.length).toBeGreaterThanOrEqual(3)
    const tiles = within(grid).getAllByTestId('media-tab-tile')
    expect(tiles.map(t => t.getAttribute('data-post-id'))).toEqual(expected.map(p => p.id))
    // Every thumbnail is named by its media's alt text (NFR-001).
    for (const post of expected) {
      const alt = post.media?.[0]?.alt
      expect(alt).toBeTruthy()
      expect(within(grid).getByRole('button', { name: alt })).toBeInTheDocument()
    }
    // A grid of thumbnails, not a list of post cards.
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
  })

  it('opens the POST’s thread when a thumbnail is activated', async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    renderProfile(onOpenThread)
    await screen.findByRole('heading', { name: 'Newsline 7' })
    await user.click(screen.getByRole('tab', { name: 'Media' }))
    const grid = await screen.findByTestId('media-tab-grid')
    const [firstTile] = within(grid).getAllByTestId('media-tab-tile')
    if (!firstTile) throw new Error('expected a thumbnail')
    const postId = firstTile.getAttribute('data-post-id')

    await user.click(firstTile)

    expect(onOpenThread).toHaveBeenCalledTimes(1)
    expect(onOpenThread).toHaveBeenCalledWith(postId)
  })
})
