/**
 * features/social/pages/HashtagFeed.test.tsx
 * ---------------------------------------------------------------------------
 * Covers hashtags-trending story 01's hashtag feed page (SOC-040, COR-001,
 * COR-053, XC-004, NFR-001):
 *  - the feed shows ONLY posts carrying the given hashtag, filtered
 *    case-insensitively over the already exercise-scoped `useFeed()` read
 *    (COR-001 — no independent, client-parameterized re-fetch);
 *  - "Latest" is chronological (newest-first); "Top" is engagement-ranked,
 *    newest-first as the tiebreak (SOC-040);
 *  - every post's timestamp renders in scenario time, never wall-clock
 *    (COR-053);
 *  - exactly ONE 'view' telemetry event is emitted per hashtag on mount,
 *    re-emitting when re-pointed at a different tag but NOT on a Latest/Top
 *    tab switch (XC-004);
 *  - an empty match set renders the empty-state message;
 *  - the tab affordance is exposed accessibly (role="tablist"/"tab",
 *    aria-selected) (NFR-001).
 *
 * Renders through the real provider stack (mirrors `Feed.test.tsx`/
 * `PostCard.test.tsx`), seeding `postStore` with fixture posts so hashtag
 * membership and ordering are deterministic and independent of the shared
 * Fairhaven seed content.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'
import { HashtagFeed } from './HashtagFeed'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-ht-fixture',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text: 'placeholder #Zone2 text',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

/** Renders <HashtagFeed> through the real provider stack for `tag`. */
function renderHashtagFeed(tag: string, variant: ShellVariant = 'full') {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
        >
          <HashtagFeed tag={tag} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  postStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('HashtagFeed — filters to the tagged posts only (SOC-040, COR-001)', () => {
  it('shows only posts whose text carries the hashtag, matching case-insensitively', async () => {
    postStore.appendPost(
      buildPost({ id: 'post-ht-match-1', text: 'Update on #Zone2 water quality.' }),
    )
    postStore.appendPost(
      buildPost({ id: 'post-ht-match-2', text: 'Reminder: #zone2 boil advisory still active.' }),
    )
    postStore.appendPost(
      buildPost({ id: 'post-ht-other', text: 'Unrelated post about #Evacuation routes.' }),
    )

    renderHashtagFeed('zone2')

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.map(c => c.getAttribute('data-post-id')).sort()).toEqual([
      'post-ht-match-1',
      'post-ht-match-2',
    ])
  })

  it('renders the hashtag heading with the leading "#"', async () => {
    postStore.appendPost(buildPost({ id: 'post-ht-heading', text: 'About #Zone2 today.' }))

    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    expect(screen.getByRole('heading', { name: '#zone2' })).toBeInTheDocument()
  })
})

describe('HashtagFeed — empty state', () => {
  it('renders "No posts with #tag yet." when nothing matches', async () => {
    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
          >
            <HashtagFeed tag="nomatch" />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No posts with #nomatch yet.')).toBeInTheDocument()
    })
    expect(screen.queryAllByTestId('post-card')).toHaveLength(0)
  })
})

