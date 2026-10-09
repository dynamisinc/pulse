/**
 * features/social/components/ThreadView.v2.test.tsx
 * ---------------------------------------------------------------------------
 * `<ThreadView>` over the v2 fixture thread (demo-polish F0, DP-14): the
 * relocation of the like/repost wiring into the card changed no behaviour, the
 * cards carry the v2 members (media renders in the media slot, a reply card shows
 * its reply context), the taken-down reply is the interim tombstone, and the
 * visible direct replies each show ONE "Replying to" line - the card's own (F4
 * removed the separate label the thread used to print above each reply, and the
 * blanking of the card's `inReplyTo` that avoided the duplicate).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { DEMO_IDS } from '../services/mockFixtures'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { ThreadView } from './ThreadView'

async function renderThread(focusedPostId: string) {
  render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <SocialDirectoryProvider>
            <ThreadView focusedPostId={focusedPostId} />
          </SocialDirectoryProvider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('thread-view')).toBeInTheDocument())
  await waitFor(() => expect(screen.queryByText('Loading thread…')).not.toBeInTheDocument())
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetTelemetryBuffer()
})

describe('ThreadView over the v2 fixture thread', () => {
  it('renders ancestors, the focused post, and three replies (one tombstone)', async () => {
    await renderThread(DEMO_IDS.threadFocus)

    const cards = screen.getAllByTestId('post-card')
    // 2 ancestors + the focused post + the two visible replies.
    expect(cards).toHaveLength(5)
    expect(cards.slice(0, 3).map(c => c.getAttribute('data-post-id'))).toEqual([
      DEMO_IDS.threadRoot,
      DEMO_IDS.threadQuestion,
      DEMO_IDS.threadFocus,
    ])
    expect(screen.getAllByTestId('thread-reply')).toHaveLength(3)
    expect(screen.getAllByTestId('thread-tombstone')).toHaveLength(1)
  })

  it('shows each visible direct reply exactly one "Replying to" line (the card\'s own), never two', async () => {
    await renderThread(DEMO_IDS.threadFocus)

    const groups = screen.getAllByTestId('thread-reply')
    expect(groups).toHaveLength(3)
    for (const group of groups) {
      if (within(group).queryByTestId('thread-tombstone') !== null) {
        // The tombstone has no card, so no reply line either.
        expect(within(group).queryAllByText(/^Replying to @/)).toHaveLength(0)
        continue
      }
      expect(within(group).getAllByText(/^Replying to @/)).toHaveLength(1)
      expect(within(group).getAllByTestId('post-reply-context')).toHaveLength(1)
      expect(within(group).getByTestId('post-reply-context')).toHaveTextContent(
        'Replying to @FulcoEM',
      )
    }
  })

  it('shows the reply context on a card that is itself a reply (ancestor / focus)', async () => {
    await renderThread(DEMO_IDS.threadFocus)

    const question = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === DEMO_IDS.threadQuestion)
    expect(question).toBeDefined()
    if (question === undefined) return
    expect(within(question).getByTestId('post-reply-context')).toHaveTextContent(
      'Replying to @FulcoEM',
    )
  })

  it('renders the media reply with its attachment in the media slot', async () => {
    await renderThread(DEMO_IDS.threadFocus)

    const photoCard = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === DEMO_IDS.threadReplyPhoto)
    expect(photoCard).toBeDefined()
    if (photoCard === undefined) return
    expect(within(photoCard).getByTestId('post-media')).toBeInTheDocument()
  })

  it('keeps like wiring live on a thread card (relocated into PostActions, one event)', async () => {
    const user = userEvent.setup()
    await renderThread(DEMO_IDS.threadFocus)

    const focus = screen
      .getAllByTestId('post-card')
      .find(card => card.getAttribute('data-post-id') === DEMO_IDS.threadFocus)
    if (focus === undefined) throw new Error('focused card missing')

    // The fixture's like count is 31; liking it renders 32 immediately.
    await user.click(within(focus).getByRole('button', { name: 'Like, 31' }))

    expect(within(focus).getByRole('button', { name: 'Like, 32, liked' })).toBeInTheDocument()
    const events = getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: DEMO_IDS.threadFocus })
  })
})
