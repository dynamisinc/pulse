/**
 * features/social/pages/Profile.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 01's profile page (SOC-050, COR-001, COR-053, XC-004,
 * NFR-001), rendered through the REAL provider stack the shipped app uses
 * (ExerciseContext + Session resolve via their built-in mock adapters — same
 * pattern as Feed.test.tsx / PostCard.test.tsx):
 *  - the identity hero renders (banner, avatar, name, handle, bio, joined,
 *    follower/following counts);
 *  - the verified mark renders for a verified persona and is ABSENT for the
 *    unverified lookalike (SOC-052 — presence/absence is the only signal);
 *  - the four tabs render and switch, each listing the exercise-scoped posts
 *    through <PostCard> (COR-001) with honest empty states (D1-012);
 *  - the joined date renders in scenario time in the exercise zone (COR-053),
 *    including a backdated pre-exercise join instant;
 *  - exactly ONE 'view' telemetry event fires on resolve, with a profile
 *    target + participant attribution, in scenario time (XC-004); the emit
 *    guard is keyed on `persona.id` (a last-emitted ref, mirroring
 *    `HashtagFeed`), so re-pointing this already-mounted page at a DIFFERENT
 *    personaId (no unmount) re-emits exactly once, while a re-render on the
 *    SAME id does not;
 *  - an unknown persona fails gracefully in-fiction (no crash, no COBRA).
 *  - WR-003 (COR-015/D1-011): under a read-only/observer shell variant, every
 *    <PostCard> this page renders has its action controls ABSENT (not
 *    disabled) — counts and content stay visible; under the default 'full'
 *    variant the controls are present. Mirrors `Feed.actions.test.tsx`'s
 *    assertions.
 *
 * `api.post` (the telemetry sink's fire-and-forget send) is spied to resolve so
 * a rejected mock POST can't race worker teardown; `api.get` (and its mock
 * adapters for the provider/persona/feed reads) is left intact.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import {
  formatScenarioTime,
  resetExerciseClock,
  setExerciseClock,
  type IExerciseClock,
} from '@/core/clock'
import {
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
} from '@/core/telemetry'
import { api } from '@/core/services/api'
import { personaById } from '@/features/personas'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { formatMagnitude } from '../services/audience'
import { Profile } from './Profile'

const MOCK_TIME_ZONE = 'America/New_York'
const FW_ID = 'persona-fairhavenwater' // verified org, authored post-seed-fw-advisory
const FWUPD_ID = 'persona-fairhavenwaterupd' // unverified lookalike (SOC-052)
const NEWSLINE_ID = 'persona-newsline7' // authored a post WITH media
const TBRANDT_ID = 'persona-tbrandt41' // seeded persona with NO posts

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** Renders <Profile> through the real provider stack for a given persona, at
 * a given shell variant (defaults to 'full' — every existing assertion in
 * this suite was written against the full/interactive variant). */
function renderProfile(personaId: string, variant: ShellVariant = 'full') {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Profile personaId={personaId} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  // Telemetry send is fire-and-forget; resolve it so a rejected POST can't
  // surface as an unhandled rejection during teardown.
  vi.spyOn(api, 'post').mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} })
})

afterEach(() => {
  resetExerciseClock()
  vi.restoreAllMocks()
})

describe('Profile — identity hero (SOC-050)', () => {
  it('renders banner, avatar, name, handle, bio and follower counts', async () => {
    renderProfile(FW_ID)

    const heading = await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByTestId('profile-banner')).toBeInTheDocument()
    // Scoped to the hero — the tab's <PostCard> reuses the same handle/avatar.
    const hero = screen.getByTestId('profile-identity')
    expect(within(hero).getByText('@FairhavenWater')).toBeInTheDocument()
    // R-004 avatar treatment — an org gets a monogram.
    expect(within(hero).getByTestId('post-avatar')).toHaveAttribute('data-avatar-kind', 'org')

    const persona = personaById(FW_ID)
    if (!persona) throw new Error('expected seeded persona fixture')
    if (persona.bio) expect(within(hero).getByText(persona.bio)).toBeInTheDocument()

    // SOC-054 / story 05 AC1: the count is MAGNITUDE-FORMATTED ("50.2K"), not the raw
    // locale integer story 01 originally rendered. `formatMagnitude` truncates, so a
    // displayed count is never overstated.
    const expectedFollowers = formatMagnitude(persona.followerCount)
    expect(within(screen.getByTestId('follower-count')).getByText(expectedFollowers)).toBeInTheDocument()
    expect(screen.getByTestId('following-count')).toBeInTheDocument()
  })
})

