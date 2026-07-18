/**
 * features/social/pages/Feed.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 01's All Posts feed page (SOC-080, COR-015, COR-053, XC-004,
 * NFR-001/002), rendered through the REAL provider stack the shipped app uses
 * (ExerciseContext + Session + ShellContext all resolve via their built-in mock
 * adapters, same pattern as PostCard.test.tsx):
 *  - every seeded public post renders via <PostCard>, newest-first;
 *  - the shell variant drives each card's variant (full → interactive,
 *    readOnly → controls absent);
 *  - exactly ONE 'view' telemetry event is emitted on mount, with the
 *    feed target + participant attribution, in scenario time (COR-053), and it
 *    does not re-emit on re-render;
 *  - the post list is an aria-live="polite" region (the story-04 pill seam).
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import {
  resetExerciseClock,
  setExerciseClock,
  type IExerciseClock,
} from '@/core/clock'
import {
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
} from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { Feed } from './Feed'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** Renders <Feed> through the real provider stack at a given shell variant. */
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

/** The seeded Fairhaven arc, newest-first by scenarioTime. */
const NEWEST_FIRST_IDS = [
  'post-seed-kward-correction', // 14:20
  'post-seed-mvega-question', // 14:05
  'post-seed-newsline7-breaking', // 13:50
  'post-seed-fulco-coordination', // 13:40
  'post-seed-fwupd-rumor', // 13:32
  'post-seed-fw-advisory', // 13:15
]

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

describe('Feed — chronological rendering (SOC-080, COR-053)', () => {
  it('renders every seeded public post via <PostCard>, newest-first', async () => {
    renderFeed()

    const cards = await screen.findAllByTestId('post-card')
    expect(cards.map(c => c.getAttribute('data-post-id'))).toEqual(NEWEST_FIRST_IDS)
  })
})

describe('Feed — a11y live region (NFR-001)', () => {
  it('wraps the post list in an aria-live="polite" region', async () => {
    renderFeed()
    await screen.findAllByTestId('post-card')

    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite')
  })
})

describe('Feed — shell variant drives card affordances (COR-015, D1-011)', () => {
  it('renders interactive action buttons under the "full" variant', async () => {
    renderFeed('full')

    await screen.findAllByTestId('post-card')
    expect(document.querySelectorAll('button[data-action]').length).toBeGreaterThan(0)
  })

  it('renders NO interactive controls under a read-only variant', async () => {
    renderFeed('readOnly')

    const actions = await screen.findAllByTestId('post-actions')
    expect(actions.length).toBeGreaterThan(0)
    // Controls are ABSENT, not disabled (COR-015) — no action buttons anywhere.
    expect(document.querySelectorAll('button[data-action]')).toHaveLength(0)
  })
})

describe('Feed — no provenance leak into the DOM (XC-002)', () => {
  it('never renders origin/actingHumanId/injectId values, though the seeded posts carry them', async () => {
    const { container } = renderFeed()
    await screen.findAllByTestId('post-card')

    // Values genuinely present on the seeded `Post` set (services/postService.ts)
    // that must never reach a participant-visible string.
    const provenanceValues = [
      'human-simcell-utility',
      'human-simcell-rumor',
      'system-engine',
      'human-participant-mvega',
      'human-participant-kward',
      'controller-as-persona',
    ]
    for (const value of provenanceValues) {
      expect(container.textContent).not.toContain(value)
    }
    // The inject-origin post's injectId ('042') rendered via the staff-only
    // console label would read "INJ-042" — assert that never appears either.
    expect(container.textContent).not.toMatch(/INJ-042/)
  })
})

describe('Feed — row DOM identity is stable across a re-render (NFR-002/SOC-071)', () => {
  it('does not remount a row when the feed re-renders with unchanged data', async () => {
    const utils = renderFeed()
    const cardsBefore = await screen.findAllByTestId('post-card')
    const firstCardBefore = cardsBefore[0]
    expect(firstCardBefore).toBeDefined()

    // Re-render the whole tree with a freshly-constructed (but equivalent)
    // shell context value — if a row's key were unstable, or `FeedRow` were
    // redefined per render instead of a stable memoized component, React
    // would tear down and recreate the DOM node here.
    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Feed />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    const cardsAfter = await screen.findAllByTestId('post-card')
    expect(cardsAfter[0]).toBe(firstCardBefore)
  })
})

describe('Feed — feed-view telemetry (XC-004)', () => {
  it('emits exactly one "view" event on mount, with feed target + scenario time', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T15:00:00.000Z')))
    renderFeed()

    await screen.findAllByTestId('post-card')

    const views = getEmittedTelemetryEvents().filter(e => e.eventType === 'view')
    expect(views).toHaveLength(1)

    const view = views[0]
    expect(view?.channel).toBe('social')
    expect(view?.actor).toMatchObject({ kind: 'participant', participantId: 'acct-dreyes' })
    expect(view?.target).toEqual({ entityType: 'feed', entityId: 'all-posts' })
    expect(view?.scenarioTime).toBe('2033-09-04T15:00:00.000Z')
    expect(typeof view?.wallClockTime).toBe('string')
  })

  it('does not re-emit the view event on re-render', async () => {
    const utils = renderFeed()
    await screen.findAllByTestId('post-card')

    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Feed />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    await waitFor(() => {
      expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
    })
  })
})
