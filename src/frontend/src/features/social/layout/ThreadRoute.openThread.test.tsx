/**
 * features/social/layout/ThreadRoute.openThread.test.tsx
 * ---------------------------------------------------------------------------
 * The thread ROUTE hands `ThreadView` an `onOpenThread` (demo-polish F4 AC, Wave 2
 * Gate-2 H-1), proved through the real routed channel (`renderChannel`) rather than a
 * `ThreadView` unit test that passes the prop by hand:
 *
 *  - on `/i/status/<focused>`, the Reply button on an ANCESTOR card and on a REPLY card
 *    records the reply intent and OPENS that post's thread (the address bar becomes
 *    `/i/status/<that post>`), and focus lands in THAT thread's reply composer;
 *  - the card's open target (an ancestor, a reply) opens its thread too.
 *
 * Without `ThreadRoute` passing `openThread`, none of those cards has an open target and
 * the Reply button on a non-focused card is inert -- the address bar never moves.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { DEMO_IDS } from '../services/mockFixtures'
import { postStore } from '../services/postStore'
import { ownPostStore } from '../services/ownPostStore'
import { resetReplyIntent } from '../services/replyIntent'
import { RouterProbe } from './RouterProbe.testUtils'
import { renderChannel } from './renderChannel.testUtils'

/**
 * The demo thread (fixtures): a reply-to-a-reply with two ancestors (root, then the
 * question) and visible replies below it. Every post in it is a real, openable thread
 * of its own (`useThread` resolves a thread by id from the same store). The hand-authored
 * `post-reply-*` mock replies are NOT in that store, so they are not used here.
 */
const FOCUSED_ID = DEMO_IDS.threadFocus
const ANCESTOR_ID = DEMO_IDS.threadQuestion
const REPLY_ID = DEMO_IDS.threadReplyConfirm

beforeEach(() => {
  resetTelemetryBuffer()
  resetReplyIntent()
  postStore.resetForTests({ withDemoFixtures: true })
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
  vi.restoreAllMocks()
})

function routerLocation(): string {
  return screen.getByTestId('router-location').textContent ?? ''
}

function cardFor(postId: string): HTMLElement {
  const card = screen
    .getAllByTestId('post-card')
    .find(candidate => candidate.getAttribute('data-post-id') === postId)
  if (card === undefined) throw new Error(`no card for ${postId}`)
  return card
}

async function renderThreadRoute() {
  renderChannel({ entries: [`/i/status/${FOCUSED_ID}`], beside: <RouterProbe /> })
  await screen.findByTestId('thread-focused')
  await screen.findByTestId('reply-composer')
}

describe('ThreadRoute — onOpenThread is supplied by the route (F4 AC)', () => {
  it('Reply on an ANCESTOR card opens its thread and focuses ITS composer', async () => {
    const user = userEvent.setup()
    await renderThreadRoute()
    expect(routerLocation()).toBe(`/i/status/${FOCUSED_ID}`)

    await user.click(within(cardFor(ANCESTOR_ID)).getByRole('button', { name: /^Reply, \d+$/ }))

    await waitFor(() => expect(routerLocation()).toBe(`/i/status/${ANCESTOR_ID}`))
    // The new thread is the ancestor's: its own focused card, and its composer has focus.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('thread-focused')).getByTestId('post-card'),
      ).toHaveAttribute('data-post-id', ANCESTOR_ID),
    )
    await waitFor(() => expect(screen.getByLabelText('Reply text')).toHaveFocus())
  })

  it('Reply on a REPLY card opens the reply\'s thread and focuses ITS composer', async () => {
    const user = userEvent.setup()
    await renderThreadRoute()

    await user.click(within(cardFor(REPLY_ID)).getByRole('button', { name: /^Reply, \d+$/ }))

    await waitFor(() => expect(routerLocation()).toBe(`/i/status/${REPLY_ID}`))
    await waitFor(() =>
      expect(
        within(screen.getByTestId('thread-focused')).getByTestId('post-card'),
      ).toHaveAttribute('data-post-id', REPLY_ID),
    )
    await waitFor(() => expect(screen.getByLabelText('Reply text')).toHaveFocus())
  })

  it('tapping an ancestor card opens that post\'s thread (and does NOT steal focus into a composer)', async () => {
    const user = userEvent.setup()
    await renderThreadRoute()

    await user.click(within(cardFor(ANCESTOR_ID)).getByTestId('post-open-target'))

    await waitFor(() => expect(routerLocation()).toBe(`/i/status/${ANCESTOR_ID}`))
    await screen.findByTestId('reply-composer')
    // No reply intent was recorded, so the composer is not focused.
    expect(screen.getByLabelText('Reply text')).not.toHaveFocus()
  })

  it('tapping a reply card opens that reply\'s thread', async () => {
    const user = userEvent.setup()
    await renderThreadRoute()

    await user.click(within(cardFor(REPLY_ID)).getByTestId('post-open-target'))

    await waitFor(() => expect(routerLocation()).toBe(`/i/status/${REPLY_ID}`))
  })
})