describe('Profile — Followers expand (story 05, D1-012 + XC-004)', () => {
  it('is collapsed by default, expands the follower list, and emits exactly one view event', async () => {
    renderProfile(FW_ID)
    await screen.findByTestId('profile-identity')

    expect(screen.queryByTestId('profile-followers')).toBeNull()

    const toggle = screen.getByTestId('follower-count')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const before = getEmittedTelemetryEvents()
      .filter(e => e.target?.entityId === `${FW_ID}:followers`).length

    await act(async () => { toggle.click() })

    expect(await screen.findByTestId('profile-followers')).toBeInTheDocument()
    expect(screen.getByTestId('follower-count')).toHaveAttribute('aria-expanded', 'true')

    // XC-004: expanding Followers is a participant view action and must not be silent
    // in the AAR (story 05 review, WR-005).
    const after = getEmittedTelemetryEvents()
      .filter(e => e.target?.entityId === `${FW_ID}:followers`).length
    expect(after).toBe(before + 1)

    // Collapsing is not a view — it must not emit again.
    await act(async () => { screen.getByTestId('follower-count').click() })
    expect(screen.queryByTestId('profile-followers')).toBeNull()
    expect(
      getEmittedTelemetryEvents().filter(e => e.target?.entityId === `${FW_ID}:followers`).length,
    ).toBe(before + 1)
  })
})

describe('Profile — verified signal (SOC-052)', () => {
  it('renders the verified mark for a verified persona', async () => {
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    // Scoped to the hero — the tab's <PostCard> for a verified author renders
    // its own mark too.
    const hero = screen.getByTestId('profile-identity')
    expect(within(hero).getByTestId('verified-mark')).toBeInTheDocument()
  })

  it('renders NO verified mark for the unverified lookalike (impersonation stays possible)', async () => {
    renderProfile(FWUPD_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Update' })
    // The ONLY credibility difference is the missing mark — no substitute badge.
    expect(screen.queryByTestId('verified-mark')).not.toBeInTheDocument()
  })
})

describe('Profile — tabs (SOC-050, COR-001, NFR-001)', () => {
  it('renders the four timeline tabs', async () => {
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const tablist = screen.getByRole('tablist')
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual([
      'Posts',
      'Posts & replies',
      'Media',
      'Likes',
    ])
  })

  it('lists the persona’s authored posts via <PostCard> in the Posts tab', async () => {
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const cards = await screen.findAllByTestId('post-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveAttribute('data-post-id', 'post-seed-fw-advisory')
  })

  it('shows an honest empty state on the Likes tab (never fabricated entries)', async () => {
    const user = userEvent.setup()
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))
    expect(screen.getByText('No likes to show.')).toBeInTheDocument()
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
  })

  it('shows only posts with media on the Media tab', async () => {
    const user = userEvent.setup()
    renderProfile(NEWSLINE_ID)
    await screen.findByRole('heading', { name: 'Newsline 7' })

    await user.click(screen.getByRole('tab', { name: 'Media' }))
    const cards = await screen.findAllByTestId('post-card')
    expect(cards).toHaveLength(1)
    const [mediaCard] = cards
    if (!mediaCard) throw new Error('expected a media post card')
    expect(mediaCard).toHaveAttribute('data-post-id', 'post-seed-newsline7-breaking')
    expect(within(mediaCard).getByTestId('post-media')).toBeInTheDocument()
  })

  it('shows an empty state for a persona with no posts', async () => {
    renderProfile(TBRANDT_ID)
    await screen.findByRole('heading', { name: 'Tom Brandt' })
    expect(await screen.findByText('No posts yet.')).toBeInTheDocument()
  })
})

