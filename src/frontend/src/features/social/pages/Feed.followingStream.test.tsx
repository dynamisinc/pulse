/**
 * features/social/pages/Feed.followingStream.test.tsx
 * ---------------------------------------------------------------------------
 * The follow-aware live stream under `<Feed scope="following">` (feature:
 * feeds-discovery, story 08 "follow-aware feed stream", #91/relates #121;
 * SOC-081, SOC-083, D1-005/011, NFR-001).
 *
 * THE DEFECT THIS FILE EXISTS FOR. The Following feed used to switch the live
 * stream (and its "▲ N new posts" pill) OFF entirely, because the stream source
 * is author-agnostic and a Following-labelled pill counting unfollowed accounts'
 * posts would be a lie. The result was a Following feed that never moved and
 * never said so. The stream is now enabled under Following and FILTERED by the
 * viewer's followed set, so:
 *  - an arrival from a FOLLOWED account increments the pill, and tapping it
 *    shows exactly that post;
 *  - an arrival from an UNFOLLOWED account is never counted and never shown —
 *    the assertion the whole change exists for;
 *  - the pill's count always drains to exactly that many visible posts;
 *  - an account followed MID-SESSION starts being admitted on its next post,
 *    with no remount;
 *  - an observer/read-only mount still gets no pill at all (D1-011).
 *
 * Rendered through the real provider stack every other `<Feed>` suite uses
 * (ExerciseContext + Session + ShellContext + the shipped mock adapters), so the
 * whole chain — `followEdgeStore` → `resolveFollowing` → `useFollowedSet` →
 * `useFeedStream`'s `admit` → `<NewPostsPill>` → drain/prepend — is exercised end
 * to end. The mock session's bound persona IS `MOCK_VIEWER_PERSONA_ID`
 * (`persona-dreyes_fh`), so the follow edges these tests write are the viewer's
 * own.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { setMockFollowingForTests } from '../services/feedService'
import { followPersona, resetMockFollowEdges } from '../services/followService'
import { postStore } from '../services/postStore'
import { Feed } from './Feed'

const FOLLOWED_AUTHOR = personaIdForHandle('FairhavenWater')
const UNFOLLOWED_AUTHOR = personaIdForHandle('FulcoEM')

/**
 * A live arrival. Both authors below are SEEDED cast members, so a post that
 * fails to appear can only be the follow filter's doing — never the feed's
 * "unknown author → skip" path.
 */
