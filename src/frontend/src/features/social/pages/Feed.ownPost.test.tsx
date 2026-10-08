/**
 * features/social/pages/Feed.ownPost.test.tsx
 * ---------------------------------------------------------------------------
 * "Own post appears instantly" and "replies never raise the pill" at the `<Feed>`
 * level, through the real rendered DOM (demo-polish F4, story 13; SOC-001, SOC-083,
 * D1-005, NFR-001):
 *
 *  - after a successful publish the post is the TOP row of the feed at once - no
 *    pill tap - EXACTLY once, and the pill never shows a count for it;
 *  - the realtime ECHO of your own post neither raises the pill nor duplicates the
 *    row, in BOTH orders: echo after registration (rejected by `admit`) and echo
 *    BEFORE it (the broadcast can beat the 201: buffered, then `discard`ed so the
 *    count disappears);
 *  - other people's top-level posts still buffer behind the pill (control), but a
 *    REPLY arriving over the stream never does;
 *  - a Following mount merges nothing of its own; an own REPLY is not a feed item;
 *    an own post that the baseline already holds renders once;
 *  - the reply button records the intent and opens the thread; the body opens it
 *    without the intent.
 *
 * Renders `<Composer>` and `<Feed>` together under the real providers so the whole
 * compose -> store -> merge path is exercised.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import { toParticipantView, type Post } from '@/features/social'
import { Composer } from '../components/Composer'
import { ownPostStore } from '../services/ownPostStore'
import { consumeReplyFocus, resetReplyIntent } from '../services/replyIntent'
import { postStore } from '../services/postStore'
import { Feed, type FeedProps } from './Feed'

const SEEDED_COUNT = 6

function renderFeed(props: FeedProps = {}, withComposer = false) {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          {withComposer && <Composer />}
          <Feed {...props} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** A post by the mock viewer (`dreyes_fh`), as the mock backend would store it. */
