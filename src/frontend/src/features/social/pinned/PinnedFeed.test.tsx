/**
 * features/social/pinned/PinnedFeed.test.tsx
 * ---------------------------------------------------------------------------
 * The Pinned tab panel (demo-feedback story 07; DF-5, DF-7, COR-053, NFR-001), through
 * the real providers and the mock `GET /api/feed/pinned`:
 *
 *  - DF-5 order (exercise pins first, then my pins and likes newest first) rendered with
 *    `<PostCard>`; the "Pinned" marker (word + thumbtack, fiction-safe) only on a post
 *    pinned for everyone; scenario-time headers; the empty and error states;
 *  - LIVE: a `PostPinChanged` push adds / removes the marker and the post; a `PostRemoved`
 *    takes the post off at once; pinning / unpinning / liking anywhere updates the tab
 *    without a reload; focus survives the focused card leaving.
 */
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { personaById, personaIdForHandle } from '@/features/personas'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import { PostActions } from '../components/post/PostActions'
import { postStore } from '../services/postStore'
import { removedPosts } from '../services/removedPosts'
import { resetMockReactions } from '../services/reactionService'
import type { PinChangeSource } from '../services/realtimeFeed'
import {
  recordMockLike,
  recordMockPersonalPin,
  resetMockPins,
  setMockPinFailure,
} from './mockPins'
import { pinState } from './pinEvents'
import { PINNED_EMPTY_COPY, PinnedFeed } from './PinnedFeed'

const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

/** A hand-driven `PostPinChanged` source. */
class FakePinSource implements PinChangeSource {
  private readonly handlers = new Set<(e: { postId: string; pinnedForAll: boolean }) => void>()

  subscribePinChanged(handler: (e: { postId: string; pinnedForAll: boolean }) => void) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  push(postId: string, pinnedForAll: boolean) {
    for (const handler of [...this.handlers]) handler({ postId, pinnedForAll })
  }
}

async function renderPinned(source: PinChangeSource = new FakePinSource(), extra?: ReactNode) {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const mount: ShellMountProps = { variant: 'full', scenarioNow: SCENARIO_NOW }
  render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider value={mount}>
          {extra}
          <PinnedFeed pinChangeSource={source} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
  // The providers resolve the session / exercise asynchronously.
  await screen.findByTestId('pinned-feed')
}

function panel() {
  return screen.getByTestId('pinned-feed')
}

function listedIds(): string[] {
  return within(panel())
    .queryAllByTestId('post-card')
    .map(card => card.getAttribute('data-post-id') ?? '')
}

function rowOf(postId: string): HTMLElement {
  const row = panel().querySelector<HTMLElement>(`[data-pinned-post-id="${postId}"]`)
  if (row === null) throw new Error(`no row for ${postId}`)
  return row
}

beforeEach(() => {
  postStore.resetForTests()
  removedPosts.reset()
  resetMockReactions()
  resetMockPins({ exercisePins: [] })
  pinState.reset()
})

afterEach(() => {
  resetExerciseClock()
  resetMockPins()
  resetMockReactions()
  removedPosts.reset()
  pinState.reset()
  postStore.resetForTests()
})

