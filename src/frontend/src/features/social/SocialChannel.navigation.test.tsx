/**
 * features/social/SocialChannel.navigation.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the Wave-S3.1 orchestrator integration seam wiring hashtag-feed and
 * profile navigation into the Social channel's local view-state machine
 * (hashtags-trending/01 SOC-040 + profiles-social-graph/01 SOC-050 —
 * "integration seam" in both features' implementation.md):
 *  - tapping a linkified hashtag in a post opens THAT hashtag's feed IN the
 *    channel (Phase-1 local view state, no router), replacing the feed, and
 *    "Back to feed" returns;
 *  - "View my profile" (the reachability entry point this pass adds — see
 *    `SocialChannel.tsx`'s module header for why the author-tap trigger is
 *    deferred) opens the session's own persona profile, and "Back to feed"
 *    returns.
 *
 * `useFeed` is mocked with one fixture post carrying a deterministic hashtag —
 * the shipped mock feed's seeded posts carry none (see `postService.ts`) — so
 * this proves the WIRING, not hashtag parsing itself (covered by
 * `PostCard.hashtags.test.tsx`/`hashtags.test.ts`). `<Feed>` and `<HashtagFeed>`
 * both resolve `useFeed` from the SAME module path, so the hashtag feed's
 * filter sees the exact fixture post. Renders through the real provider stack
 * (mirrors `SocialChannel.test.tsx`).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import { personaById, personaIdForHandle } from '@/features/personas'
import type { PostCounts, PostView } from './components/PostCard'
import type { UseFeedResult } from './hooks/useFeed'
import { SocialChannel } from './SocialChannel'

// A scenario "now" just after the fixture post's instant, mirrors
// `SocialChannel.test.tsx`'s fixed-clock rationale (a FIXED instant, never a
// wall-clock read).
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function buildCounts(overrides: Partial<PostCounts> = {}): PostCounts {
  return { reply: 1, repost: 2, like: 3, ...overrides }
}

/** The one fixture post `useFeed` resolves to — carries a deterministic
 * hashtag the seeded mock feed has none of. */
function buildHashtagPost(): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'post-with-hashtag',
    author,
    text: 'Boil water advisory update for #Zone2 residents.',
    counts: buildCounts(),
    scenarioTime: '2033-09-04T13:15:00.000Z',
  }
}

const useFeedMock = vi.hoisted(() => vi.fn<() => UseFeedResult>())
vi.mock('./hooks/useFeed', () => ({ useFeed: useFeedMock }))

function renderChannel() {
  setExerciseClock(fixedClock(SCENARIO_NOW))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant: 'full', scenarioNow: SCENARIO_NOW }
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

beforeEach(() => {
  useFeedMock.mockReturnValue({ posts: [buildHashtagPost()], loading: false, error: undefined })
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  useFeedMock.mockReset()
})

describe('SocialChannel — hashtag feed navigation (hashtags-trending/01, SOC-040)', () => {
  it('opens the tapped hashtag\'s feed and returns via "Back to feed"', async () => {
    const user = userEvent.setup()
    renderChannel()

    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(screen.getByText('#Zone2'))

    // The hashtag feed shows its NORMALIZED tag as the heading (lowercased).
    expect(await screen.findByRole('heading', { name: '#zone2' })).toBeInTheDocument()
    expect(screen.getByTestId('social-hashtag-region')).toBeInTheDocument()
    expect(screen.getByTestId('social-feed-region')).not.toBeVisible()
    // The fixture post carries the tag, so it re-renders inside the hashtag feed too.
    expect(within(screen.getByTestId('social-hashtag-region')).getByText('#Zone2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to feed/i }))

    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(screen.queryByTestId('social-hashtag-region')).not.toBeInTheDocument()
  })
})

describe('SocialChannel — profile reachability (profiles-social-graph/01, SOC-050)', () => {
  it('opens the viewer\'s own profile via "View my profile" and returns via "Back to feed"', async () => {
    const user = userEvent.setup()
    renderChannel()

    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const profileLink = screen.getByRole('button', { name: /view my profile/i })
    await user.click(profileLink)

    // The mock session's bound persona is Dana Reyes (`persona-dreyes_fh`).
    expect(await screen.findByRole('heading', { name: 'Dana Reyes' })).toBeInTheDocument()
    expect(screen.getByTestId('social-profile-region')).toBeInTheDocument()
    expect(screen.getByTestId('social-feed-region')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: /back to feed/i }))

    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(screen.queryByTestId('social-profile-region')).not.toBeInTheDocument()
  })
})
