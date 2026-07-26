/**
 * features/social/SocialChannel.feedSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the two remaining seams of the profiles-social-graph final
 * integration pass (#88):
 *
 *  1. ALL POSTS ↔ FOLLOWING (SOC-080/SOC-081, COR-015, NFR-001, XC-004) — the
 *     in-channel tablist. Asserts the WAI-ARIA selected-state semantics (never
 *     colour alone), that switching actually swaps which feed is showing, that
 *     the two scopes are SEPARATE MOUNTED INSTANCES (the inactive one stays in
 *     the DOM, hidden, so its frozen baseline + scroll position survive), and
 *     that each instance emits its own ONE-SHOT mount `view` event — one per
 *     scope, no re-emit on a switch back.
 *  2. `<WhoToFollow>` (SOC-053) mounted in the FEED region: present alongside
 *     the feed, absent from every detail view.
 *
 * Observer coverage: a `readOnly` shell mount gets NO switch at all (the
 * documented decision — a Following control it may never be served would be an
 * affordance that silently does nothing; D1-011's absent-not-disabled rule).
 * The no-persona session axis lives in the sibling
 * `SocialChannel.feedSwitch.noPersona.test.tsx`, which must mock
 * `@/core/auth` module-wide.
 *
 * Runs against the shipped mock seams through the real provider stack (mirrors
 * `SocialChannel.test.tsx`) — no `useFeed` mock, so the Following scope really
 * does resolve through `resolveFeed('following')` and the mock follow edges.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { setMockFollowingForTests } from './services/feedService'
import { SocialChannel } from './SocialChannel'

/** A FIXED scenario "now" just after the seeded Fairhaven arc (COR-053). */
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function renderChannel(variant: ShellVariant = 'full') {
  setExerciseClock(fixedClock(SCENARIO_NOW))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant, scenarioNow: SCENARIO_NOW }
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={mount}>
            <SocialChannel />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

/** The feed-scope `view` events emitted so far, newest last. */
function feedViewTargets(): string[] {
  return getEmittedTelemetryEvents()
    .filter(event => event.eventType === 'view' && event.target?.entityType === 'feed')
    .map(event => event.target?.entityId ?? '')
}

beforeEach(() => {
  resetTelemetryBuffer()
  // The default mock follow set: @FairhavenWater + @kwardFH — a strict SUBSET
  // of the seeded cast, so "Following is genuinely a different feed" is
  // observable (the impersonator is absent from it).
  setMockFollowingForTests(undefined)
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('SocialChannel — All Posts / Following switch (SOC-081)', () => {
  it('renders a tablist with All Posts selected by default (state, not colour)', async () => {
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    expect(screen.getByRole('tablist', { name: 'Feed' })).toBeInTheDocument()
    const allTab = screen.getByRole('tab', { name: 'All Posts' })
    const followingTab = screen.getByRole('tab', { name: 'Following' })
    expect(allTab).toHaveAttribute('aria-selected', 'true')
    expect(followingTab).toHaveAttribute('aria-selected', 'false')
    // Roving tabindex — only the selected tab is in the natural Tab order.
    expect(allTab).toHaveAttribute('tabindex', '0')
    expect(followingTab).toHaveAttribute('tabindex', '-1')
    // Each tab is programmatically bound to the panel it controls.
    expect(allTab).toHaveAttribute('aria-controls', 'social-feed-panel-all')
  })

  it('switches to the Following feed and back, keeping both instances mounted', async () => {
    const user = userEvent.setup()
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // Only All Posts is mounted until the reader asks for Following.
    expect(screen.queryByTestId('social-feed-panel-following')).not.toBeInTheDocument()
    // The unfiltered firehose includes the unfollowed impersonator.
    expect(
      within(screen.getByTestId('social-feed-panel-all')).getByText('@FairhavenWaterUpd'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Following' }))

    const following = await screen.findByTestId('social-feed-panel-following')
    await waitFor(() =>
      expect(within(following).getAllByTestId('post-card').length).toBeGreaterThan(0),
    )
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'All Posts' })).toHaveAttribute('aria-selected', 'false')
    expect(following).toBeVisible()
    // A genuinely different feed — nothing from an account the viewer doesn't follow.
    expect(within(following).queryByText('@FairhavenWaterUpd')).not.toBeInTheDocument()
    expect(within(following).getByText('@FairhavenWater')).toBeInTheDocument()

    // The All Posts instance is HIDDEN, not unmounted — its frozen baseline and
    // scroll position survive the round trip.
    const allPanel = screen.getByTestId('social-feed-panel-all')
    expect(allPanel).toBeInTheDocument()
    expect(allPanel).not.toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'All Posts' }))

    await waitFor(() => expect(screen.getByTestId('social-feed-panel-all')).toBeVisible())
    expect(screen.getByTestId('social-feed-panel-following')).not.toBeVisible()
  })

  it('emits exactly one mount view per scope — no re-emit on a switch back (XC-004)', async () => {
    const user = userEvent.setup()
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // The Following instance is not mounted yet, so it has emitted nothing.
    expect(feedViewTargets()).toEqual(['all-posts'])

    await user.click(screen.getByRole('tab', { name: 'Following' }))
    await screen.findByTestId('social-feed-panel-following')
    await waitFor(() => expect(feedViewTargets()).toEqual(['all-posts', 'following-feed']))

    await user.click(screen.getByRole('tab', { name: 'All Posts' }))
    await user.click(screen.getByRole('tab', { name: 'Following' }))
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-following')).toBeVisible())

    // Still one per scope: neither instance remounted, so neither re-emitted.
    expect(feedViewTargets()).toEqual(['all-posts', 'following-feed'])
  })

  it('moves the selection with the arrow keys (NFR-001)', async () => {
    const user = userEvent.setup()
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    screen.getByRole('tab', { name: 'All Posts' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-following')).toBeVisible())

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'All Posts' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers an observer NO switch at all — All Posts only (COR-015/D1-011)', async () => {
    renderChannel('readOnly')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // Absent, never present-and-inert: no tablist, no tabs, no Following panel.
    expect(screen.queryByRole('tablist', { name: 'Feed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Following' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('social-feed-panel-following')).not.toBeInTheDocument()
    // The All Posts feed is still fully readable.
    expect(screen.getByTestId('social-feed-panel-all')).toBeVisible()
    expect(feedViewTargets()).toEqual(['all-posts'])
  })
})

describe('SocialChannel — Who to follow placement (SOC-053)', () => {
  it('mounts the module in the feed region, never inside a post card', async () => {
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const module = await screen.findByTestId('who-to-follow')
    expect(module).toBeVisible()
    expect(screen.getByTestId('social-feed-region').contains(module)).toBe(true)
    for (const card of screen.getAllByTestId('post-card')) {
      expect(card.contains(module)).toBe(false)
    }
  })

  it('does not appear in the thread / profile detail views', async () => {
    const user = userEvent.setup()
    renderChannel('full')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    await screen.findByTestId('who-to-follow')

    const [openTarget] = screen.getAllByTestId('post-open-target')
    if (openTarget === undefined) throw new Error('expected an open target')
    await user.click(openTarget)
    await screen.findByTestId('thread-view')
    // Hidden with the whole feed region — out of the a11y tree, not just off-screen.
    expect(screen.getByTestId('who-to-follow')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: /back to feed/i }))
    await waitFor(() => expect(screen.getByTestId('who-to-follow')).toBeVisible())

    await user.click(screen.getByRole('button', { name: /view my profile/i }))
    await screen.findByTestId('social-profile-region')
    expect(screen.getByTestId('who-to-follow')).not.toBeVisible()
  })
})
