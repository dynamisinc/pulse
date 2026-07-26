/**
 * features/social/SocialChannel.authorTapThrough.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the author tap-through seam of the profiles-social-graph final
 * integration pass (#88; SOC-050, NFR-001, COR-053):
 *  - tapping a post's author identity opens THAT author's profile in-channel
 *    from EVERY surface that renders a `<PostCard>` — the feed, an open
 *    thread, and a hashtag feed;
 *  - the card's own thread-open target still works and is not shadowed by the
 *    new author target;
 *  - focus lands in the newly-opened detail region on a DETAIL→DETAIL
 *    transition (thread → profile) — the SUG-001 gap this pass closes.
 *
 * `useFeed` is mocked with two fixture posts whose ids are REAL seeded post
 * ids (`postService.ts`), so `useThread` — which reads the post store, not
 * this hook — can still resolve a thread for the one we open. One fixture
 * carries a deterministic hashtag (the shipped seeds carry none) so the
 * hashtag-feed surface is reachable, and the two have DIFFERENT authors so
 * "opens THAT author's profile" is actually proven, not merely "opens a
 * profile". `<Feed>` and `<HashtagFeed>` resolve `useFeed` from the same
 * module path, so both see the fixtures. Renders through the real provider
 * stack (mirrors `SocialChannel.navigation.test.tsx`).
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
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import type { PostCounts, PostView } from './components/PostCard'
import type { UseFeedResult } from './hooks/useFeed'
import { SocialChannel } from './SocialChannel'

/** A FIXED scenario "now" just after the seeded Fairhaven arc (COR-053 — never
 * a wall-clock read). */
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

/** A real seeded post id, so `useThread` can resolve a thread for it. */
const THREADABLE_POST_ID = 'post-seed-fw-advisory'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function seededPersona(handle: string): Persona {
  const persona = personaById(personaIdForHandle(handle))
  if (!persona) throw new Error(`fixture missing seeded persona @${handle}`)
  return persona
}

function buildCounts(overrides: Partial<PostCounts> = {}): PostCounts {
  return { reply: 1, repost: 2, like: 3, ...overrides }
}

const AGENCY = () => seededPersona('FairhavenWater')
const RESIDENT = () => seededPersona('kwardFH')

/** Two fixtures, different authors; the first carries the hashtag. */
function buildPosts(): PostView[] {
  return [
    {
      id: THREADABLE_POST_ID,
      author: AGENCY(),
      text: 'Boil water advisory update for #Zone2 residents.',
      counts: buildCounts(),
      scenarioTime: '2033-09-04T13:15:00.000Z',
    },
    {
      id: 'post-seed-kward-correction',
      author: RESIDENT(),
      text: 'Get your updates from the official utility account, not the copycat.',
      counts: buildCounts(),
      scenarioTime: '2033-09-04T14:20:00.000Z',
    },
  ]
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

/** The visible All Posts panel — scoping every feed query to it keeps hidden
 * regions (which stay MOUNTED behind a detail view) out of the results. */
function feedPanel(): HTMLElement {
  return screen.getByTestId('social-feed-panel-all')
}

/** First element, guarded — no bare `[0]` (strict index access) and no `!`. */
function first<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('expected at least one element')
  return item
}

/** The author target for `persona` inside `scope`, found by the persona id the
 * card carries — never by scraping a display string. */
function authorTargetFor(scope: HTMLElement, persona: Persona): HTMLElement {
  const target = within(scope)
    .getAllByTestId('post-author-target')
    .find(node => node.getAttribute('data-persona-id') === persona.id)
  if (target === undefined) throw new Error(`no author target for ${persona.id}`)
  return target
}

beforeEach(() => {
  useFeedMock.mockReturnValue({ posts: buildPosts(), loading: false, error: undefined })
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  useFeedMock.mockReset()
})

describe('SocialChannel — author tap-through opens that author\'s profile (SOC-050)', () => {
  it('opens the tapped author\'s profile from the feed', async () => {
    const user = userEvent.setup()
    renderChannel()
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // Deliberately NOT the first card — proves the profile follows the tapped
    // author rather than "whichever post happened to be on top".
    await user.click(authorTargetFor(feedPanel(), RESIDENT()))

    expect(
      await screen.findByRole('heading', { name: RESIDENT().displayName }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('social-profile-region')).toBeInTheDocument()
    expect(screen.getByTestId('social-feed-region')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: /back to feed/i }))
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(screen.queryByTestId('social-profile-region')).not.toBeInTheDocument()
  })

  it('opens the tapped author\'s profile from inside an OPEN THREAD, and moves focus (SUG-001)', async () => {
    const user = userEvent.setup()
    renderChannel()
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // Feed -> thread (the card's own open target still works, unshadowed).
    await user.click(first(within(feedPanel()).getAllByTestId('post-open-target')))
    const thread = await screen.findByTestId('social-thread-region')
    expect(thread).toHaveFocus()

    // Thread -> profile: a DETAIL->DETAIL transition.
    await user.click(authorTargetFor(thread, AGENCY()))

    expect(
      await screen.findByRole('heading', { name: AGENCY().displayName }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('social-thread-region')).not.toBeInTheDocument()
    // Focus followed the swap into the newly-shown region instead of being
    // stranded on the now-unmounted author control (NFR-001).
    expect(screen.getByTestId('social-profile-region')).toHaveFocus()
  })

  it('opens the tapped author\'s profile from inside a HASHTAG FEED, and moves focus (SUG-001)', async () => {
    const user = userEvent.setup()
    renderChannel()
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    // Feed -> hashtag feed.
    await user.click(within(feedPanel()).getByText('#Zone2'))
    const hashtagRegion = await screen.findByTestId('social-hashtag-region')

    // Hashtag feed -> profile: another DETAIL->DETAIL transition.
    await user.click(authorTargetFor(hashtagRegion, AGENCY()))

    expect(
      await screen.findByRole('heading', { name: AGENCY().displayName }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('social-hashtag-region')).not.toBeInTheDocument()
    expect(screen.getByTestId('social-profile-region')).toHaveFocus()
  })

  it('still opens the thread from a card body tap — the author target does not shadow it', async () => {
    const user = userEvent.setup()
    renderChannel()
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(first(within(feedPanel()).getAllByTestId('post-open-target')))

    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
    expect(screen.queryByTestId('social-profile-region')).not.toBeInTheDocument()
  })
})
