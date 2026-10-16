/**
 * features/social/components/post/PostCard.pinned.test.tsx
 * ---------------------------------------------------------------------------
 * The "Pinned" marker on every card (demo-feedback story 21; DF-6, DF-7, DF-34, SOC-071,
 * NFR-001):
 *
 *  - every card variant that shows a post renders the marker ABOVE its author row when the
 *    post is pinned for everyone, and the card's <article> is described by it. Every surface
 *    (home feed All / Following, thread root and replies, profile tabs, Pinned tab, hashtag
 *    results) builds its card through `toPostView` + `<PostCard>`, so the chain is exercised
 *    from a participant-safe read here (and through a real surface in
 *    `ThreadView.pinnedMarker.test.tsx`);
 *  - a personal pin (`viewer.pinned`, or one confirmed this session in `pinState`) shows NO
 *    marker (DF-6: private) - only the Pin action's pressed state;
 *  - LIVE through the shared pin sources (no new hub subscription): a `PostPinChanged` push
 *    (story 07's `realtimeFeed.subscribePinChanged` fan-out) and the mock-mode exercise pin
 *    (`setMockExercisePin`) add and remove the marker on mounted cards without a reload;
 *  - a push wakes only the cards showing that post (burst legibility);
 *  - a held push beats an older read on mount; a re-read that changes the flag wins after it;
 *  - a hub gap (the shared connection leaving Connected) KEEPS the held state, and the
 *    recovery (back to Connected) makes ONE authoritative read of the exercise pins
 *    (`resolvePinnedFeed`, story 07's `GET /api/feed/pinned`) that pins and unpins the cards to
 *    match it, including changes missed during the gap (#553 Copilot, replacing Gate-1 M-1's
 *    drop). A late answer after a session reset is ignored, a failed read keeps the state, and
 *    mock mode makes no read. A session reset (`runSessionResets`) forgets held pushes.
 *
 * `USE_MOCK_DATA` is a getter the recovery tests switch off for the hub transition only (the
 * store reads it when the hub comes back), so the cards and providers stay on mock data.
 */
import { Profiler, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { runSessionResets } from '@/core/auth/sessionReset'
import {
  HubConnectionState,
  realtimeConnection,
  type RealtimeStateListener,
} from '@/core/realtime/connection'
import { personaById, personaIdForHandle } from '@/features/personas'
import { realtimeFeed } from '../../services/realtimeFeed'
import { toPostView } from '../../services/feedService'
import type { ParticipantPostView } from '../../types/post'
import { exercisePinState } from '../../pinned/exercisePinState'
import { resolvePinnedFeed } from '../../pinned/pinnedFeedService'
import type { PinnedFeedItem, PinnedFeedReason } from '../../pinned/types'
import { pinState } from '../../pinned/pinEvents'
import { resetMockPins, setMockExercisePin } from '../../pinned/mockPins'
import { resetMockReactions } from '../../services/reactionService'
import { PostCard } from './PostCard'
import type { PostCardVariant, PostView } from './types'

/** A live binding the recovery tests flip: `USE_MOCK_DATA` is read through a getter. */
const flag = vi.hoisted(() => ({ mock: true }))

vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return flag.mock
  },
  warnIfMockDataActive: () => undefined,
}))

vi.mock('../../pinned/pinnedFeedService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../pinned/pinnedFeedService')>()),
  resolvePinnedFeed: vi.fn(),
}))

type PinHandler = (event: { postId: string; pinnedForAll: boolean }) => void

let pinHandlers: PinHandler[] = []
let stateListeners: RealtimeStateListener[] = []

/** The shared hub connection reports a state, exactly as its `onStateChange` does. */
function hubState(state: HubConnectionState, reason?: 'stopped') {
  act(() => {
    for (const listener of [...stateListeners]) listener(state, reason)
  })
}

/** The hub comes back in LIVE mode (the store reads the mock switch at that moment). */
function hubRecoversLive() {
  flag.mock = false
  try {
    hubState(HubConnectionState.Connected)
  } finally {
    flag.mock = true
  }
}

const resolvePinnedFeedMock = vi.mocked(resolvePinnedFeed)

/** One `GET /api/feed/pinned` item, participant-safe, as the read seam returns it. */
function pinnedItem(id: string, reason: PinnedFeedReason = 'exercise'): PinnedFeedItem {
  return {
    reason,
    post: {
      id,
      authorPersonaId: author().id,
      text: `post ${id}`,
      counts: { reply: 0, repost: 0, like: 0 },
      scenarioTime: '2033-09-04T13:15:00Z',
      ...(reason === 'exercise' ? { pinnedForAll: true as const } : {}),
    },
  }
}

