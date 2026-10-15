/**
 * features/social/components/post/PostActions.pin.test.tsx
 * ---------------------------------------------------------------------------
 * The personal **Pin** action (demo-feedback story 07; DF-6, NFR-001, COR-015):
 *
 *  - it sits AFTER Like, uses the thumbtack, shows NO count, keeps the STABLE name "Pin"
 *    (ARIA toggle-button pattern) and carries `viewer.pinned` in `aria-pressed` (never
 *    colour-only);
 *  - the toggle is OPTIMISTIC (pressed before the write settles), calls
 *    `PUT` / `DELETE /posts/{id}/reactions/pin`, and ROLLS BACK exactly on failure with a
 *    message in the card's polite live region; a second tap while pending is a no-op;
 *  - it is gated like Like: absent (not inert) on a read-only card;
 *  - a settled pin or like notifies a mounted Pinned tab (`viewerEngagement`), a pin on one
 *    card shows on every other card of the same post (`pinState`), and a LATER server read
 *    that disagrees wins over an older confirmed pin.
 *
 * Real providers, mock mode (the Vitest default). Read-only / no-persona SESSIONS are
 * covered by `PostActions.sessionReadOnly.test.tsx` / `PostActions.noPersona.test.tsx`,
 * which assert the row holds no button at all (so no Pin).
 */
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { personaById, personaIdForHandle } from '@/features/personas'
import { resetMockReactions } from '../../services/reactionService'
import { pinState, viewerEngagement, type ViewerEngagementEvent } from '../../pinned/pinEvents'
import { resetMockPins, setMockPinFailure } from '../../pinned/mockPins'
import { PIN_FAILURE_MESSAGE } from '../../pinned/usePin'
import { PostActions } from './PostActions'
import type { PostView } from './types'

function buildPost(overrides: Partial<PostView> = {}): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-pin-1',
    author,
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2033-09-04T13:15:00Z',
    ...overrides,
  }
}

async function renderActions(node: ReactNode) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>{node}</SessionProvider>
    </ExerciseContextProvider>,
  )
  await screen.findAllByTestId('post-actions')
  return utils
}

