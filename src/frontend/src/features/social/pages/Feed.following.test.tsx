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
 *  - with an EMPTY follow set the live pill still never appears, because every
 *    arrival is by definition unfollowed (feeds-discovery/08 made the stream
 *    follow-aware rather than disabled; this file keeps the empty-set corner of
 *    that honest, and `Feed.followingStream.test.tsx` owns the full suite —
 *    followed arrivals count, unfollowed ones don't, mid-session follows apply).
 */
import { act, render, screen, waitFor } from '@testing-library/react'
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

describe('Feed scope="following" — an EMPTY follow set admits nothing (feeds-discovery/08)', () => {
  it('never shows the "new posts" pill, because every arrival is by an unfollowed account', async () => {
    setMockFollowingForTests([])
    renderFollowingFeed()
    await screen.findByText(/no posts from accounts you follow yet/i)

    expect(screen.queryByTestId('new-posts-pill')).toBeNull()

    act(() => {
      postStore.appendPost(buildLivePost())
    })

    // The stream now RUNS under this scope, but its `admit` predicate rejects
    // every author — so the pill stays absent and no post appears. An empty
    // follow set must never let the firehose in under the Following label.
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
    expect(screen.queryAllByTestId('post-card')).toHaveLength(0)
  })
})
