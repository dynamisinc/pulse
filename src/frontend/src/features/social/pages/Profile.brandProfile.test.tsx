/**
 * features/social/pages/Profile.brandProfile.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Profile" AC — the profile finish, through the REAL provider
 * stack in mock mode (the same pattern as `Profile.test.tsx`):
 *
 *   - Hero: banner image from `bannerUrl` over an accent-tint fallback (a failed
 *     load, or no banner, leaves the tint), the avatar photo, a `location` row
 *     only when present, and the joined date in scenario time.
 *   - Real tabs: Posts (authored, top-level), Posts & replies (authored INCLUDING
 *     replies, via `includeReplies`), Likes (OWN profile only, from
 *     `viewer.liked`; everyone else's is the honest "Likes are private").
 *   - Loading: `ProfileSkeleton` while the cast resolves, `FeedSkeleton` while a tab
 *     loads, never "Loading…" text.
 *   - Forwarding: `onOpenThread` / `onHashtagOpen` / `onOpenProfile` reach the cards;
 *     Reply opens the thread (Gate-2 items 7/15).
 *
 * The demo fixtures (replies, liked posts, banners, a located persona) are opted in
 * with `postStore.resetForTests({ withDemoFixtures: true })` and reset after each test.
 * The mock viewer is `persona-dreyes_fh` ("Dana Reyes"): her OWN profile is the one
 * that shows Likes.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { formatScenarioTime, resetExerciseClock } from '@/core/clock'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { personaById } from '@/features/personas'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { resetMockReactions } from '../services/reactionService'
import { consumeReplyFocus, resetReplyIntent } from '../services/replyIntent'
import { postStore } from '../services/postStore'
import { Profile, type ProfileProps } from './Profile'

const OWN_ID = 'persona-dreyes_fh' // the mock session's persona
const FW_ID = 'persona-fairhavenwater'
const FULCO_ID = 'persona-fulcoem' // has a banner, an avatar and a location
const TBRANDT_ID = 'persona-tbrandt41' // no avatar, no banner, no location

const OWN1 = 'post-fx-own-1'
const OWN2 = 'post-fx-own-2'
const OWN_REPLY = 'post-fx-reply-dreyes'
const LIKED_GRID = 'post-fx-grid1' // viewer.liked, by Fulco
const LIKED_VIDEO = 'post-fx-video-poster' // viewer.liked + reposted, by Newsline

function renderProfile(personaId: string, handlers: Partial<ProfileProps> = {}) {
  // A QueryClient: the Likes tab renders video cards, and F2's VideoPlayer reads
  // `useChromeConfig()` (React Query) for the exercise watermark.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={personaId} {...handlers} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

/** The post ids of the cards currently rendered, in DOM (display) order. */
function cardIds(): string[] {
  return screen.queryAllByTestId('post-card').map(c => c.getAttribute('data-post-id') ?? '')
}

/** The `includeReplies` feed reads the page has made so far. */
function repliesReads(getSpy: { mock: { calls: unknown[][] } }): number {
  return getSpy.mock.calls.filter(([url, config]) => {
    const params = (config as AxiosRequestConfig | undefined)?.params as
      | Record<string, unknown>
      | undefined
    return url === '/feed' && params?.includeReplies === true
  }).length
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
  resetReplyIntent()
  postStore.resetForTests({ withDemoFixtures: true })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {}, status: 200, statusText: 'OK', headers: {}, config: {},
  })
})

afterEach(() => {
  resetExerciseClock()
  postStore.resetForTests()
  resetMockReactions()
  resetReplyIntent()
  vi.restoreAllMocks()
})