/** A write promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function pinBody(postId: string, active: boolean) {
  return {
    data: {
      postId,
      kind: 'pin',
      active,
      counts: { reply: 0, repost: 0, like: 0 },
      viewer: { liked: false, reposted: false, pinned: active },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
  }
}

let events: ViewerEngagementEvent[] = []
let offEvents: () => void = () => {}

beforeEach(() => {
  resetMockReactions()
  resetMockPins()
  pinState.reset()
  events = []
  offEvents = viewerEngagement.subscribe(event => events.push(event))
})

afterEach(() => {
  offEvents()
  vi.restoreAllMocks()
  resetMockReactions()
  resetMockPins()
  pinState.reset()
})

describe('PostActions — Pin anatomy (story 07)', () => {
  it('renders Pin after Like, with no count, named "Pin" and not pressed', async () => {
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    const region = screen.getByTestId('post-actions')
    const order = Array.from(region.querySelectorAll('[data-action]'))
      .map(el => el.getAttribute('data-action'))
    expect(order.indexOf('pin')).toBe(order.indexOf('like') + 1)

    const pin = within(region).getByRole('button', { name: 'Pin' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(pin).toHaveAttribute('data-action', 'pin')
    // No count: the button holds only the (decorative) icon.
    expect(pin.textContent).toBe('')
    expect(pin.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('reflects viewer.pinned in aria-pressed (name stays "Pin"), with the filled style', async () => {
    await renderActions(
      <PostActions
        post={buildPost({ viewer: { liked: false, reposted: false, pinned: true } })}
        variant="full"
      />,
    )

    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(pin.className).toMatch(/actionButtonActive/)
    expect(screen.queryByRole('button', { name: 'Unpin' })).not.toBeInTheDocument()
  })

  it('is absent (not inert) on a read-only card', async () => {
    await renderActions(<PostActions post={buildPost()} variant="readOnly" />)

    const region = screen.getByTestId('post-actions')
    expect(region.querySelector('[data-action="pin"]')).toBeNull()
    expect(within(region).queryByRole('button', { name: /pin/i })).not.toBeInTheDocument()
  })
})

describe('PostActions — Pin toggle (optimistic + rollback)', () => {
  it('flips optimistically, PUTs the pin reaction, and keeps the confirmed state', async () => {
    const user = userEvent.setup()
    const write = deferred<ReturnType<typeof pinBody>>()
    const put = vi.spyOn(api, 'put').mockImplementation(() => write.promise as never)
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Pin' }))

    // Optimistic: pressed before the server answers; the name does not flip.
    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]?.[0]).toBe('/posts/post-pin-1/reactions/pin')
    expect(put.mock.calls[0]?.[1]).toBeUndefined()

    // A second tap while the write is pending is a no-op.
    await user.click(pin)
    expect(put).toHaveBeenCalledTimes(1)

    await act(async () => {
      write.resolve(pinBody('post-pin-1', true))
      await write.promise
    })
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')
    expect(events).toEqual([{ postId: 'post-pin-1', kind: 'pin', active: true }])
  })

  it('DELETEs to unpin', async () => {
    const user = userEvent.setup()
    const del = vi.spyOn(api, 'delete').mockImplementation(
      () => Promise.resolve(pinBody('post-pin-1', false)) as never,
    )
    await renderActions(
      <PostActions
        post={buildPost({ viewer: { liked: false, reposted: false, pinned: true } })}
        variant="full"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Pin' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false'))
    expect(del.mock.calls[0]?.[0]).toBe('/posts/post-pin-1/reactions/pin')
    expect(events).toEqual([{ postId: 'post-pin-1', kind: 'pin', active: false }])
  })

  it('rolls back exactly on failure and says so in the polite live region', async () => {
    const user = userEvent.setup()
    setMockPinFailure(true)
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Pin' }))

    const notice = screen.getByTestId('post-actions-notice')
    await waitFor(() => expect(notice).toHaveTextContent(PIN_FAILURE_MESSAGE))
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    // A rolled-back pin changed nothing, so nothing is announced to the Pinned tab.
    expect(events).toEqual([])
  })

  it('shows a confirmed pin on every card of the same post', async () => {
    const user = userEvent.setup()
    await renderActions(
      <>
        <PostActions post={buildPost()} variant="full" />
        <PostActions post={buildPost()} variant="full" />
      </>,
    )

    const [first] = screen.getAllByRole('button', { name: 'Pin' })
    if (first === undefined) throw new Error('expected a Pin button')
    await user.click(first)

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Pin' }).map(b => b.getAttribute('aria-pressed')),
      ).toEqual(['true', 'true']))
  })

  it('lets a LATER server read override an older confirmed pin (fresher data wins)', async () => {
    // Confirmed pinned earlier this session (e.g. on another card).
    pinState.set('post-pin-1', true)
    const { rerender } = await renderActions(
      <PostActions
        post={buildPost({ viewer: { liked: false, reposted: false, pinned: false } })}
        variant="full"
      />,
    )
    // The snapshot a card MOUNTS with may predate the pin (a frozen feed): the pin stands.
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')

    // A newer read (a new viewer object) says it is not pinned: that wins, for every card.
    rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <PostActions
            post={buildPost({ viewer: { liked: false, reposted: false, pinned: false } })}
            variant="full"
          />
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false'))
    expect(pinState.get('post-pin-1')).toBe(false)
  })

  it('keeps the confirmed pin when a re-render carries the SAME read', async () => {
    pinState.set('post-pin-1', true)
    const post = buildPost({ viewer: { liked: false, reposted: false, pinned: false } })
    const tree = (
      <ExerciseContextProvider>
        <SessionProvider>
          <PostActions post={post} variant="full" />
        </SessionProvider>
      </ExerciseContextProvider>
    )
    const { rerender } = render(tree)
    await screen.findByTestId('post-actions')

    rerender(tree)

    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')
    expect(pinState.get('post-pin-1')).toBe(true)
  })
})

describe('PostActions — a session reset while a pin write is in flight', () => {
  it('drops the late answer: nothing confirmed for the next identity, nothing announced', async () => {
    const user = userEvent.setup()
    const write = deferred<ReturnType<typeof pinBody>>()
    vi.spyOn(api, 'put').mockImplementation(() => write.promise as never)
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Pin' }))
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')

    // Sign-out / sign-in lands while the PUT is on the wire (an EMPTY store: the generation
    // must still move).
    act(() => pinState.reset())

    await act(async () => {
      write.resolve(pinBody('post-pin-1', true))
      await write.promise
    })

    // The previous identity's answer does not repopulate the shared store or reach the tab ...
    expect(pinState.get('post-pin-1')).toBeUndefined()
    expect(events).toEqual([])
    // ... and the optimistic value is still dropped: the card shows the post's own flag.
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('control: with no reset, the same answer is recorded and announced', async () => {
    const user = userEvent.setup()
    const write = deferred<ReturnType<typeof pinBody>>()
    vi.spyOn(api, 'put').mockImplementation(() => write.promise as never)
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Pin' }))
    await act(async () => {
      write.resolve(pinBody('post-pin-1', true))
      await write.promise
    })

    expect(pinState.get('post-pin-1')).toBe(true)
    expect(events).toEqual([{ postId: 'post-pin-1', kind: 'pin', active: true }])
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('PostActions — the Pinned tab hears likes too', () => {
  it('notifies once a like settles', async () => {
    const user = userEvent.setup()
    await renderActions(<PostActions post={buildPost()} variant="full" />)

    await user.click(screen.getByRole('button', { name: 'Like, 42' }))

    await waitFor(() =>
      expect(events).toEqual([{ postId: 'post-pin-1', kind: 'like', active: true }]),
    )
  })
})
