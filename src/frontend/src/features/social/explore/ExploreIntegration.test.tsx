/**
 * features/social/explore/ExploreIntegration.test.tsx
 * ---------------------------------------------------------------------------
 * Explore inside the real Social channel (demo-polish F6 fold: M1/M3, rail mount,
 * navigation swap, hashtag deep link). Everything here goes through
 * `renderChannel` — the same stack `App.tsx` builds — so it proves the pieces are
 * wired together, not just that each works alone:
 *  - the persistent right rail's Trending moves when posts arrive AFTER sign-in;
 *  - the rail and the Explore page share ONE feed read, and navigating between them
 *    adds none;
 *  - the rail's search and trends give way to the page's own on `/explore`;
 *  - a rail search opens results in-app through the channel's adapter;
 *  - `/hashtag/WaterIssues` (a deep link in the authors' casing) reads right and its
 *    cards' Reply opens the thread.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { RouterProbe } from '../layout/RouterProbe.testUtils'
import { renderChannel } from '../layout/renderChannel.testUtils'
import { resetReplyIntent } from '../services/replyIntent'
import { EXPLORE_ARRIVAL_BATCH_MS } from './exploreFeedStore'
import { resetExplore, seedPost } from './exploreTestUtils'

afterEach(() => {
  vi.restoreAllMocks()
  resetExplore()
  resetReplyIntent()
})

const feedReads = (spy: { mock: { calls: unknown[][] } }): number =>
  spy.mock.calls.filter(([url]) => url === '/feed').length

function seedQuietFeed() {
  // Channel clock: 2033-09-04T14:30Z. #Alpha leads, #Beta trails.
  seedPost({ id: 'ei-a1', text: 'First alpha note #Alpha', at: '2033-09-04T14:10:00Z' })
  seedPost({ id: 'ei-a2', text: 'Second alpha note #Alpha', at: '2033-09-04T14:12:00Z' })
  seedPost({ id: 'ei-b1', text: 'One beta note #Beta', at: '2033-09-04T13:40:00Z' })
}

function railTrendingTags(): Array<string | null> {
  const rail = screen.getByRole('complementary', { name: 'Sidebar' })
  return within(rail)
    .getAllByTestId('trending-row')
    .map(row => within(row).getByRole('link').getAttribute('data-tag'))
}

describe('the right rail\'s Trending is live (M1)', () => {
  it('moves a tag up when its posts arrive after sign-in, without a remount', async () => {
    seedQuietFeed()
    renderChannel()
    await waitFor(() => expect(railTrendingTags()).toEqual(['alpha', 'beta']))
    const panel = screen.getByTestId('trending-panel')

    // The demo's surge: #WaterIssues posts landing minutes after the participant signed in.
    for (let index = 0; index < 5; index += 1) {
      seedPost({
        id: `ei-w${index}`,
        text: `Boil water advisory report ${index} #WaterIssues`,
        at: `2033-09-04T14:2${index}:00Z`,
        handle: index % 2 === 0 ? 'FairhavenWater' : 'mvega_fh',
      })
    }

    await waitFor(() => expect(railTrendingTags()[0]).toBe('waterissues'), {
      timeout: EXPLORE_ARRIVAL_BATCH_MS * 10,
    })
    expect(railTrendingTags()).toEqual(['waterissues', 'alpha', 'beta'])
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })
    expect(within(rail).getByText('#WaterIssues')).toBeInTheDocument()
    expect(within(rail).getByText('5 posts')).toBeInTheDocument()
    expect(screen.getByTestId('trending-panel')).toBe(panel) // updated in place
  })

  it('also reflects a post the participant sees arrive in the feed pill', async () => {
    seedQuietFeed()
    renderChannel()
    await waitFor(() => expect(railTrendingTags()).toEqual(['alpha', 'beta']))

    for (let index = 0; index < 3; index += 1) {
      seedPost({ id: `ei-b-more-${index}`, text: `More beta ${index} #Beta`, at: '2033-09-04T14:25:00Z' })
    }

    await waitFor(() => expect(railTrendingTags()[0]).toBe('beta'), {
      timeout: EXPLORE_ARRIVAL_BATCH_MS * 10,
    })
  })
})

describe('one feed read, shared between the rail and the page (M3)', () => {
  it('reads the feed once for the page\'s search + trending (the rail steps aside)', async () => {
    seedQuietFeed()
    const get = vi.spyOn(api, 'get')
    renderChannel({ entries: ['/explore'] })

    await screen.findAllByTestId('trending-row')
    expect(feedReads(get)).toBe(1)
  })

  it('adds no read when moving from Home to Explore and back', async () => {
    seedQuietFeed()
    const get = vi.spyOn(api, 'get')
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'] })
    await waitFor(() => expect(railTrendingTags()).toEqual(['alpha', 'beta']))
    // Home's own frozen feed read + the shared Explore baseline.
    const atHome = feedReads(get)
    expect(atHome).toBe(2)

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    // The page mounted its own search + trends in the same commit the rail's left.
    await screen.findAllByTestId('trending-row')
    expect(screen.queryByText('Loading trends…')).not.toBeInTheDocument()
    expect(feedReads(get)).toBe(atHome)

    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(railTrendingTags()).toEqual(['alpha', 'beta']))
    expect(feedReads(get)).toBe(atHome)
  })

  it('shows one search landmark and one trends region on /explore, and two nowhere else', async () => {
    seedQuietFeed()
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'] })
    await waitFor(() => expect(railTrendingTags()).toEqual(['alpha', 'beta']))
    expect(screen.getAllByRole('search')).toHaveLength(1) // the rail's
    expect(screen.getAllByRole('region', { name: 'What’s happening' })).toHaveLength(1)

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(screen.getAllByRole('search')).toHaveLength(1) // the page's
    expect(screen.getAllByRole('region', { name: 'What’s happening' })).toHaveLength(1)
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })
    expect(within(rail).queryByRole('search')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('explore-page')).getByRole('search')).toBeInTheDocument()
  })
})

describe('the rail\'s search opens results in-app', () => {
  it('finds people and posts, and a People row opens the profile with no reload', async () => {
    seedQuietFeed()
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'], beside: <RouterProbe /> })
    const rail = await screen.findByRole('complementary', { name: 'Sidebar' })

    await user.type(within(rail).getByRole('searchbox'), 'fairhaven water')
    const people = await within(rail).findByTestId('search-people')
    const rows = within(people).getAllByTestId('search-person')
    expect(rows.map(row => within(row).getByRole('link').getAttribute('href'))).toEqual([
      '/FairhavenWater',
      '/FairhavenWaterUpd',
    ])
    // The seal is the only difference, here as everywhere.
    expect(within(rows[0] as HTMLElement).getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).queryByRole('img')).not.toBeInTheDocument()

    await user.click(within(rows[1] as HTMLElement).getByRole('link'))
    await waitFor(() => expect(screen.getByTestId('router-location')).toHaveTextContent('/FairhavenWaterUpd'))
    expect(await screen.findByTestId('social-profile-region')).toBeInTheDocument()
  })

  it('opens a post result as a thread', async () => {
    seedQuietFeed()
    const user = userEvent.setup()
    renderChannel({ entries: ['/home'], beside: <RouterProbe /> })
    const rail = await screen.findByRole('complementary', { name: 'Sidebar' })

    await user.type(within(rail).getByRole('searchbox'), 'beta note')
    await user.click(await within(rail).findByRole('link', { name: /One beta note/ }))

    await waitFor(() =>
      expect(screen.getByTestId('router-location')).toHaveTextContent(
        '/FairhavenWater/status/ei-b1',
      ),
    )
  })
})

describe('the hashtag page, by deep link (M6)', () => {
  function seedWater() {
    seedPost({ id: 'hd-1', text: 'First #waterissues', at: '2033-09-04T14:00:00Z' })
    seedPost({ id: 'hd-2', text: 'Second #WaterIssues', at: '2033-09-04T14:05:00Z' })
    seedPost({ id: 'hd-3', text: 'Third #WaterIssues', at: '2033-09-04T14:10:00Z' })
  }

  it('/hashtag/WaterIssues reads "#WaterIssues" with its count', async () => {
    seedWater()
    renderChannel({ entries: ['/hashtag/WaterIssues'] })

    const region = await screen.findByTestId('social-hashtag-region')
    expect(await within(region).findByRole('heading', { level: 1, name: '#WaterIssues' })).toBeInTheDocument()
    await waitFor(() =>
      expect(within(region).getByTestId('hashtag-post-count')).toHaveTextContent('3 posts'),
    )
  })

  it('cards on the hashtag page can Reply: F1\'s route gives them a thread opener', async () => {
    seedWater()
    const user = userEvent.setup()
    renderChannel({ entries: ['/hashtag/waterissues'], beside: <RouterProbe /> })

    const region = await screen.findByTestId('social-hashtag-region')
    const cards = await within(region).findAllByTestId('post-card')
    const target = cards.find(card => card.getAttribute('data-post-id') === 'hd-3')
    expect(target).toBeDefined()
    // Not inert: Reply is a real button because F1's route passes `onOpenThread`.
    await user.click(within(target as HTMLElement).getByRole('button', { name: /Reply/ }))

    // (That Reply also records the reply-focus intent is pinned in
    // `HashtagFeed.polish.test.tsx`; the mock thread read does not know a seeded post,
    // so the composer-focus end of it is not observable from here.)
    await waitFor(() =>
      expect(screen.getByTestId('router-location')).toHaveTextContent(/\/status\/hd-3$/),
    )
  })

  it('opens an author\'s profile from a card on the hashtag page', async () => {
    seedWater()
    const user = userEvent.setup()
    renderChannel({ entries: ['/hashtag/waterissues'], beside: <RouterProbe /> })

    const region = await screen.findByTestId('social-hashtag-region')
    const [first] = await within(region).findAllByTestId('post-author-target')
    expect(first).toBeDefined()
    await user.click(first as HTMLElement)

    await waitFor(() =>
      expect(screen.getByTestId('router-location')).toHaveTextContent('/FairhavenWater'),
    )
  })
})