describe('Profile — loading shows skeletons, not text (NFR-001)', () => {
  it('shows the ProfileSkeleton (a polite status) while the cast resolves, then the profile', async () => {
    // Hold the persona read open so the loading state is observable, not a race.
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(((url: string, config?: AxiosRequestConfig) =>
      url === '/personas' ? gate.then(() => realGet(url, config)) : realGet(url, config)
    ) as typeof api.get)
    renderProfile(FW_ID)

    const skeleton = await screen.findByTestId('profile-skeleton')
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveTextContent('Loading profile')
    expect(screen.queryByText('Loading profile…')).not.toBeInTheDocument()

    release()
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    expect(screen.queryByTestId('profile-skeleton')).not.toBeInTheDocument()
  })

  it('shows the FeedSkeleton in the Posts & replies tab until its read lands', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const realGet = api.get.bind(api)
    const getSpy = vi.spyOn(api, 'get').mockImplementation(((
      url: string,
      config?: AxiosRequestConfig,
    ) => {
      const params = config?.params as Record<string, unknown> | undefined
      return url === '/feed' && params?.includeReplies === true
        ? gate.then(() => realGet(url, config))
        : realGet(url, config)
    }) as typeof api.get)
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Posts & replies' }))

    expect(await screen.findByTestId('feed-skeleton')).toHaveTextContent('Loading posts')
    expect(repliesReads(getSpy)).toBe(1)

    release()
    await waitFor(() => expect(cardIds()).toContain(OWN_REPLY))
    expect(screen.queryByTestId('feed-skeleton')).not.toBeInTheDocument()
  })
})

describe('Profile — hero: banner, avatar, location, joined', () => {
  it('renders the banner image from bannerUrl over the accent tint', async () => {
    renderProfile(FULCO_ID)
    await screen.findByRole('heading', { name: /FulCo|Fulton/i })

    const persona = personaById(FULCO_ID)
    if (!persona?.bannerUrl) throw new Error('expected a seeded persona with a banner')
    const banner = screen.getByTestId('profile-banner')
    expect(banner).toHaveAttribute('aria-hidden', 'true') // decorative: the name carries identity
    const image = within(banner).getByTestId('profile-banner-image')
    expect(image).toHaveAttribute('src', persona.bannerUrl)
    expect(image).toHaveAttribute('alt', '')
  })

  it('falls back to the accent tint when the banner fails to load', async () => {
    renderProfile(FULCO_ID)
    await screen.findByTestId('profile-banner-image')

    fireEvent.error(screen.getByTestId('profile-banner-image'))

    expect(screen.queryByTestId('profile-banner-image')).not.toBeInTheDocument()
    // The banner band itself stays (the tint), so nothing shifts.
    expect(screen.getByTestId('profile-banner')).toBeInTheDocument()
  })

  it('shows only the accent tint for a persona with no banner', async () => {
    renderProfile(TBRANDT_ID)
    await screen.findByRole('heading', { name: 'Tom Brandt' })

    expect(screen.getByTestId('profile-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-banner-image')).not.toBeInTheDocument()
  })

  it('refuses an unsafe bannerUrl (shows the tint instead)', async () => {
    // Re-point a seeded persona's banner at a script URL via the persona read seam.
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation((async (url: string, config?: AxiosRequestConfig) => {
      const response = await realGet(url, config)
      if (url === '/personas' && Array.isArray(response.data)) {
        return {
          ...response,
          data: response.data.map((p: { id: string }) =>
            p.id === FULCO_ID ? { ...p, bannerUrl: 'javascript:alert(1)' } : p),
        }
      }
      return response
    }) as typeof api.get)
    renderProfile(FULCO_ID)
    await screen.findByRole('heading', { name: /FulCo|Fulton/i })

    expect(screen.queryByTestId('profile-banner-image')).not.toBeInTheDocument()
  })

  it('renders the avatar photo in the hero, and the monogram/silhouette when there is none', async () => {
    const { unmount } = renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    const hero = screen.getByTestId('profile-identity')
    const avatar = within(hero).getByTestId('post-avatar')
    expect(avatar).toHaveAttribute('data-avatar-image', 'photo')
    expect(avatar.querySelector('img')).toHaveAttribute('alt', '')
    unmount()

    renderProfile(TBRANDT_ID)
    await screen.findByRole('heading', { name: 'Tom Brandt' })
    const fallback = within(screen.getByTestId('profile-identity')).getByTestId('post-avatar')
    expect(fallback).toHaveAttribute('data-avatar-image', 'fallback')
    expect(fallback.querySelector('img')).not.toBeInTheDocument()
  })

  it('shows a location row when the persona has one, and none when absent', async () => {
    const persona = personaById(FULCO_ID)
    if (!persona?.location) throw new Error('expected a seeded persona with a location')
    const { unmount } = renderProfile(FULCO_ID)
    await screen.findByRole('heading', { name: /FulCo|Fulton/i })
    expect(within(screen.getByTestId('profile-location')).getByText(persona.location))
      .toBeInTheDocument()
    unmount()

    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    expect(screen.queryByTestId('profile-location')).not.toBeInTheDocument()
  })

  it('renders the joined date as a scenario-time dateline in the exercise zone', async () => {
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    const persona = personaById(FW_ID)
    if (!persona) throw new Error('expected seeded persona fixture')
    const joined = screen.getByTestId('profile-joined')
    expect(joined).toHaveAttribute('datetime', persona.joinedAt)
    expect(joined.textContent).toBe(
      formatScenarioTime(persona.joinedAt, 'America/New_York', { format: 'dateline' }),
    )
  })
})