/** A recovery read the test answers (or fails) when it chooses. */
function deferredRead() {
  let resolve: (items: PinnedFeedItem[]) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<PinnedFeedItem[]>((res, rej) => {
    resolve = res
    reject = rej
  })
  resolvePinnedFeedMock.mockReturnValueOnce(promise)
  return {
    answer: async (items: PinnedFeedItem[]) => {
      await act(async () => {
        resolve(items)
        await promise
      })
    },
    fail: async (error: Error) => {
      await act(async () => {
        reject(error)
        await promise.catch(() => undefined)
      })
    },
  }
}

/** Delivers a `PostPinChanged` exactly as the shared transport's fan-out does. */
function pushPinChanged(postId: string, pinnedForAll: boolean) {
  act(() => {
    for (const handler of [...pinHandlers]) handler({ postId, pinnedForAll })
  })
}

function author() {
  const persona = personaById(personaIdForHandle('FairhavenWater'))
  if (!persona) throw new Error('fixture missing seeded persona')
  return persona
}

/** A participant-safe read of a post, turned into the card's view the way every surface does. */
function view(overrides: Partial<ParticipantPostView> = {}): PostView {
  const read: ParticipantPostView = {
    id: 'post-pinned-1',
    authorPersonaId: author().id,
    text: 'Boil-water advisory lifted for the north zone.',
    counts: { reply: 1, repost: 2, like: 3 },
    scenarioTime: '2033-09-04T13:15:00Z',
    ...overrides,
  }
  return toPostView(read, author())
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ExerciseContextProvider>
      <SessionProvider>{children}</SessionProvider>
    </ExerciseContextProvider>
  )
}

async function renderCards(node: ReactNode) {
  const utils = render(<Providers>{node}</Providers>)
  await screen.findAllByTestId('post-actions')
  // The card subscribes in a passive effect, which can land after its DOM under a loaded
  // parallel run: wait until the store's sources are attached before pushing at it.
  await waitFor(() => expect(pinHandlers.length).toBeGreaterThan(0))
  return utils
}

function cardOf(postId: string): HTMLElement {
  const card = screen
    .getAllByTestId('post-card')
    .find(element => element.getAttribute('data-post-id') === postId)
  if (card === undefined) throw new Error(`no card for ${postId}`)
  return card
}

function markerIn(postId: string): HTMLElement | null {
  return within(cardOf(postId)).queryByTestId('pinned-for-all-label')
}

beforeEach(() => {
  flag.mock = true
  resolvePinnedFeedMock.mockReset()
  resolvePinnedFeedMock.mockResolvedValue([])
  pinHandlers = []
  exercisePinState.resetForTests()
  vi.spyOn(realtimeFeed, 'subscribePinChanged').mockImplementation(handler => {
    pinHandlers.push(handler)
    return () => {
      pinHandlers = pinHandlers.filter(h => h !== handler)
    }
  })
  stateListeners = []
  vi.spyOn(realtimeConnection, 'onStateChange').mockImplementation(listener => {
    stateListeners.push(listener)
    return () => {
      stateListeners = stateListeners.filter(l => l !== listener)
    }
  })
  resetMockReactions()
  resetMockPins({ exercisePins: [] })
  pinState.reset()
})

afterEach(() => {
  exercisePinState.resetForTests()
  vi.restoreAllMocks()
  resetMockPins()
  resetMockReactions()
  pinState.reset()
})

describe('toPostView carries the exercise pin to every surface', () => {
  it('keeps `pinnedForAll: true` and leaves it absent otherwise', () => {
    expect(view({ pinnedForAll: true }).pinnedForAll).toBe(true)
    expect(view()).not.toHaveProperty('pinnedForAll')
  })
})

