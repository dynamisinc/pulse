/**
 * features/social/components/ThreadView.reply.test.tsx
 * ---------------------------------------------------------------------------
 * The thread's REPLY COMPOSER and LIVE REPLY APPEND, through the rendered DOM
 * (demo-polish F4, story 13 "Reply composer" + "Live reply append"; SOC-010/011,
 * D1-006, D1-011, NFR-001, COR-053):
 *
 *  - under the focused post: "Replying to @handle", the 280-char ring and the attach
 *    tray; ABSENT (not disabled) for a read-only variant;
 *  - posting a reply sends `parentPostId`, appends it BELOW at once with its own
 *    "Replying to" line, bumps the focused post's reply count exactly once, announces
 *    nothing as "new" (it is your own), and its realtime echo does not duplicate it;
 *  - a reply that ARRIVES over the (mock) stream for the focused post appends below,
 *    is announced in a polite live region ("1 new reply"), bumps the count, moves
 *    nothing (no scroll), renders its time in SCENARIO time, and a reply to a
 *    different post / a top-level post does not append;
 *  - the reply button on the focused card focuses the composer; on any other card it
 *    opens that post's thread with its composer focused (`onOpenThread` + intent).
 *
 * Drives the real default arrival source (`postStore` under mock data) so the whole
 * append -> narrow -> subscribe -> overlay path is exercised.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { personaIdForHandle } from '@/features/personas'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import type { Post } from '@/features/social'
import { DEMO_IDS } from '../services/mockFixtures'
import { postStore } from '../services/postStore'
import { ownPostStore } from '../services/ownPostStore'
import { consumeReplyFocus, resetReplyIntentForTests } from '../services/replyIntent'
import { ThreadView } from './ThreadView'

const FOCUS = 'post-seed-mvega-question'

function renderThread(
  focusedPostId = FOCUS,
  options: { variant?: ShellVariant; onOpenThread?: (id: string) => void } = {},
) {
  const { variant = 'full', onOpenThread } = options
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <ThreadView
            focusedPostId={focusedPostId}
            {...(onOpenThread !== undefined ? { onOpenThread } : {})}
          />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

async function renderLoaded(...args: Parameters<typeof renderThread>) {
  const utils = renderThread(...args)
  await waitFor(() => expect(screen.getByTestId('thread-view')).toBeInTheDocument())
  await waitFor(() => expect(screen.queryByText('Loading thread…')).not.toBeInTheDocument())
  await screen.findByTestId('thread-focused')
  return utils
}

/** A reply to `parentPostId` from `handle`, as the mock backend would store it. */
function reply(id: string, handle = 'kwardFH', overrides: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle(handle),
    actingHumanId: 'human-participant-kward',
    text: `Reply ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:30:00Z',
    origin: 'participant',
    parentPostId: FOCUS,
    ...overrides,
  }
}

function focusedCard(): HTMLElement {
  return within(screen.getByTestId('thread-focused')).getByTestId('post-card')
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetReplyIntentForTests()
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('ThreadView — the reply composer (D1-006, SOC-011)', () => {
  it('sits under the focused post with "Replying to @handle", the ring counter and the attach tray', async () => {
    await renderLoaded()

    const composer = screen.getByTestId('reply-composer')
    expect(within(composer).getByText('Replying to @mvega_fh')).toBeInTheDocument()
    expect(within(composer).getByLabelText('Reply text')).toBeInTheDocument()
    expect(within(composer).getByTestId('char-ring')).toHaveAttribute(
      'aria-label',
      '280 characters remaining',
    )
    expect(within(composer).getByRole('button', { name: 'Add photos or video' })).toBeInTheDocument()
    expect(within(composer).getByTestId('composer-file-input')).toBeInTheDocument()
    expect(within(composer).getByRole('button', { name: 'Reply' })).toBeDisabled()

    // DOM order: the focused post, then the composer, then the replies.
    const thread = screen.getByTestId('thread-view')
    const order = Array.from(thread.children).map(el => el.getAttribute('data-testid'))
    expect(order.indexOf('thread-focused')).toBeLessThan(order.indexOf('thread-reply-composer'))
    expect(order.indexOf('thread-reply-composer')).toBeLessThan(order.indexOf('thread-reply'))
  })

  it('is ABSENT (not disabled) in a read-only shell variant', async () => {
    await renderLoaded(FOCUS, { variant: 'readOnly' })

    expect(screen.queryByTestId('reply-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('thread-reply-composer')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Reply text')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
  })

  it('posting a reply sends parentPostId: ONE "reply" event, and no "post" event (mock mode)', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.type(screen.getByLabelText('Reply text'), 'We are looking into it.')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    const events = getEmittedTelemetryEvents()
    expect(events.filter(e => e.eventType === 'post')).toHaveLength(0)
    const replies = events.filter(e => e.eventType === 'reply')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.payload).toEqual({ parentPostId: FOCUS })
  })

  it('appends your reply BELOW at once, with its own "Replying to" line, and bumps the count once', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const before = within(focusedCard()).getByRole('button', { name: /^Reply, \d+$/ })
    expect(before).toHaveAccessibleName('Reply, 5')

    await user.type(screen.getByLabelText('Reply text'), 'We are looking into it.')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    const groups = screen.getAllByTestId('thread-reply')
    const last = groups[groups.length - 1]
    if (last === undefined) throw new Error('no reply rendered')
    expect(within(last).getByText('We are looking into it.')).toBeInTheDocument()
    expect(within(last).getByTestId('post-reply-context')).toHaveTextContent('Replying to @mvega_fh')
    // Appended below the existing replies, in place.
    expect(groups).toHaveLength(3)

    // Counted exactly once, even though the mock stream also echoed it.
    expect(within(focusedCard()).getByRole('button', { name: 'Reply, 6' })).toBeInTheDocument()
    // Your own reply is not announced as "new".
    expect(screen.getByTestId('thread-live-region')).toHaveTextContent('')
    // The composer cleared.
    expect(screen.getByLabelText('Reply text')).toHaveValue('')
  })
})

describe('ThreadView — live reply append (SOC-083, NFR-001)', () => {
  it('appends a reply that arrives for the focused post, announces "1 new reply", bumps the count', async () => {
    await renderLoaded()
    const region = screen.getByTestId('thread-live-region')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent('')
    const scrollSpy = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollSpy

    try {
      act(() => postStore.appendPost(reply('post-live-1', 'FairhavenWater', {
        text: 'Crews are on it.',
      })))

      await screen.findByText('Crews are on it.')
      expect(region).toHaveTextContent('1 new reply')
      expect(within(focusedCard()).getByRole('button', { name: 'Reply, 6' })).toBeInTheDocument()
      // It is the LAST reply, and nothing scrolled.
      const groups = screen.getAllByTestId('thread-reply')
      expect(within(groups[groups.length - 1] as HTMLElement).getByText('Crews are on it.'))
        .toBeInTheDocument()
      expect(scrollSpy).not.toHaveBeenCalled()

      act(() => postStore.appendPost(reply('post-live-2', 'FairhavenWater', {
        text: 'Update at noon.',
      })))
      await screen.findByText('Update at noon.')
      expect(region).toHaveTextContent('2 new replies')
      expect(within(focusedCard()).getByRole('button', { name: 'Reply, 7' })).toBeInTheDocument()
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('renders an appended reply\'s time in SCENARIO time (COR-053)', async () => {
    setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:45:00.000Z') })
    await renderLoaded()

    act(() => postStore.appendPost(reply('post-live-time', 'FairhavenWater', {
      text: 'Timed.',
      scenarioTime: '2033-09-04T14:30:00Z',
    })))

    const text = await screen.findByText('Timed.')
    const card = text.closest('[data-testid="post-card"]')
    expect(card).not.toBeNull()
    // 15 minutes before the injected scenario "now" - a wall-clock read could never say this.
    expect(within(card as HTMLElement).getByText('15m ago')).toBeInTheDocument()
  })

  it('ignores a reply to a DIFFERENT post and a top-level arrival', async () => {
    await renderLoaded()

    act(() => {
      postStore.appendPost(reply('post-other-reply', 'FairhavenWater', {
        text: 'Elsewhere.',
        parentPostId: 'post-seed-fw-advisory',
      }))
      postStore.appendPost(reply('post-top', 'FairhavenWater', {
        text: 'Top level.',
        parentPostId: undefined,
      }))
    })

    // Give the stream a beat; nothing may appear.
    await act(async () => {})
    expect(screen.queryByText('Elsewhere.')).not.toBeInTheDocument()
    expect(screen.queryByText('Top level.')).not.toBeInTheDocument()
    expect(screen.getByTestId('thread-live-region')).toHaveTextContent('')
    expect(screen.getAllByTestId('thread-reply')).toHaveLength(2)
  })

  it('does not stream into an observer / read-only thread (D1-011)', async () => {
    await renderLoaded(FOCUS, { variant: 'readOnly' })

    act(() => postStore.appendPost(reply('post-live-ro', 'FairhavenWater', { text: 'Unseen.' })))

    await act(async () => {})
    expect(screen.queryByText('Unseen.')).not.toBeInTheDocument()
  })

  it('appends to a fixture thread too (opaque ids, tombstone untouched)', async () => {
    // The fixture parent must be in the mock backend for `appendPost` to link the reply.
    postStore.resetForTests({ withDemoFixtures: true })
    await renderLoaded(DEMO_IDS.threadFocus)
    expect(screen.getAllByTestId('thread-reply')).toHaveLength(3)

    act(() => postStore.appendPost(reply('post-live-fx', 'FairhavenWater', {
      text: 'Fixture thread reply.',
      parentPostId: DEMO_IDS.threadFocus,
    })))

    await screen.findByText('Fixture thread reply.')
    expect(screen.getAllByTestId('thread-reply')).toHaveLength(4)
    expect(screen.getAllByTestId('thread-tombstone')).toHaveLength(1)
  })
})

describe('ThreadView — the reply button (SOC-011)', () => {
  it('the focused card\'s reply button focuses the composer', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.click(within(focusedCard()).getByRole('button', { name: /^Reply, \d+$/ }))

    expect(screen.getByLabelText('Reply text')).toHaveFocus()
  })

  it('a reply button on ANOTHER card opens that post\'s thread with its composer focused', async () => {
    const onOpenThread = vi.fn<(id: string) => void>()
    const user = userEvent.setup()
    await renderLoaded(FOCUS, { onOpenThread })

    const ancestor = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === 'post-seed-fulco-coordination')
    if (ancestor === undefined) throw new Error('ancestor card missing')
    await user.click(within(ancestor).getByRole('button', { name: /^Reply, \d+$/ }))

    expect(onOpenThread).toHaveBeenCalledWith('post-seed-fulco-coordination')
    // The intent is recorded for the thread that opens next.
    expect(consumeReplyFocus('post-seed-fulco-coordination')).toBe(true)
  })

  it('opens the thread with the composer focused when the intent was recorded for it', async () => {
    const { requestReplyFocus } = await import('../services/replyIntent')
    requestReplyFocus(FOCUS)

    await renderLoaded()

    await waitFor(() => expect(screen.getByLabelText('Reply text')).toHaveFocus())
    // One-shot: it was consumed.
    expect(consumeReplyFocus(FOCUS)).toBe(false)
  })

  it('does not focus the composer when the thread was opened without the reply intent', async () => {
    await renderLoaded()

    expect(screen.getByLabelText('Reply text')).not.toHaveFocus()
  })
})