describe('PinnedFeed — order, marker, time (DF-5)', () => {
  it('renders the items in DF-5 order with PostCard, marking only pinned-for-everyone posts', async () => {
    resetMockPins({ exercisePins: ['post-seed-fw-advisory'] })
    recordMockLike('post-seed-kward-correction', true)
    recordMockPersonalPin('post-seed-mvega-question', true)

    await renderPinned()

    await waitFor(() => expect(listedIds()).toEqual([
      'post-seed-fw-advisory',
      'post-seed-mvega-question',
      'post-seed-kward-correction',
    ]))

    // The marker: a WORD (not colour, not an icon alone), fiction-safe, above the author line.
    const pinnedRow = rowOf('post-seed-fw-advisory')
    const label = within(pinnedRow).getByTestId('pinned-for-all-label')
    expect(label).toHaveTextContent(/^Pinned$/)
    expect(label.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(label.compareDocumentPosition(within(pinnedRow).getByTestId('post-card')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(panel()).not.toHaveTextContent(/controller|exercise control/i)
    expect(within(rowOf('post-seed-mvega-question')).queryByTestId('pinned-for-all-label')).toBeNull()
    expect(within(rowOf('post-seed-kward-correction')).queryByTestId('pinned-for-all-label')).toBeNull()

    // The personal state reaches the card's own actions.
    expect(within(rowOf('post-seed-mvega-question')).getByRole('button', { name: 'Pin' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('ties the "Pinned" line to its card: the article is described by it', async () => {
    resetMockPins({ exercisePins: ['post-seed-fw-advisory'] })
    recordMockLike('post-seed-kward-correction', true)
    await renderPinned()
    await waitFor(() => expect(listedIds()).toHaveLength(2))

    const pinnedArticle = within(rowOf('post-seed-fw-advisory')).getByRole('article')
    expect(pinnedArticle).toHaveAccessibleDescription('Pinned')
    const likedArticle = within(rowOf('post-seed-kward-correction')).getByRole('article')
    expect(likedArticle).not.toHaveAttribute('aria-describedby')
  })

  it('renders every timestamp in scenario time (COR-053)', async () => {
    recordMockLike('post-seed-kward-correction', true)
    await renderPinned()

    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))
    const time = within(panel()).getByText((_, el) => el?.tagName === 'TIME')
    expect(time).toHaveAttribute('dateTime', '2033-09-04T14:20:00Z')
    // 14:20 scenario vs a 14:30 scenario "now": a relative string from the exercise clock.
    expect(time).toHaveTextContent('10m')
  })

  it('shows the empty state when nothing is pinned or liked', async () => {
    await renderPinned()

    expect(await within(panel()).findByText(PINNED_EMPTY_COPY)).toBeInTheDocument()
    expect(PINNED_EMPTY_COPY).toBe('Posts you pin or like show up here.')
    expect(listedIds()).toEqual([])
  })

  it('shows a calm error (never an empty tab) when the first read fails', async () => {
    setMockPinFailure(true)
    await renderPinned()

    const error = await within(panel()).findByText(/Pinned posts aren’t available right now/)
    expect(error).toHaveAttribute('role', 'status')
    expect(within(panel()).queryByText(PINNED_EMPTY_COPY)).not.toBeInTheDocument()
  })
})

describe('PinnedFeed — live updates', () => {
  it('a PostPinChanged push adds the marker and the post, and its removal takes them off', async () => {
    const source = new FakePinSource()
    recordMockLike('post-seed-kward-correction', true)
    await renderPinned(source)
    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))

    // A controller pins a post for everyone (the server now says so) and the push lands.
    resetMockPins({ exercisePins: ['post-seed-fulco-coordination'] })
    recordMockLike('post-seed-kward-correction', true)
    act(() => source.push('post-seed-fulco-coordination', true))

    await waitFor(() => expect(listedIds()).toEqual([
      'post-seed-fulco-coordination',
      'post-seed-kward-correction',
    ]))
    expect(within(rowOf('post-seed-fulco-coordination')).getByTestId('pinned-for-all-label'))
      .toBeInTheDocument()

    // ... and clears it: the post was only on the tab because of that pin, so it leaves.
    resetMockPins({ exercisePins: [] })
    recordMockLike('post-seed-kward-correction', true)
    act(() => source.push('post-seed-fulco-coordination', false))

    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))
  })

  it('a push patches the marker on a listed post at once, before the re-read lands', async () => {
    const source = new FakePinSource()
    resetMockPins({ exercisePins: ['post-seed-kward-correction'] })
    recordMockLike('post-seed-kward-correction', true)
    await renderPinned(source)
    await waitFor(() =>
      expect(within(rowOf('post-seed-kward-correction')).getByTestId('pinned-for-all-label'))
        .toBeInTheDocument())

    resetMockPins({ exercisePins: [] })
    recordMockLike('post-seed-kward-correction', true)
    act(() => source.push('post-seed-kward-correction', false))

    // Synchronously after the push: the marker is gone, the (still liked) post stays.
    expect(within(rowOf('post-seed-kward-correction')).queryByTestId('pinned-for-all-label'))
      .toBeNull()
    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))
  })

  it('a PostRemoved takes the post off the tab at once', async () => {
    recordMockLike('post-seed-kward-correction', true)
    recordMockLike('post-seed-mvega-question', true)
    await renderPinned()
    await waitFor(() => expect(listedIds()).toHaveLength(2))

    act(() => removedPosts.add('post-seed-kward-correction'))

    expect(listedIds()).toEqual(['post-seed-mvega-question'])
  })

  it('unpinning a post in the tab takes it off and keeps focus in the tab', async () => {
    const user = userEvent.setup()
    recordMockPersonalPin('post-seed-mvega-question', true)
    recordMockLike('post-seed-kward-correction', true)
    await renderPinned()
    await waitFor(() => expect(listedIds()).toHaveLength(2))

    await user.click(within(rowOf('post-seed-mvega-question')).getByRole('button', { name: 'Pin' }))

    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))
    await waitFor(() => expect(document.activeElement).toBe(panel()))
  })

  it('does not pull focus back once the reader has moved it out of the tab', async () => {
    const user = userEvent.setup()
    recordMockLike('post-seed-kward-correction', true)
    recordMockLike('post-seed-mvega-question', true)
    await renderPinned(new FakePinSource(), <button type="button">Outside</button>)
    await waitFor(() => expect(listedIds()).toHaveLength(2))

    // Focus a card in the tab, then move focus to a real element outside the tab ...
    act(() => within(rowOf('post-seed-mvega-question')).getByRole('button', { name: 'Pin' }).focus())
    const outside = screen.getByRole('button', { name: 'Outside' })
    await user.click(outside)
    expect(outside).toHaveFocus()
    // ... which then lets go of focus entirely.
    act(() => outside.blur())

    act(() => removedPosts.add('post-seed-mvega-question'))

    expect(listedIds()).toEqual(['post-seed-kward-correction'])
    expect(document.activeElement).not.toBe(panel())
  })

  it('liking or pinning a post elsewhere adds it without a reload', async () => {
    const user = userEvent.setup()
    const author = personaById(personaIdForHandle('kwardFH'))
    if (!author) throw new Error('fixture missing seeded persona')
    const elsewhere = (
      <div data-testid="elsewhere">
        <PostActions
          variant="full"
          post={{
            id: 'post-seed-kward-correction',
            author,
            text: 'x',
            counts: { reply: 0, repost: 0, like: 210 },
            scenarioTime: '2033-09-04T14:20:00Z',
          }}
        />
      </div>
    )
    await renderPinned(new FakePinSource(), elsewhere)
    expect(await within(panel()).findByText(PINNED_EMPTY_COPY)).toBeInTheDocument()

    const other = screen.getByTestId('elsewhere')
    await user.click(within(other).getByRole('button', { name: 'Like, 210' }))
    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))

    // Unlike it there: it leaves (it was only here because of the like).
    await user.click(within(other).getByRole('button', { name: /^Like, 211/ }))
    await waitFor(() => expect(listedIds()).toEqual([]))

    // Pin it there: it is back, and the tab's own card agrees it is pinned.
    await user.click(within(other).getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(listedIds()).toEqual(['post-seed-kward-correction']))
    expect(within(rowOf('post-seed-kward-correction')).getByRole('button', { name: 'Pin' }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})
