/**
 * features/social/pages/Feed.actions.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the Wave-S3.1 orchestrator integration pass wiring reactions/01
 * (SOC-030) and amplification/01 (SOC-020) into the LIVE `<Feed>` action row —
 * `useReaction()`/`useAmplify()` are unit-tested on their own; this proves
 * they are WIRED into the rendered card end-to-end:
 *  - liking a post updates ITS rendered count immediately (optimistic,
 *    story 01's own state) and emits exactly one XC-004 'reaction' event
 *    targeting that post;
 *  - unliking it again drops the count back and emits a second 'reaction'
 *    event with `payload.liked: false`;
 *  - reposting a post bumps ITS rendered count, flips the control ON
 *    (aria-pressed) and emits exactly one XC-004 'repost' event (payload
 *    `{ reposted: true }`) targeting it; undoing emits a second with
 *    `{ reposted: false }` (demo-polish F3 — the repost is a persisted toggle);
 *  - the Quote trigger, its panel and any Share action are ABSENT (F3).
 *
 * Renders through the same real provider stack `Feed.test.tsx` uses
 * (ExerciseContext + Session + ShellContext, all resolved via their built-in
 * mock adapters).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { Feed } from './Feed'

/** First element, guarded — avoids a bare `[0]`/non-null assertion (banned). */
function first<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('expected at least one element')
  return item
}

function renderFeed(variant: ShellVariant = 'full') {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetTelemetryBuffer()
})

describe('Feed — like wiring (SOC-030)', () => {
  it('toggling like on the top post updates its rendered count and emits one reaction event', async () => {
    const user = userEvent.setup()
    renderFeed()

    const cards = await screen.findAllByTestId('post-card')
    const topCard = first(cards)
    expect(topCard).toHaveAttribute('data-post-id', 'post-seed-kward-correction')

    // Seeded like count for the top post (postService.ts) is 210.
    const likeButton = within(topCard).getByRole('button', { name: 'Like, 210' })
    await user.click(likeButton)

    expect(within(topCard).getByRole('button', { name: 'Like, 211, liked' })).toBeInTheDocument()

    const reactionEvents = getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
    expect(reactionEvents).toHaveLength(1)
    const event = reactionEvents[0]
    if (!event) throw new Error('expected a reaction event')
    expect(event.channel).toBe('social')
    expect(event.target).toEqual({ entityType: 'post', entityId: 'post-seed-kward-correction' })
    expect(event.payload).toEqual({ reaction: 'like', liked: true })

    // Unliking drops the count back and emits a second event, add -> remove.
    await user.click(within(topCard).getByRole('button', { name: 'Like, 211, liked' }))
    expect(within(topCard).getByRole('button', { name: 'Like, 210' })).toBeInTheDocument()

    const reactionEventsAfter = getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
    expect(reactionEventsAfter).toHaveLength(2)
    expect(reactionEventsAfter[1]?.payload).toEqual({ reaction: 'like', liked: false })
  })

  it('renders no like control at all under a read-only (observer) session (COR-015/D1-011)', async () => {
    renderFeed('readOnly')

    const actionsRegions = await screen.findAllByTestId('post-actions')
    expect(actionsRegions.length).toBeGreaterThan(0)
    for (const region of actionsRegions) {
      expect(within(region).queryAllByRole('button')).toHaveLength(0)
    }
  })
})

describe('Feed — repost wiring (SOC-020, SOC-021)', () => {
  it('reposting the top post bumps its count, emits exactly one repost event; undoing emits another', async () => {
    const user = userEvent.setup()
    renderFeed()

    const cards = await screen.findAllByTestId('post-card')
    const topCard = first(cards)

    await user.click(within(topCard).getByRole('button', { name: 'Repost, 88' }))

    // The repost is a PERSISTED toggle now (F3): the count moves and the control reads ON.
    const reposted = within(topCard).getByRole('button', { name: 'Repost, 89, reposted' })
    expect(reposted).toHaveAttribute('aria-pressed', 'true')

    const repostEvents = getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')
    expect(repostEvents).toHaveLength(1)
    const event = repostEvents[0]
    if (!event) throw new Error('expected a repost event')
    expect(event.channel).toBe('social')
    expect(event.actor.kind).toBe('persona')
    expect(event.target).toEqual({ entityType: 'post', entityId: 'post-seed-kward-correction' })
    expect(event.payload).toEqual({ reposted: true })

    await user.click(reposted)
    expect(within(topCard).getByRole('button', { name: 'Repost, 88' })).toBeInTheDocument()
    const after = getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')
    expect(after).toHaveLength(2)
    expect(after[1]?.payload).toEqual({ reposted: false })
  })
})

describe('Feed — quote and share are hidden (F3, D1-011)', () => {
  it('renders no Quote trigger, no quote panel and no Share action on any card', async () => {
    renderFeed()

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^quote/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('quote-composer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('renders no repost/quote controls at all under a read-only (observer) session (D1-011)', async () => {
    renderFeed('readOnly')

    const actionsRegions = await screen.findAllByTestId('post-actions')
    for (const region of actionsRegions) {
      expect(within(region).queryAllByRole('button')).toHaveLength(0)
    }
    expect(screen.queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
  })
})
