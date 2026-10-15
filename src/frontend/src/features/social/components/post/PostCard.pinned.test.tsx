/**
 * features/social/components/post/PostCard.pinned.test.tsx
 * ---------------------------------------------------------------------------
 * The "Pinned" marker on every card (demo-feedback story 21; DF-6, DF-7, DF-34, SOC-071,
 * NFR-001):
 *
 *  - every card variant that shows a post renders the marker ABOVE its author row when the
 *    post is pinned for everyone, and the card's <article> is described by it. Every surface
 *    (home feed All / Following, thread root and replies, profile tabs, Pinned tab, search
 *    and hashtag results) builds its card through `toPostView` + `<PostCard>`, so the chain
 *    is exercised from a participant-safe read here;
 *  - a personal pin (`viewer.pinned`, or one confirmed this session in `pinState`) shows NO
 *    marker (DF-6: private) - only the Pin action's pressed state;
 *  - LIVE through the shared pin sources (no new hub subscription): a `PostPinChanged` push
 *    (story 07's `realtimeFeed.subscribePinChanged` fan-out) and the mock-mode exercise pin
 *    (`setMockExercisePin`) add and remove the marker on mounted cards without a reload;
 *  - a push wakes only the cards showing that post (burst legibility);
 *  - a held push beats an older read on mount; a re-read that changes the flag wins after it.
 */
import { Profiler, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaById, personaIdForHandle } from '@/features/personas'
import { realtimeFeed } from '../../services/realtimeFeed'
import { toPostView } from '../../services/feedService'
import type { ParticipantPostView } from '../../types/post'
import { exercisePinState } from '../../pinned/exercisePinState'
import { pinState } from '../../pinned/pinEvents'
import { resetMockPins, setMockExercisePin } from '../../pinned/mockPins'
import { resetMockReactions } from '../../services/reactionService'
import { PostCard } from './PostCard'
import type { PostCardVariant, PostView } from './types'

type PinHandler = (event: { postId: string; pinnedForAll: boolean }) => void

let pinHandlers: PinHandler[] = []

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
  pinHandlers = []
  exercisePinState.resetForTests()
  vi.spyOn(realtimeFeed, 'subscribePinChanged').mockImplementation(handler => {
    pinHandlers.push(handler)
    return () => {
      pinHandlers = pinHandlers.filter(h => h !== handler)
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
    { name: 'feed card (full, All / Following, profile, search)', variant: 'full', overrides: {}, withHandlers: true },
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

    act(() => exercisePinState.reset())
    expect(markerIn('post-pinned-1')).toBeNull()
  })
})
