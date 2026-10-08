/**
 * features/social/pages/HashtagFeed.states.test.tsx
 * ---------------------------------------------------------------------------
 * The hashtag page's loading / error / soft-deleted states (demo-polish F6,
 * NFR-001, SOC-041): the header never claims "0 posts" before the posts are in or
 * after a failed read, the states are plain text, and a soft-deleted (taken-down)
 * post is neither listed nor counted. `useFeed` is stubbed so each state is
 * deterministic.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { SEEDED_PERSONAS, toParticipantPersona } from '@/features/personas'
import type { UseFeedResult } from '../hooks/useFeed'
import { HashtagFeed } from './HashtagFeed'

const feedState: { current: UseFeedResult } = {
  current: { posts: [], loading: false, error: undefined },
}

vi.mock('../hooks/useFeed', () => ({
  useFeed: () => feedState.current,
}))

const AUTHOR = (() => {
  const seeded = SEEDED_PERSONAS.find(p => p.handle === 'FairhavenWater')
  if (seeded === undefined) throw new Error('seeded persona missing')
  return toParticipantPersona(seeded)
})()

function view(id: string, text: string, extra: object = {}): UseFeedResult['posts'][number] {
  return {
    id,
    author: AUTHOR,
    text,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T12:00:00Z',
    ...extra,
  }
}

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          <HashtagFeed tag="statetag" />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  feedState.current = { posts: [], loading: false, error: undefined }
})

describe('HashtagFeed — states', () => {
  it('shows no count (and "Loading posts…") while loading — never "0 posts"', async () => {
    feedState.current = { posts: [], loading: true, error: undefined }
    renderFeed()

    expect(await screen.findByRole('heading', { name: '#statetag' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading posts…')
    expect(screen.queryByTestId('hashtag-post-count')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hashtag-empty')).not.toBeInTheDocument()
  })

  it('shows no count and says so in text when the posts cannot be read', async () => {
    feedState.current = { posts: [], loading: false, error: new Error('boom') }
    renderFeed()

    expect(await screen.findByRole('status')).toHaveTextContent('Posts aren’t available right now.')
    expect(screen.queryByTestId('hashtag-post-count')).not.toBeInTheDocument()
    // An outage is not an empty hashtag.
    expect(screen.queryByTestId('hashtag-empty')).not.toBeInTheDocument()
  })

  it('neither lists nor counts a soft-deleted post', async () => {
    feedState.current = {
      posts: [
        view('live-1', 'visible #statetag'),
        view('gone-1', 'removed #statetag', { status: 'taken-down' }),
      ],
      loading: false,
      error: undefined,
    }
    renderFeed()

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.map(card => card.getAttribute('data-post-id'))).toEqual(['live-1'])
    expect(screen.getByTestId('hashtag-post-count')).toHaveTextContent('1 post')
  })

  it('shows the empty state when the only tagged post is soft-deleted', async () => {
    feedState.current = {
      posts: [view('gone-2', 'removed #statetag', { status: 'taken-down' })],
      loading: false,
      error: undefined,
    }
    renderFeed()

    expect(await screen.findByTestId('hashtag-empty')).toHaveTextContent(
      'No posts with #statetag yet.',
    )
  })
})