describe('PostCard — "Pinned" marker in every variant', () => {
  const variants: ReadonlyArray<{
    readonly name: string
    readonly variant: PostCardVariant
    readonly overrides: Partial<ParticipantPostView>
    readonly withHandlers: boolean
  }> = [
    {
      name: 'feed card (full: All / Following, profile, hashtag)',
      variant: 'full',
      overrides: {},
      withHandlers: true,
    },
    { name: 'observer card (readOnly)', variant: 'readOnly', overrides: {}, withHandlers: false },
    {
      name: 'thread reply',
      variant: 'full',
      overrides: { inReplyTo: { postId: 'post-parent', authorHandle: 'mvega_fh' } },
      withHandlers: true,
    },
  ]

  for (const { name, variant, overrides, withHandlers } of variants) {
    it(`${name}: shows "Pinned" above the author row when pinned for everyone`, async () => {
      const handlers = withHandlers
        ? { onOpen: vi.fn(), onReply: vi.fn(), onOpenProfile: vi.fn(), onHashtagOpen: vi.fn() }
        : {}
      await renderCards(
        <PostCard
          post={view({ ...overrides, pinnedForAll: true })}
          variant={variant}
          {...handlers}
        />,
      )

      const card = cardOf('post-pinned-1')
      const marker = markerIn('post-pinned-1')
      expect(marker).not.toBeNull()
      expect(marker).toHaveTextContent(/^Pinned$/)
      expect(marker?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      const header = card.querySelector('header')
      if (marker === null || header === null) throw new Error('missing marker or header')
      expect(marker.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy()
      // Accessible: the article is described by the word.
      expect(card.tagName).toBe('ARTICLE')
      expect(card).toHaveAccessibleDescription('Pinned')
    })

    it(`${name}: shows no marker when the post is not pinned for everyone`, async () => {
      await renderCards(<PostCard post={view(overrides)} variant={variant} />)
      expect(markerIn('post-pinned-1')).toBeNull()
      expect(cardOf('post-pinned-1')).not.toHaveAttribute('aria-describedby')
    })
  }
})

describe('PostCard — a personal pin stays private (DF-6)', () => {
  it('shows no marker for `viewer.pinned`; the Pin action is pressed instead', async () => {
    await renderCards(
      <PostCard
        post={view({ viewer: { liked: false, reposted: false, pinned: true } })}
        variant="full"
      />,
    )
    expect(markerIn('post-pinned-1')).toBeNull()
    expect(screen.queryByText('Pinned')).toBeNull()
    expect(within(cardOf('post-pinned-1')).getByRole('button', { name: 'Pin' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('shows no marker for a personal pin confirmed this session', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    act(() => pinState.set('post-pinned-1', true))
    expect(within(cardOf('post-pinned-1')).getByRole('button', { name: 'Pin' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(markerIn('post-pinned-1')).toBeNull()
  })
})

describe('PostCard — the marker follows the live pin state', () => {
  it('a PostPinChanged push adds the marker to a mounted card, and unpinning removes it', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    expect(markerIn('post-pinned-1')).toBeNull()
    // One handler on the shared fan-out, however many cards are mounted.
    expect(pinHandlers).toHaveLength(1)

    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(cardOf('post-pinned-1')).toHaveAccessibleDescription('Pinned')

    pushPinChanged('post-pinned-1', false)
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('an unpin push removes the marker from a card whose read said pinned', async () => {
    await renderCards(<PostCard post={view({ pinnedForAll: true })} variant="full" />)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    pushPinChanged('post-pinned-1', false)
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('the mock-mode exercise pin (story 07 channel) adds and removes it too', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)

    act(() => setMockExercisePin('post-pinned-1', true))
    expect(markerIn('post-pinned-1')).not.toBeNull()

    act(() => setMockExercisePin('post-pinned-1', false))
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('updates every card showing the post, and re-renders no other card', async () => {
    const otherRenders = vi.fn()
    await renderCards(
      <>
        <PostCard post={view()} variant="full" />
        <Profiler id="other" onRender={otherRenders}>
          <PostCard post={view({ id: 'post-other' })} variant="full" />
        </Profiler>
      </>,
    )
    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(2))
    otherRenders.mockClear()

    pushPinChanged('post-pinned-1', true)

    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(markerIn('post-other')).toBeNull()
    expect(otherRenders).not.toHaveBeenCalled()
  })

  it('a push held before a card mounts beats that card\'s older read', async () => {
    const first = await renderCards(<PostCard post={view({ id: 'post-elsewhere' })} variant="full" />)
    // The push lands while the post is not on screen (another card keeps the sources attached).
    pushPinChanged('post-pinned-1', true)
    first.unmount()

    await renderCards(<PostCard post={view()} variant="full" />)
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })

  it('a later re-read that changes the flag wins over an earlier push', async () => {
    const { rerender } = await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    // A fresh read says pinned, then a newer read says it is not any more.
    rerender(
      <Providers>
        <PostCard post={view({ pinnedForAll: true })} variant="full" />
      </Providers>,
    )
    rerender(
      <Providers>
        <PostCard post={view()} variant="full" />
      </Providers>,
    )
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('a session reset forgets held pushes (the card falls back to its read)', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    // The real sign-out / sign-in path runs every registered reset.
    act(() => runSessionResets())
    expect(markerIn('post-pinned-1')).toBeNull()
  })
})

describe('PostCard — a hub gap keeps the held state (#553 Copilot)', () => {
  it('a card mounting after a gap still sees the push held from before it', async () => {
    const first = await renderCards(<PostCard post={view({ id: 'post-elsewhere' })} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    hubState(HubConnectionState.Reconnecting)
    first.unmount()

    await renderCards(<PostCard post={view()} variant="full" />)
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })

  it('a mounted card keeps its pushed marker while the hub is down', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    hubState(HubConnectionState.Disconnected)
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })

  it('a push after the gap is held and shown; Connected itself drops nothing', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    hubState(HubConnectionState.Reconnecting)
    hubState(HubConnectionState.Connected)
    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    hubState(HubConnectionState.Connected)
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })

  it('mock mode makes no recovery read and keeps the state', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    hubState(HubConnectionState.Reconnecting)
    hubState(HubConnectionState.Connected)

    expect(resolvePinnedFeedMock).not.toHaveBeenCalled()
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })
})

describe('PostCard — recovery reconciles from one authoritative read (#553 Copilot)', () => {
  it('reads once, only on the way back from a gap (not on a first connect or a deliberate stop)', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    hubRecoversLive()
    hubState(HubConnectionState.Disconnected, 'stopped')
    hubRecoversLive()
    expect(resolvePinnedFeedMock).not.toHaveBeenCalled()

    hubState(HubConnectionState.Reconnecting)
    hubState(HubConnectionState.Disconnected)
    hubRecoversLive()
    expect(resolvePinnedFeedMock).toHaveBeenCalledTimes(1)
    expect(resolvePinnedFeedMock).toHaveBeenCalledWith()
  })

  it('a push, a gap, then a read that still has it pinned: the marker stays the whole time', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    hubState(HubConnectionState.Reconnecting)
    expect(markerIn('post-pinned-1')).not.toBeNull()

    const read = deferredRead()
    hubRecoversLive()
    expect(markerIn('post-pinned-1')).not.toBeNull()
    await read.answer([pinnedItem('post-pinned-1')])
    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(resolvePinnedFeedMock).toHaveBeenCalledTimes(1)
  })

  it('an unpin missed during the gap: the read clears the marker (pushed or from the read)', async () => {
    await renderCards(
      <>
        <PostCard post={view({ pinnedForAll: true })} variant="full" />
        <PostCard post={view({ id: 'post-pushed' })} variant="full" />
      </>,
    )
    pushPinChanged('post-pushed', true)
    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(markerIn('post-pushed')).not.toBeNull()

    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()
    await read.answer([])

    expect(markerIn('post-pinned-1')).toBeNull()
    expect(markerIn('post-pushed')).toBeNull()
  })

  it('a pin missed during the gap: the read adds the marker on mounted cards (exercise pins only)', async () => {
    const unchangedRenders = vi.fn()
    await renderCards(
      <>
        <PostCard post={view()} variant="full" />
        <PostCard post={view({ id: 'post-personal' })} variant="full" />
        <Profiler id="unchanged" onRender={unchangedRenders}>
          <PostCard post={view({ id: 'post-unchanged' })} variant="full" />
        </Profiler>
      </>,
    )
    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(3))
    pushPinChanged('post-unchanged', false)
    unchangedRenders.mockClear()

    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()
    // `post-personal` is on the viewer's Pinned tab for their OWN pin: never the marker (DF-6).
    await read.answer([pinnedItem('post-pinned-1'), pinnedItem('post-personal', 'pin')])

    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(markerIn('post-personal')).toBeNull()
    expect(markerIn('post-unchanged')).toBeNull()
    // Only changed ids are woken: the held unpin already matched the read.
    expect(unchangedRenders).not.toHaveBeenCalled()
  })

  it('a pin read for a post not on screen is held for a card that mounts later', async () => {
    const first = await renderCards(<PostCard post={view({ id: 'post-elsewhere' })} variant="full" />)
    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()
    await read.answer([pinnedItem('post-pinned-1')])
    first.unmount()

    await renderCards(<PostCard post={view()} variant="full" />)
    expect(markerIn('post-pinned-1')).not.toBeNull()
  })

  it('a push that lands while the read is in flight is newer than the read and stays', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()
    pushPinChanged('post-pinned-1', false)

    await read.answer([pinnedItem('post-pinned-1')])
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('a late read after a session reset is ignored', async () => {
    await renderCards(<PostCard post={view()} variant="full" />)
    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()

    act(() => runSessionResets())
    await read.answer([pinnedItem('post-pinned-1')])
    expect(markerIn('post-pinned-1')).toBeNull()
  })

  it('a failed read keeps the last-known state and logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await renderCards(<PostCard post={view()} variant="full" />)
    pushPinChanged('post-pinned-1', true)
    hubState(HubConnectionState.Reconnecting)
    const read = deferredRead()
    hubRecoversLive()

    await read.fail(new Error('503'))
    expect(markerIn('post-pinned-1')).not.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[pinned]'), '503')
  })
})