describe('HashtagFeed — Latest / Top tabs (SOC-040)', () => {
  function seedOrderingFixture() {
    // All three carry #zone2; scores/times chosen so Latest and Top disagree.
    postStore.appendPost(
      buildPost({
        id: 'post-ht-early-low',
        text: 'Earliest, low engagement #Zone2 post.',
        scenarioTime: '2033-09-04T13:00:00Z',
        counts: { reply: 1, repost: 1, like: 1 },
      }),
    )
    postStore.appendPost(
      buildPost({
        id: 'post-ht-mid-high',
        text: 'Middle, high engagement #Zone2 post.',
        scenarioTime: '2033-09-04T14:00:00Z',
        counts: { reply: 5, repost: 5, like: 5 },
      }),
    )
    postStore.appendPost(
      buildPost({
        id: 'post-ht-late-zero',
        text: 'Latest, zero engagement #Zone2 post.',
        scenarioTime: '2033-09-04T15:00:00Z',
        counts: { reply: 0, repost: 0, like: 0 },
      }),
    )
  }

  it('"Latest" (default) orders newest-first', async () => {
    seedOrderingFixture()
    renderHashtagFeed('zone2')

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.map(c => c.getAttribute('data-post-id'))).toEqual([
      'post-ht-late-zero',
      'post-ht-mid-high',
      'post-ht-early-low',
    ])
  })

  it('"Top" orders by engagement score, newest-first as the tiebreak', async () => {
    seedOrderingFixture()
    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    screen.getByRole('tab', { name: 'Top' }).click()

    await waitFor(() => {
      const cards = screen.getAllByTestId('post-card')
      expect(cards.map(c => c.getAttribute('data-post-id'))).toEqual([
        'post-ht-mid-high', // score 15
        'post-ht-early-low', // score 3
        'post-ht-late-zero', // score 0
      ])
    })
  })

  it('marks the active tab with aria-selected and updates it on click', async () => {
    seedOrderingFixture()
    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    const latestTab = screen.getByRole('tab', { name: 'Latest' })
    const topTab = screen.getByRole('tab', { name: 'Top' })
    expect(latestTab).toHaveAttribute('aria-selected', 'true')
    expect(topTab).toHaveAttribute('aria-selected', 'false')

    topTab.click()

    await waitFor(() => expect(topTab).toHaveAttribute('aria-selected', 'true'))
    expect(latestTab).toHaveAttribute('aria-selected', 'false')
  })

  it('exposes the tab affordance accessibly (NFR-001)', async () => {
    seedOrderingFixture()
    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    expect(screen.getByRole('tablist', { name: '#zone2 feed order' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })
})

describe('HashtagFeed — scenario time only, never wall-clock (COR-053)', () => {
  it("renders each matched post's relative time from the injected exercise clock", async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T15:00:00.000Z')))
    postStore.appendPost(
      buildPost({
        id: 'post-ht-time',
        text: 'Scenario-time check #Zone2.',
        scenarioTime: '2033-09-04T13:00:00Z',
      }),
    )

    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })
})

describe('HashtagFeed — hashtag-view telemetry (XC-004)', () => {
  it('emits exactly one "view" event on mount, targeting the hashtag entity', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T15:00:00.000Z')))
    postStore.appendPost(buildPost({ id: 'post-ht-telemetry', text: 'About #Zone2.' }))

    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    const views = getEmittedTelemetryEvents().filter(e => e.eventType === 'view')
    expect(views).toHaveLength(1)
    const view = views[0]
    expect(view?.channel).toBe('social')
    expect(view?.actor).toMatchObject({ kind: 'participant', participantId: 'acct-dreyes' })
    expect(view?.target).toEqual({ entityType: 'hashtag', entityId: 'zone2' })
    expect(view?.exerciseId).toBe('ex-mock-0001')
    expect(view?.scenarioTime).toBe('2033-09-04T15:00:00.000Z')
    expect(Number.isNaN(Date.parse(view?.wallClockTime ?? ''))).toBe(false)
  })

  it('does NOT re-emit a view event when only the Latest/Top tab changes', async () => {
    postStore.appendPost(buildPost({ id: 'post-ht-tabswitch', text: 'About #Zone2.' }))
    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)

    screen.getByRole('tab', { name: 'Top' }).click()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Top' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
  })

  it('re-emits a view event when re-pointed at a DIFFERENT hashtag', async () => {
    postStore.appendPost(buildPost({ id: 'post-ht-a', text: 'About #Zone2.' }))
    postStore.appendPost(buildPost({ id: 'post-ht-b', text: 'About #Evacuation.' }))

    const utils = renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)

    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00.000Z') }}
          >
            <HashtagFeed tag="evacuation" />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    await waitFor(() => {
      const views = getEmittedTelemetryEvents().filter(e => e.eventType === 'view')
      expect(views).toHaveLength(2)
      expect(views.map(e => e.target?.entityId)).toEqual(['zone2', 'evacuation'])
    })
  })
})

describe('HashtagFeed — shell variant drives card affordances (COR-015, D1-011)', () => {
  it('renders NO interactive controls under a read-only variant', async () => {
    postStore.appendPost(buildPost({ id: 'post-ht-readonly', text: 'About #Zone2.' }))

    renderHashtagFeed('zone2', 'readOnly')

    const actions = await screen.findAllByTestId('post-actions')
    expect(actions.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('button[data-action]')).toHaveLength(0)
  })
})

describe('HashtagFeed — list is a live, labelled region (NFR-001)', () => {
  it('exposes the matched post list as an aria-live tabpanel labelled with the active tab', async () => {
    postStore.appendPost(buildPost({ id: 'post-ht-live', text: 'About #Zone2.' }))
    renderHashtagFeed('zone2')
    await screen.findAllByTestId('post-card')

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-live', 'polite')
    expect(panel).toHaveAttribute('aria-label', '#zone2, Latest')
    expect(within(panel).getAllByTestId('post-card')).toHaveLength(1)
  })
})
