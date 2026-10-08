/**
 * features/social/explore/ExplorePage.test.tsx
 * ---------------------------------------------------------------------------
 * The Explore page (demo-polish F6, SOC-040/041/042): a labelled page with the
 * search box and the trending list, mountable with NO props (F1 mounts it at
 * `/explore` that way); activating a trend navigates to `/hashtag/:tag`; a search
 * hides Trending behind the results (kept mounted, so clearing it brings Trending
 * straight back with no refetch or loading flash); one `view` event per mount.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setExerciseClock } from '@/core/clock'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { ExplorePage } from './ExplorePage'
import { renderExplore, resetExplore, seedPost } from './exploreTestUtils'

beforeEach(() => {
  resetTelemetryBuffer()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
  seedPost({ id: 'ex-1', text: 'Boil water advisory #WaterIssues', at: '2033-09-04T15:00:00Z' })
  seedPost({ id: 'ex-2', text: 'Taps are off on Elm #WaterIssues', at: '2033-09-04T14:00:00Z' })
  seedPost({ id: 'ex-3', text: 'Shelter open tonight #Shelter', at: '2033-09-04T15:30:00Z' })
})

afterEach(() => {
  resetExplore()
  resetTelemetryBuffer()
})

describe('ExplorePage', () => {
  it('mounts with no props as a landmark named by its h1', async () => {
    renderExplore(<ExplorePage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Explore' })).toBeInTheDocument()
    expect(screen.getByTestId('explore-page')).toBeInTheDocument()
  })

  it('shows the search box and the trending list', async () => {
    renderExplore(<ExplorePage />)

    expect(await screen.findByRole('search', { name: 'Search posts and people' })).toBeInTheDocument()
    const rows = await screen.findAllByTestId('trending-row')
    expect(rows.map(row => within(row).getByRole('link').getAttribute('data-tag'))).toEqual([
      'waterissues',
      'shelter',
    ])
  })

  it('lists up to 10 trends on the page (the rail lists fewer)', async () => {
    for (let index = 0; index < 12; index += 1) {
      seedPost({
        id: `ex-many-${index}`,
        text: `topic ${index} #Topic${index}x`,
        at: `2033-09-04T15:${String(10 + index).padStart(2, '0')}:00Z`,
      })
    }
    renderExplore(<ExplorePage />)

    expect(await screen.findAllByTestId('trending-row')).toHaveLength(10)
  })

  it('activating a trend navigates to the hashtag feed', async () => {
    const onOpenHashtag = vi.fn()
    renderExplore(<ExplorePage onOpenHashtag={onOpenHashtag} />)

    const link = await screen.findByRole('link', { name: /#WaterIssues/ })
    expect(link).toHaveAttribute('href', '/hashtag/waterissues')
    await userEvent.click(link)
    expect(onOpenHashtag).toHaveBeenCalledWith('waterissues')
  })

  it('navigates in-app to the hashtag feed by default (no callback supplied)', async () => {
    renderExplore(<ExplorePage />)

    await userEvent.click(await screen.findByRole('link', { name: /#WaterIssues/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/hashtag/waterissues')
  })

  it('hides Trending behind the results while searching and restores the SAME panel', async () => {
    const user = userEvent.setup()
    renderExplore(<ExplorePage />)
    await screen.findAllByTestId('trending-row')
    const panel = screen.getByTestId('trending-panel')

    await user.type(screen.getByRole('searchbox'), 'shelter')
    await screen.findByTestId('search-results')
    // Hidden, not unmounted: not visible and out of the accessibility tree...
    expect(screen.getByTestId('trending-panel')).toBe(panel)
    expect(panel).not.toBeVisible()
    expect(screen.queryByRole('region', { name: 'What’s happening' })).not.toBeInTheDocument()
    expect(screen.getByTestId('search-posts')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox'))
    // ...so clearing the box brings it straight back: same node, rows still there, no
    // "Loading trends…" flash in between.
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
    expect(screen.getByTestId('trending-panel')).toBe(panel)
    expect(panel).toBeVisible()
    expect(screen.getAllByTestId('trending-row').length).toBeGreaterThan(0)
    expect(screen.queryByText('Loading trends…')).not.toBeInTheDocument()
  })

  it('does not read the feed again when the search starts and ends', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(api, 'get')
    renderExplore(<ExplorePage />)
    await screen.findAllByTestId('trending-row')
    const readsAfterLoad = get.mock.calls.filter(([url]) => url === '/feed').length
    expect(readsAfterLoad).toBe(1)

    await user.type(screen.getByRole('searchbox'), 'shelter')
    await screen.findByTestId('search-results')
    await user.clear(screen.getByRole('searchbox'))

    expect(get.mock.calls.filter(([url]) => url === '/feed')).toHaveLength(1)
    get.mockRestore()
  })

  it('opens a search result through the supplied callbacks', async () => {
    const onOpenPost = vi.fn()
    const user = userEvent.setup()
    renderExplore(<ExplorePage onOpenPost={onOpenPost} />)
    await screen.findByRole('searchbox')

    await user.type(screen.getByRole('searchbox'), 'elm')
    await user.click(await screen.findByRole('link', { name: /Taps are off on Elm/ }))
    expect(onOpenPost).toHaveBeenCalledWith('ex-2', 'FairhavenWater')
  })

  it('emits exactly one `view` for the Explore page, not again for a search', async () => {
    const user = userEvent.setup()
    renderExplore(<ExplorePage />)
    await screen.findAllByTestId('trending-row')

    const views = () => getEmittedTelemetryEvents().filter(event => event.eventType === 'view')
    expect(views()).toHaveLength(1)
    expect(views()[0]).toMatchObject({
      channel: 'social',
      actor: { kind: 'participant', participantId: 'acct-dreyes' },
      target: { entityType: 'explore', entityId: 'explore' },
      exerciseId: 'ex-mock-0001',
    })
    expect(views()[0]?.scenarioTime).toBe('2033-09-04T16:00:00.000Z')

    await user.type(screen.getByRole('searchbox'), 'shelter')
    await screen.findByTestId('search-results')
    await user.clear(screen.getByRole('searchbox'))
    expect(views()).toHaveLength(1)
  })

  it('shows trends that arrive after the page is open', async () => {
    renderExplore(<ExplorePage />)
    await screen.findAllByTestId('trending-row')

    for (let index = 0; index < 5; index += 1) {
      seedPost({
        id: `ex-surge-${index}`,
        text: `Power is out on my street ${index} #PowerOutage`,
        at: `2033-09-04T15:5${index}:00Z`,
      })
    }

    expect(await screen.findByText('#PowerOutage', {}, { timeout: 2000 })).toBeInTheDocument()
  })
})