describe('Profile — Posts vs Posts & replies (DP-5 includeReplies)', () => {
  it('Posts lists the persona’s authored TOP-LEVEL posts only, newest first (no replies)', async () => {
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    expect(cardIds()).not.toContain(OWN_REPLY)
  })

  it('does not fetch the includeReplies feed until Posts & replies (or own Likes) is opened', async () => {
    const getSpy = vi.spyOn(api, 'get')
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))

    expect(repliesReads(getSpy)).toBe(0)
  })

  it('Posts & replies reads GET /feed?includeReplies=true and adds the persona’s replies', async () => {
    const getSpy = vi.spyOn(api, 'get')
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Posts & replies' }))

    // Newest first: own2 (15:05), her reply (14:55), own1 (14:50). Only HER posts.
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN_REPLY, OWN1]))
    expect(repliesReads(getSpy)).toBe(1)
    const replyCard = screen.getAllByTestId('post-card')
      .find(c => c.getAttribute('data-post-id') === OWN_REPLY)
    if (!replyCard) throw new Error('expected the reply card')
    // The reply carries its context, so it reads as a reply, not a stray post.
    expect(replyCard).toHaveTextContent(/replying to/i)
    expect(replyCard).toHaveTextContent('@Newsline7')
  })

  it('returns to Posts without the reply, and does not stack authors from other accounts', async () => {
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await user.click(screen.getByRole('tab', { name: 'Posts & replies' }))
    await waitFor(() => expect(cardIds()).toContain(OWN_REPLY))

    await user.click(screen.getByRole('tab', { name: 'Posts' }))

    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
  })

  it('shows a polite unavailable line (not a blank tab) if the replies read fails', async () => {
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation(((url: string, config?: AxiosRequestConfig) => {
      const params = config?.params as Record<string, unknown> | undefined
      return url === '/feed' && params?.includeReplies === true
        ? Promise.reject(new Error('boom'))
        : realGet(url, config)
    }) as typeof api.get)
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Posts & replies' }))

    expect(await screen.findByText('Posts aren’t available right now.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it('shows "No posts or replies yet." for a persona with none', async () => {
    postStore.resetForTests() // canonical six: Tom Brandt has authored nothing
    const user = userEvent.setup()
    renderProfile(TBRANDT_ID)
    await screen.findByRole('heading', { name: 'Tom Brandt' })

    await user.click(screen.getByRole('tab', { name: 'Posts & replies' }))

    expect(await screen.findByText('No posts or replies yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('feed-skeleton')).not.toBeInTheDocument()
  })
})

describe('Profile — Likes (own profile only, from viewer.liked)', () => {
  it('on the OWN profile lists the posts the viewer has liked (from viewer.liked), newest first', async () => {
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    // The two demo posts seeded as liked by the viewer; newest first (13:45, then 11:30).
    await waitFor(() => expect(cardIds()).toEqual([LIKED_VIDEO, LIKED_GRID]))
    // Each one really is shown as liked on its card.
    for (const card of screen.getAllByTestId('post-card')) {
      expect(within(card).getByRole('button', { name: /^like, .*, liked$/i }))
        .toHaveAttribute('aria-pressed', 'true')
    }
    expect(screen.queryByTestId('profile-likes-private')).not.toBeInTheDocument()
  })

  it('on someone ELSE’s profile says "Likes are private." and shows no entries, fetching nothing', async () => {
    const getSpy = vi.spyOn(api, 'get')
    const user = userEvent.setup()
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    const notice = await screen.findByTestId('profile-likes-private')
    expect(notice).toHaveTextContent('Likes are private.')
    expect(screen.getByRole('tabpanel')).toContainElement(notice)
    // Honest: no cards at all (not even the viewer's own likes), and no needless read.
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
    expect(repliesReads(getSpy)).toBe(0)
  })

  it('the private state is text plus an icon (never colour alone)', async () => {
    const user = userEvent.setup()
    renderProfile(FW_ID)
    await screen.findByRole('heading', { name: 'Fairhaven Water Utility' })
    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    const notice = await screen.findByTestId('profile-likes-private')
    expect(notice.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(notice.textContent).toBe('Likes are private.')
  })

  it('on the own profile with nothing liked, says so honestly (no fabricated entries)', async () => {
    postStore.resetForTests() // canonical six: no viewer.liked anywhere
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    expect(await screen.findByText('You haven’t liked any posts yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('post-card')).not.toBeInTheDocument()
  })

  it('keeps the tablist semantics: four tabs, Likes selected and its panel labelled by it', async () => {
    const user = userEvent.setup()
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })

    await user.click(screen.getByRole('tab', { name: 'Likes' }))

    expect(screen.getByRole('tab', { name: 'Likes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'profile-tab-likes')
  })
})

describe('Profile — forwards navigation to its cards', () => {
  it('opens the thread from the card body and from Reply (the Reply wiring of Gate-2 7/15)', async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    renderProfile(OWN_ID, { onOpenThread })
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    await user.click(within(first).getByTestId('post-open-target'))
    expect(onOpenThread).toHaveBeenLastCalledWith(OWN2)

    await user.click(within(first).getByRole('button', { name: /^reply, /i }))
    expect(onOpenThread).toHaveBeenCalledTimes(2)
    expect(onOpenThread).toHaveBeenLastCalledWith(OWN2)
  })

  it('Reply records the reply-focus intent (so the thread opens with the composer focused)', async () => {
    const user = userEvent.setup()
    const onOpenThread = vi.fn()
    renderProfile(OWN_ID, { onOpenThread })
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    // A plain card-body open is NOT a reply: it records nothing.
    await user.click(within(first).getByTestId('post-open-target'))
    expect(consumeReplyFocus(OWN2)).toBe(false)

    await user.click(within(first).getByRole('button', { name: /^reply, /i }))

    expect(onOpenThread).toHaveBeenLastCalledWith(OWN2)
    // One-shot, keyed by post id: ThreadView for THIS post consumes it exactly once.
    expect(consumeReplyFocus(OWN1)).toBe(false)
    expect(consumeReplyFocus(OWN2)).toBe(true)
    expect(consumeReplyFocus(OWN2)).toBe(false)
  })

  it('records the intent BEFORE navigating (ThreadView may read it as soon as it mounts)', async () => {
    const user = userEvent.setup()
    let recordedAtNavigation: boolean | undefined
    const onOpenThread = vi.fn((postId: string) => {
      recordedAtNavigation = consumeReplyFocus(postId)
    })
    renderProfile(OWN_ID, { onOpenThread })
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    await user.click(within(first).getByRole('button', { name: /^reply, /i }))

    expect(recordedAtNavigation).toBe(true)
  })

  it('without onOpenThread, cards are not openable and Reply is inert text (no focusable no-op)', async () => {
    renderProfile(OWN_ID)
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    expect(within(first).queryByTestId('post-open-target')).not.toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: /^reply, /i })).not.toBeInTheDocument()
  })

  it('forwards onHashtagOpen to the cards’ hashtags', async () => {
    const user = userEvent.setup()
    const onHashtagOpen = vi.fn()
    renderProfile(OWN_ID, { onHashtagOpen })
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await waitFor(() => expect(cardIds()).toEqual([OWN2, OWN1]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    await user.click(within(first).getByText('#WaterIssues'))

    expect(onHashtagOpen).toHaveBeenCalledWith('waterissues')
  })

  it('forwards onOpenProfile to the cards’ author identity (needed on the Likes tab)', async () => {
    const user = userEvent.setup()
    const onOpenProfile = vi.fn()
    renderProfile(OWN_ID, { onOpenProfile })
    await screen.findByRole('heading', { name: 'Dana Reyes' })
    await user.click(screen.getByRole('tab', { name: 'Likes' }))
    await waitFor(() => expect(cardIds()).toEqual([LIKED_VIDEO, LIKED_GRID]))
    const [first] = screen.getAllByTestId('post-card')
    if (!first) throw new Error('expected a card')

    await user.click(within(first).getByTestId('post-author-target'))

    expect(onOpenProfile).toHaveBeenCalledWith('persona-newsline7')
  })
})