function ownPost(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('dreyes_fh'),
    actingHumanId: 'human-dreyes',
    text: `My post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'participant',
    ...overrides,
  }
}

function otherPost(id: string, overrides: Partial<Post> = {}): Post {
  return ownPost(id, {
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: `Someone else ${id}`,
    ...overrides,
  })
}

function rowIds(): (string | null)[] {
  return screen.getAllByTestId('post-card').map(card => card.getAttribute('data-post-id'))
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetReplyIntent()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('Feed — your own post appears instantly, exactly once (mock mode, end to end)', () => {
  it('puts the published post at the TOP at once, with no pill, and keeps it to one row', async () => {
    const user = userEvent.setup()
    renderFeed({}, true)
    await screen.findAllByTestId('post-card')
    expect(screen.getAllByTestId('post-card')).toHaveLength(SEEDED_COUNT)

    await user.type(screen.getByLabelText('Post text'), 'Boil-water advisory lifted for zone 3.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    // At once: the first row is the new post, written by the viewer.
    const first = screen.getAllByTestId('post-card')[0]
    if (first === undefined) throw new Error('no rows')
    expect(first).toHaveTextContent('Boil-water advisory lifted for zone 3.')
    expect(first.getAttribute('data-post-id')).toMatch(/^post-/)
    // Exactly once, above the unchanged baseline.
    expect(screen.getAllByTestId('post-card')).toHaveLength(SEEDED_COUNT + 1)
    expect(screen.getAllByText('Boil-water advisory lifted for zone 3.')).toHaveLength(1)
    // And the stream's echo of it (the mock store appended it) raised no pill.
    await act(async () => {})
    expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument()
  })

  it('stacks a second own post above the first, newest first', async () => {
    const user = userEvent.setup()
    renderFeed({}, true)
    await screen.findAllByTestId('post-card')

    await user.type(screen.getByLabelText('Post text'), 'First.')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:05:00.000Z') })
    await user.type(screen.getByLabelText('Post text'), 'Second.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const cards = screen.getAllByTestId('post-card')
    expect(cards[0]).toHaveTextContent('Second.')
    expect(cards[1]).toHaveTextContent('First.')
    expect(cards).toHaveLength(SEEDED_COUNT + 2)
  })
})

describe('Feed — the echo of your own post never raises the pill or duplicates (both orders)', () => {
  it('echo AFTER registration: rejected at the door, no pill, one row', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const post = ownPost('post-own-1')

    act(() => {
      ownPostStore.add(toParticipantView(post))
      postStore.appendPost(post) // the stream's echo
    })

    await waitFor(() => expect(rowIds()[0]).toBe('post-own-1'))
    expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument()
    expect(rowIds().filter(id => id === 'post-own-1')).toHaveLength(1)
  })

  it('echo BEFORE registration (broadcast beats the 201): buffered, then taken back out', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const post = ownPost('post-own-2')

    // The echo lands first: the pill promises a post.
    act(() => postStore.appendPost(post))
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')

    // Then the 201 registers it as the viewer's own.
    act(() => ownPostStore.add(toParticipantView(post)))

    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument())
    expect(rowIds()[0]).toBe('post-own-2')
    expect(rowIds().filter(id => id === 'post-own-2')).toHaveLength(1)
  })

  it('a discarded echo leaves OTHER people\'s buffered posts counted', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const mine = ownPost('post-own-3')

    act(() => {
      postStore.appendPost(otherPost('post-other-1'))
      postStore.appendPost(mine)
    })
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('2 new posts')
    act(() => ownPostStore.add(toParticipantView(mine)))

    await waitFor(() => expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('1 new post'))
    fireEvent.click(screen.getByTestId('new-posts-pill'))
    await waitFor(() => expect(rowIds()).toContain('post-other-1'))
    expect(rowIds().filter(id => id === 'post-own-3')).toHaveLength(1)
  })

  it('an own post the baseline already holds renders ONCE', async () => {
    // The post is in the baseline (resolved at mount) AND registered as own.
    const post = ownPost('post-own-baseline')
    postStore.appendPost(post)
    ownPostStore.add(toParticipantView(post))

    renderFeed()
    await screen.findAllByTestId('post-card')

    expect(rowIds().filter(id => id === 'post-own-baseline')).toHaveLength(1)
  })
})

describe('Feed — replies never raise the "new posts" pill', () => {
  it('a top-level post from someone else still buffers behind the pill (control)', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => postStore.appendPost(otherPost('post-other-top')))

    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')
  })

  it('a REPLY arriving over the stream never does, and never enters the feed', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(otherPost('post-other-reply', { parentPostId: 'post-seed-mvega-question' }))
    })

    await act(async () => {})
    expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument()
    expect(rowIds()).not.toContain('post-other-reply')
    expect(screen.getAllByTestId('post-card')).toHaveLength(SEEDED_COUNT)
  })

  it('a reply from someone else does not disturb a pill already counting a post', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(otherPost('post-other-top'))
      postStore.appendPost(otherPost('post-other-reply', { parentPostId: 'post-seed-mvega-question' }))
    })

    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')
  })
})

describe('Feed — what an own post is NOT merged into', () => {
  it('an own REPLY is not a feed item', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      ownPostStore.add({
        ...toParticipantView(ownPost('post-own-reply')),
        inReplyTo: { postId: 'post-seed-mvega-question', authorHandle: 'mvega_fh' },
      })
    })

    await act(async () => {})
    expect(rowIds()).not.toContain('post-own-reply')
  })

  it('merges only posts authored by THIS session\'s persona (a leftover from another session is not shown) (M-4)', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      ownPostStore.add(toParticipantView(ownPost('post-mine')))
      ownPostStore.add(
        toParticipantView(ownPost('post-previous-session', {
          authorPersonaId: personaIdForHandle('FulcoEM'),
        })),
      )
    })

    await waitFor(() => expect(rowIds()[0]).toBe('post-mine'))
    expect(rowIds()).not.toContain('post-previous-session')
  })

  it('forgets own posts when the session ends: the mounted feed drops the row (M-4)', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    act(() => ownPostStore.add(toParticipantView(ownPost('post-mine'))))
    await waitFor(() => expect(rowIds()[0]).toBe('post-mine'))

    act(() => ownPostStore.reset())

    await waitFor(() => expect(rowIds()).not.toContain('post-mine'))
    expect(screen.getAllByTestId('post-card')).toHaveLength(SEEDED_COUNT)
  })

  it('a Following mount merges nothing of its own (your post is not "from someone you follow")', async () => {
    renderFeed({ scope: 'following' })
    await screen.findAllByTestId('post-card')
    const before = rowIds()

    act(() => ownPostStore.add(toParticipantView(ownPost('post-own-following'))))

    await act(async () => {})
    expect(rowIds()).toEqual(before)
  })
})

describe('Feed — the reply button opens the thread to reply; the body just opens it', () => {
  it('the reply button records the reply intent, then opens the thread', async () => {
    const onOpenThread = vi.fn<(id: string) => void>()
    const user = userEvent.setup()
    renderFeed({ onOpenThread })
    await screen.findAllByTestId('post-card')
    const row = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === 'post-seed-mvega-question')
    if (row === undefined) throw new Error('seeded row missing')

    await user.click(within(row).getByRole('button', { name: /^Reply, \d+$/ }))

    expect(onOpenThread).toHaveBeenCalledWith('post-seed-mvega-question')
    expect(consumeReplyFocus('post-seed-mvega-question')).toBe(true)
  })

  it('tapping the post body opens the thread WITHOUT the reply intent', async () => {
    const onOpenThread = vi.fn<(id: string) => void>()
    const user = userEvent.setup()
    renderFeed({ onOpenThread })
    await screen.findAllByTestId('post-card')
    const row = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === 'post-seed-mvega-question')
    if (row === undefined) throw new Error('seeded row missing')

    await user.click(within(row).getByTestId('post-open-target'))

    expect(onOpenThread).toHaveBeenCalledWith('post-seed-mvega-question')
    expect(consumeReplyFocus('post-seed-mvega-question')).toBe(false)
  })

  it('without onOpenThread Reply is inert text (no focusable no-op) and records nothing', async () => {
    const user = userEvent.setup()
    renderFeed()
    await screen.findAllByTestId('post-card')
    const row = screen.getAllByTestId('post-card')[0]
    if (row === undefined) throw new Error('no rows')
    const postId = row.getAttribute('data-post-id') ?? ''

    // F3 + the Wave 1 Copilot rule: an unwired action renders as an inert span, never a button.
    expect(within(row).queryByRole('button', { name: /^Reply, \d+$/ })).toBeNull()
    const reply = row.querySelector('[data-action="reply"]')
    if (reply === null) throw new Error('no reply action')
    expect(reply.tagName).toBe('SPAN')
    await user.click(reply)

    expect(consumeReplyFocus(postId)).toBe(false)
  })
})