describe('Profile — scenario time (COR-053)', () => {
  it('renders the joined date in scenario time in the exercise zone, incl. a backdated instant', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T15:00:00.000Z')))
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const persona = personaById(FW_ID)
    if (!persona) throw new Error('expected seeded persona fixture')
    const joined = screen.getByTestId('profile-joined')
    // The seeded joinedAt PREDATES the 2033 exercise (E1 COR-023 backdating) and
    // renders through the scenario-time utility in the exercise zone — not wall
    // clock, not the runtime's local zone.
    expect(joined).toHaveAttribute('datetime', persona.joinedAt)
    expect(joined).toHaveTextContent(
      formatScenarioTime(persona.joinedAt, MOCK_TIME_ZONE, { format: 'dateline' }),
    )
  })
})

describe('Profile — telemetry (XC-004)', () => {
  it('emits exactly one "view" event on resolve, with a profile target + scenario time', async () => {
    setExerciseClock(fixedClock(new Date('2033-09-04T15:00:00.000Z')))
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    await waitFor(() => {
      expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
    })

    const view = getEmittedTelemetryEvents().find(e => e.eventType === 'view')
    expect(view?.channel).toBe('social')
    expect(view?.actor).toMatchObject({ kind: 'participant', participantId: 'acct-dreyes' })
    expect(view?.target).toEqual({ entityType: 'profile', entityId: FW_ID })
    expect(view?.scenarioTime).toBe('2033-09-04T15:00:00.000Z')
    expect(typeof view?.wallClockTime).toBe('string')
  })

  it('re-emits a view event when re-pointed at a DIFFERENT personaId without unmounting', async () => {
    const utils = renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await waitFor(() => {
      expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
    })

    // Simulates a future profile->profile navigation that reuses this already
    // -mounted <Profile> with a different personaId (SocialChannel re-pointing
    // view.kind='profile', no unmount) — the persona.id-keyed ref must re-emit.
    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={TBRANDT_ID} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    await screen.findByRole('heading', { name: 'Tom Brandt' })
    await waitFor(() => {
      const views = getEmittedTelemetryEvents().filter(e => e.eventType === 'view')
      expect(views).toHaveLength(2)
      expect(views.map(e => e.target)).toEqual([
        { entityType: 'profile', entityId: FW_ID },
        { entityType: 'profile', entityId: TBRANDT_ID },
      ])
    })
  })

  it('does NOT re-emit a view event on a re-render with the SAME personaId', async () => {
    const utils = renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await waitFor(() => {
      expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
    })

    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={FW_ID} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(1)
  })
})

describe('Profile — unknown persona', () => {
  it('fails gracefully in-fiction for an unknown persona id', async () => {
    renderProfile('persona-does-not-exist')
    expect(await screen.findByText('This account doesn’t exist.')).toBeInTheDocument()
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'view')).toHaveLength(0)
  })
})

describe('Profile — read-only shell variant (WR-003, COR-015/D1-011)', () => {
  it('renders NO action controls on the profile’s post cards under a read-only (observer) session', async () => {
    renderProfile(FW_ID, 'readOnly')
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const actionsRegions = await screen.findAllByTestId('post-actions')
    expect(actionsRegions.length).toBeGreaterThan(0)
    for (const region of actionsRegions) {
      expect(within(region).queryAllByRole('button')).toHaveLength(0)
    }

    // Counts/content stay fully visible — only the affordances go (never a
    // data leak, just absent controls).
    const cards = await screen.findAllByTestId('post-card')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('renders the interactive action controls on the profile’s post cards under the full variant', async () => {
    renderProfile(FW_ID, 'full')
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const actionsRegions = await screen.findAllByTestId('post-actions')
    expect(actionsRegions.length).toBeGreaterThan(0)
    for (const region of actionsRegions) {
      expect(within(region).queryAllByRole('button').length).toBeGreaterThan(0)
    }
  })
})
