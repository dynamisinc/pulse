/**
 * features/social/pages/Feed.following.test.tsx
 * ---------------------------------------------------------------------------
 * Covers `<Feed scope="following">` (feature: feeds-discovery, story 02;
 * SOC-081, COR-053, NFR-001/002), rendered through the REAL provider stack
 * (same pattern as `Feed.test.tsx`) with the default mock session (a named,
 * writable participant — Dana Reyes, `persona-dreyes_fh` — so the COR-015
 * guard does NOT force `'all'` here; that guard has its own file,
 * `Feed.followingReadOnlyDefault.test.tsx`):
 *  - only posts from the mock following set render;
 *  - an EMPTY follow set renders an honest, Following-specific empty state —
 *    never the All Posts empty copy, and never any All-Posts-only post;
 *  - the live "new posts" pill never appears under this scope (the stream
 *    isn't follow-aware yet — module header) even after a live arrival.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { setMockFollowingForTests } from '../services/feedService'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

function renderFollowingFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed scope="following" />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

function buildLivePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-live-following',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'a live arrival while viewing Following',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

afterEach(() => {
  resetTelemetryBuffer()
  postStore.resetForTests()
  setMockFollowingForTests(undefined)
})

describe('Feed scope="following" — filters to followed accounts (SOC-081)', () => {
  it('renders ONLY posts from the mock following set, never an unfollowed author', async () => {
    setMockFollowingForTests([personaIdForHandle('FairhavenWater')])
    renderFollowingFeed()

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every(c => c.getAttribute('data-post-id') === 'post-seed-fw-advisory')).toBe(true)
  })
})

describe('Feed scope="following" — honest empty state, never an All Posts fallback (SOC-081)', () => {
  it('shows Following-specific empty copy — NOT the All Posts "No posts yet." wording', async () => {
    setMockFollowingForTests([])
    renderFollowingFeed()

    const empty = await screen.findByText(/no posts from accounts you follow yet/i)
    expect(empty).toBeInTheDocument()
    // Never the All Posts empty copy under this scope.
    expect(screen.queryByText('No posts yet.')).toBeNull()
    // And never any post card — an empty follow set must not silently render
    // the unfiltered firehose under the Following label.
    expect(screen.queryAllByTestId('post-card')).toHaveLength(0)
  })
})

describe('Feed scope="following" — the live pill is inert under this scope', () => {
  it('never shows the "new posts" pill, even after a live arrival', async () => {
    setMockFollowingForTests([personaIdForHandle('FairhavenWater')])
    renderFollowingFeed()
    await screen.findAllByTestId('post-card')

    expect(screen.queryByTestId('new-posts-pill')).toBeNull()

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
  })
})
