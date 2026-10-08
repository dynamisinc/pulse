/**
 * features/social/pages/Profile.media.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5): the profile "Media" tab is F2's `<MediaTabGrid>` over the
 * persona's authored media posts — not a list of post cards.
 *
 * `MediaTabGrid` is mocked at its module boundary so this file pins the F2<->F5
 * SEAM (its `{ posts, onOpenPost? }` props) independent of how F2 renders
 * thumbnails: the same assertions hold whether the grid is the F0 stub (renders
 * nothing) or F2's real grid. A separate file because `vi.mock` is hoisted over
 * the whole module and `Profile.test.tsx` mounts the real component.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import type { MediaTabGridProps } from '../components/media/MediaTabGrid'
import { compareNewestFirst } from '../services/feedService'
import { postStore } from '../services/postStore'
import { Profile } from './Profile'

vi.mock('../components/media/MediaTabGrid', () => ({
  MediaTabGrid: ({ posts, onOpenPost }: MediaTabGridProps) => (
    <div data-testid="media-grid-probe" data-post-ids={posts.map(p => p.id).join(',')}>
      {posts.map(p => (
        <button key={p.id} type="button" onClick={() => onOpenPost?.(p.id)}>
          {`open ${p.id}`}
        </button>
      ))}
    </div>
  ),
}))

const NEWSLINE_ID = 'persona-newsline7' // authored media posts (and a reply-free timeline)
const FW_ID = 'persona-fairhavenwater' // authored a post with NO media
const DREYES_ID = 'persona-dreyes_fh' // the mock viewer: text-only posts, plus a reply

function renderProfile(personaId: string, onOpenThread?: (postId: string) => void) {
  // A QueryClient: the Posts tab renders Newsline's video card, and F2's VideoPlayer reads
  // `useChromeConfig()` (React Query) for the exercise watermark.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={personaId} onOpenThread={onOpenThread} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  postStore.resetForTests()
  vi.restoreAllMocks()
})

describe('Profile — Media tab (F2 <MediaTabGrid> over authored media posts)', () => {
  it('hands the grid exactly the persona’s authored posts that carry media', async () => {
    const user = userEvent.setup()
    renderProfile(NEWSLINE_ID)
    await screen.findByRole('heading', { name: 'Newsline 7' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))

    const grid = await screen.findByTestId('media-grid-probe')
    expect(grid).toHaveAttribute('data-post-ids', 'post-seed-newsline7-breaking')
    // It is a grid, not a list of post cards.
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
  })

  it('includes only the viewed persona’s media, newest first (with the demo fixtures)', async () => {
    postStore.resetForTests({ withDemoFixtures: true })
    const user = userEvent.setup()
    renderProfile(NEWSLINE_ID)
    await screen.findByRole('heading', { name: 'Newsline 7' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))

    const grid = await screen.findByTestId('media-grid-probe')
    const ids = (grid.getAttribute('data-post-ids') ?? '').split(',')

    // Expected, derived from the store: Newsline's own top-level posts that carry media.
    const expected = postStore
      .getPosts()
      .filter(p => p.authorPersonaId === NEWSLINE_ID)
      .filter(p => p.inReplyTo === undefined && (p.media?.length ?? 0) > 0)
      .sort((a, b) => compareNewestFirst(a.scenarioTime, b.scenarioTime))
      .map(p => p.id)
    expect(expected.length).toBeGreaterThanOrEqual(3)
    expect(ids).toEqual(expected)
    // Someone else's media post (Fulco's photo) is not in Newsline's grid.
    expect(ids).not.toContain('post-fx-grid1')
  })

  it('forwards onOpenThread as the grid’s onOpenPost, passing the POST id', async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    renderProfile(NEWSLINE_ID, onOpenThread)
    await screen.findByRole('heading', { name: 'Newsline 7' })
    await user.click(screen.getByRole('tab', { name: 'Media' }))

    await user.click(await screen.findByRole('button', { name: 'open post-seed-newsline7-breaking' }))

    expect(onOpenThread).toHaveBeenCalledTimes(1)
    expect(onOpenThread).toHaveBeenCalledWith('post-seed-newsline7-breaking')
  })

  it('shows the calm "No media yet." state instead of mounting an empty grid', async () => {
    const user = userEvent.setup()
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))

    expect(await screen.findByText('No media yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('media-grid-probe')).not.toBeInTheDocument()
  })

  it('excludes replies from Media (a reply’s photo lives under Posts & replies)', async () => {
    postStore.resetForTests({ withDemoFixtures: true })
    const user = userEvent.setup()
    renderProfile(DREYES_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))

    // Dana's posts are text-only; her reply carries no media either.
    expect(await screen.findByText('No media yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('media-grid-probe')).not.toBeInTheDocument()
  })
})