function buildLivePost(id: string, authorPersonaId: string): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId,
    actingHumanId: 'human-simcell-utility',
    text: `live arrival ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    // Newer than every seeded post (max seed = 2033-09-04T14:20:00Z) → top.
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
  }
}

function renderFollowingFeed(variant: ShellVariant = 'full') {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed scope="following" />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** The post ids currently rendered in the reading stream. */
function renderedPostIds(): (string | null)[] {
  return screen.queryAllByTestId('post-card').map(c => c.getAttribute('data-post-id'))
}

beforeEach(() => {
  resetTelemetryBuffer()
  // The viewer follows exactly ONE account for these specs.
  setMockFollowingForTests([FOLLOWED_AUTHOR])
  // jsdom has no scrollIntoView; <Feed> guards on its presence, but define it so
  // the load path runs the same branch it runs in a browser.
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  postStore.resetForTests()
  resetMockFollowEdges()
  resetTelemetryBuffer()
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('Feed scope="following" — a FOLLOWED account\'s arrival reaches the reader', () => {
  it('increments the pill, and tapping it shows that post at the top', async () => {
    renderFollowingFeed()
    // Awaiting the baseline also guarantees the followed set has resolved (both
    // reads are issued in the same mount commit and settle together).
    await screen.findAllByTestId('post-card')
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()

    act(() => {
      postStore.appendPost(buildLivePost('post-live-followed', FOLLOWED_AUTHOR))
    })

    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('1 new post')
    // Still buffered — the reading stream is untouched until the reader taps (AC1).
    expect(renderedPostIds()).not.toContain('post-live-followed')

    fireEvent.click(pill)

    await waitFor(() => expect(renderedPostIds()[0]).toBe('post-live-followed'))
    expect(screen.queryByTestId('new-posts-pill')).toBeNull()
  })
})

describe('Feed scope="following" — an UNFOLLOWED account\'s arrival is never counted', () => {
  it('shows no pill at all, and the post never enters the feed', async () => {
    renderFollowingFeed()
    const before = await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(buildLivePost('post-live-unfollowed', UNFOLLOWED_AUTHOR))
    })

    // Rejected at the buffer boundary: nothing counted, so no pill ever appears…
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
    // …and the reading stream is byte-for-byte what it was.
    expect(renderedPostIds()).toEqual(before.map(c => c.getAttribute('data-post-id')))
    expect(renderedPostIds()).not.toContain('post-live-unfollowed')
  })

  it('the count matches the drain exactly when both kinds arrive together', async () => {
    renderFollowingFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(buildLivePost('post-live-mixed-a', FOLLOWED_AUTHOR))
      postStore.appendPost(buildLivePost('post-live-mixed-b', UNFOLLOWED_AUTHOR))
      postStore.appendPost(buildLivePost('post-live-mixed-c', FOLLOWED_AUTHOR))
    })

    // 3 arrived, 2 admitted — the pill promises 2, not 3.
    const pill = await screen.findByTestId('new-posts-pill')
    expect(pill).toHaveTextContent('2 new posts')

    fireEvent.click(pill)

    // …and exactly those 2 become visible; the unfollowed one never does.
    await waitFor(() => expect(renderedPostIds()).toContain('post-live-mixed-a'))
    expect(renderedPostIds()).toContain('post-live-mixed-c')
    expect(renderedPostIds()).not.toContain('post-live-mixed-b')
  })
})

describe('Feed scope="following" — a follow made MID-SESSION takes effect without a remount', () => {
  it('admits the newly-followed account\'s next arrival (and does not resurrect its earlier one)', async () => {
    renderFollowingFeed()
    await screen.findAllByTestId('post-card')

    // Before the follow: an arrival from this account is dropped entirely.
    act(() => {
      postStore.appendPost(buildLivePost('post-live-before-follow', UNFOLLOWED_AUTHOR))
    })
    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())

    // The reader follows that account (e.g. from the profile page mounted over
    // this still-mounted feed). The write notifies `useFollowedSet`, which
    // re-reads the graph — no remount, no re-subscribe.
    await act(async () => {
      await followPersona(UNFOLLOWED_AUTHOR)
    })

    // The NEXT arrival from them is admitted.
    act(() => {
      postStore.appendPost(buildLivePost('post-live-after-follow', UNFOLLOWED_AUTHOR))
    })

    const pill = await screen.findByTestId('new-posts-pill')
    // Exactly one: the pre-follow arrival was never buffered, so it cannot
    // reappear retroactively.
    expect(pill).toHaveTextContent('1 new post')

    fireEvent.click(pill)

    await waitFor(() => expect(renderedPostIds()).toContain('post-live-after-follow'))
    expect(renderedPostIds()).not.toContain('post-live-before-follow')
  })
})

describe('Feed scope="following" — an observer/read-only mount still gets no pill (D1-011)', () => {
  it.each(['readOnly', 'preview'] as const)(
    'variant=%s: no pill even for an arrival from a followed account',
    async variant => {
      renderFollowingFeed(variant)
      const before = await screen.findAllByTestId('post-card')
      expect(screen.queryByTestId('new-posts-pill')).toBeNull()

      act(() => {
        postStore.appendPost(buildLivePost('post-live-observer', FOLLOWED_AUTHOR))
      })

      // Genuinely inert: the stream never started, so there is nothing to
      // announce and nothing inserts either.
      await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).toBeNull())
      expect(renderedPostIds()).toEqual(before.map(c => c.getAttribute('data-post-id')))
    },
  )
})
