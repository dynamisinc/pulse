/**
 * features/social/pages/Feed.removed.test.tsx
 * ---------------------------------------------------------------------------
 * LIVE REMOVAL on the Home feed (demo-polish C5, docs/features/demo-polish/22-takedown-ui.md,
 * "Live removal on the participant feed"; CTL-025, NFR-001, XC-002), through the real rendered
 * DOM with the default mock stream (`postStore` -> `useFeedStream`) and the session's
 * `removedPosts` store, which is what a `PostRemoved` push (and the mock-mode takedown) writes:
 *
 *  - a displayed post whose id is recorded vanishes AT ONCE, without a refresh, and leaves no
 *    trace (no placeholder, no moderator chrome, its text is gone from the DOM);
 *  - a post still BUFFERED behind the "N new posts" pill is taken out (the count drops, and what
 *    the pill loads no longer includes it); one removed BEFORE it arrives is never counted;
 *  - a post the reader loaded from the pill, and the viewer's OWN just-published post, vanish too;
 *  - an id the feed is not showing changes nothing (no row re-created, focus untouched);
 *  - when the removed post held focus, focus moves to the feed REGION (never `<body>`); when
 *    another card held focus it stays there; so too when the removed post's MEDIA VIEWER
 *    (portalled to <body>, outside the region) held it (Gate-2 B L-2), while a viewer that stays
 *    open keeps it;
 *  - surviving rows keep their DOM nodes (no remount: burst legibility, NFR-002);
 *  - when every post is removed the page says so in its own empty-state voice;
 *  - no extra telemetry (still exactly one mount 'view').
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import { toParticipantView, type Post } from '@/features/social'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'
import { removedPosts } from '../services/removedPosts'
import { DEMO_IDS } from '../services/mockFixtures'
import { Feed } from './Feed'

const SEEDED = [
  'post-seed-kward-correction',
  'post-seed-mvega-question',
  'post-seed-newsline7-breaking',
  'post-seed-fulco-coordination',
  'post-seed-fwupd-rumor',
  'post-seed-fw-advisory',
]

function renderFeed() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Feed onOpenThread={() => {}} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

function livePost(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: `Live post ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T16:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

function rowIds(): (string | null)[] {
  return screen.getAllByTestId('post-card').map(card => card.getAttribute('data-post-id'))
}

function cardOf(id: string): HTMLElement {
  const card = screen.getAllByTestId('post-card').find(c => c.getAttribute('data-post-id') === id)
  if (card === undefined) throw new Error(`no card for ${id}`)
  return card
}

beforeEach(() => {
  resetTelemetryBuffer()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  removedPosts.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('Feed - a taken-down post vanishes from the displayed list', () => {
  it('hides the post at once, with no refresh, no placeholder and none of its text', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const removedText = cardOf('post-seed-fwupd-rumor').textContent ?? ''
    expect(removedText.length).toBeGreaterThan(20)
    expect(rowIds()).toHaveLength(SEEDED.length)

    act(() => removedPosts.add('post-seed-fwupd-rumor'))

    expect(rowIds()).toEqual(SEEDED.filter(id => id !== 'post-seed-fwupd-rumor'))
    // No trace: the removed post's text is nowhere in the document, and nothing says "removed".
    expect(document.body.textContent ?? '').not.toContain(removedText)
    expect(screen.queryByText(/removed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/moderat/i)).not.toBeInTheDocument()
  })

  it('keeps every surviving row mounted: the same DOM nodes, in the same order', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const before = screen.getAllByTestId('post-card')

    act(() => removedPosts.add('post-seed-fulco-coordination'))

    const after = screen.getAllByTestId('post-card')
    expect(after).toHaveLength(before.length - 1)
    for (const card of after) expect(before).toContain(card)
  })

  it('ignores an id it is not showing: no row is re-created and nothing is announced', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const before = screen.getAllByTestId('post-card')

    act(() => removedPosts.add('post-that-was-never-displayed'))

    expect(screen.getAllByTestId('post-card')).toEqual(before)
    screen.getAllByTestId('post-card').forEach((card, index) => {
      expect(card).toBe(before[index])
    })
  })

  it('says so in its own empty-state voice when every post has been removed', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      for (const id of SEEDED) removedPosts.add(id)
    })

    expect(screen.queryAllByTestId('post-card')).toHaveLength(0)
    expect(screen.getByText('No posts yet.')).toBeInTheDocument()
  })

  it('emits no telemetry of its own: still exactly one mount view', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => removedPosts.add('post-seed-fwupd-rumor'))

    const views = getEmittedTelemetryEvents().filter(event => event.eventType === 'view')
    expect(views).toHaveLength(1)
  })
})

describe('Feed - the "new posts" pill and a taken-down post', () => {
  it('takes a buffered post out: the count drops and the pill disappears at zero', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => postStore.appendPost(livePost('post-live-1')))
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('1 new post')

    act(() => removedPosts.add('post-live-1'))

    await waitFor(() => expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument())
  })

  it('what the pill loads no longer includes the removed post; the others still load', async () => {
    const user = userEvent.setup()
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      postStore.appendPost(livePost('post-live-1', { scenarioTime: '2033-09-04T16:00:00Z' }))
      postStore.appendPost(livePost('post-live-2', { scenarioTime: '2033-09-04T16:01:00Z' }))
    })
    expect(await screen.findByTestId('new-posts-pill')).toHaveTextContent('2 new posts')

    act(() => removedPosts.add('post-live-1'))
    await waitFor(() => expect(screen.getByTestId('new-posts-pill')).toHaveTextContent('1 new post'))

    await user.click(screen.getByTestId('new-posts-pill'))

    await waitFor(() => expect(rowIds()[0]).toBe('post-live-2'))
    expect(rowIds()).not.toContain('post-live-1')
  })

  it('never counts a post that was taken down BEFORE it arrived', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    act(() => {
      removedPosts.add('post-live-early')
      postStore.appendPost(livePost('post-live-early'))
    })
    await act(async () => {})

    expect(screen.queryByTestId('new-posts-pill')).not.toBeInTheDocument()
    expect(rowIds()).not.toContain('post-live-early')
  })

  it('a post the reader already loaded from the pill vanishes too', async () => {
    const user = userEvent.setup()
    renderFeed()
    await screen.findAllByTestId('post-card')
    act(() => postStore.appendPost(livePost('post-live-loaded')))
    await user.click(await screen.findByTestId('new-posts-pill'))
    await waitFor(() => expect(rowIds()[0]).toBe('post-live-loaded'))

    act(() => removedPosts.add('post-live-loaded'))

    expect(rowIds()).toEqual(SEEDED)
    expect(document.body.textContent ?? '').not.toContain('Live post post-live-loaded')
  })
})

describe('Feed - the viewer\'s own post', () => {
  it('vanishes when it is taken down, and stays gone', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const own = livePost('post-own-1', {
      authorPersonaId: personaIdForHandle('dreyes_fh'),
      text: 'My own post that gets removed',
    })
    act(() => {
      ownPostStore.add(toParticipantView(own))
      postStore.appendPost(own)
    })
    await waitFor(() => expect(rowIds()[0]).toBe('post-own-1'))

    act(() => removedPosts.add('post-own-1'))

    expect(rowIds()).toEqual(SEEDED)
    expect(document.body.textContent ?? '').not.toContain('My own post that gets removed')
  })
})

describe('Feed - focus when the removed post held it (NFR-001)', () => {
  it('moves focus to the feed region, never to <body>', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const button = within(cardOf('post-seed-fwupd-rumor')).getAllByRole('button')[0]
    if (button === undefined) throw new Error('no focusable control in the card')
    act(() => button.focus())
    expect(document.activeElement).toBe(button)

    act(() => removedPosts.add('post-seed-fwupd-rumor'))

    const region = screen.getByRole('region', { name: 'Home' })
    expect(document.activeElement).toBe(region)
    expect(region).toHaveAttribute('tabindex', '-1')
    expect(document.activeElement).not.toBe(document.body)
  })

  it('leaves focus alone when a DIFFERENT card (or nothing in the feed) held it', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')
    const button = within(cardOf('post-seed-fw-advisory')).getAllByRole('button')[0]
    if (button === undefined) throw new Error('no focusable control in the card')
    act(() => button.focus())

    act(() => removedPosts.add('post-seed-fwupd-rumor'))

    expect(document.activeElement).toBe(button)
  })

  it('does not steal focus from outside the feed', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      renderFeed()
      await screen.findAllByTestId('post-card')
      act(() => outside.focus())

      act(() => removedPosts.add('post-seed-fwupd-rumor'))

      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('moves focus to the feed region when the removed post\'s MEDIA VIEWER (portalled to <body>) held it', async () => {
    postStore.resetForTests({ withDemoFixtures: true })
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellContextProvider
              value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
            >
              <Feed onOpenThread={() => {}} />
            </ShellContextProvider>
          </SessionProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>,
    )
    const card = await waitFor(() => cardOf(DEMO_IDS.grid2))
    await user.click(within(card).getAllByTestId('media-tile')[0] as HTMLElement)
    const viewer = await screen.findByTestId('media-viewer')
    // The viewer is portalled OUT of the feed region and holds focus.
    expect(screen.getByRole('region', { name: 'Home' }).contains(viewer)).toBe(false)
    expect(viewer.contains(document.activeElement)).toBe(true)

    act(() => removedPosts.add(DEMO_IDS.grid2))

    await waitFor(() => expect(screen.queryByTestId('media-viewer')).toBeNull())
    const region = screen.getByRole('region', { name: 'Home' })
    expect(document.activeElement).toBe(region)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('a removal elsewhere does not pull focus from a viewer that stays open', async () => {
    postStore.resetForTests({ withDemoFixtures: true })
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellContextProvider
              value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
            >
              <Feed onOpenThread={() => {}} />
            </ShellContextProvider>
          </SessionProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>,
    )
    const card = await waitFor(() => cardOf(DEMO_IDS.grid2))
    await user.click(within(card).getAllByTestId('media-tile')[0] as HTMLElement)
    const viewer = await screen.findByTestId('media-viewer')
    const held = document.activeElement

    act(() => removedPosts.add('post-seed-fwupd-rumor'))

    expect(screen.getByTestId('media-viewer')).toBe(viewer)
    expect(document.activeElement).toBe(held)
  })

  it('does not make the region a Tab stop (tabIndex -1 only)', async () => {
    const user = userEvent.setup()
    renderFeed()
    await screen.findAllByTestId('post-card')

    await user.tab()

    expect(document.activeElement).not.toBe(screen.getByRole('region', { name: 'Home' }))
  })
})
