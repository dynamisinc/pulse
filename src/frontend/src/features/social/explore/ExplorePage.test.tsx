/**
 * features/social/explore/ExplorePage.test.tsx
 * ---------------------------------------------------------------------------
 * The Explore page (demo-polish F6, SOC-040/041/042): a labelled page with the
 * search box and the trending list, mountable with NO props (F1 mounts it at
 * `/explore` that way); activating a trend navigates to `/hashtag/:tag`; a search
 * swaps Trending for the results and clearing it brings Trending back.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { postStore } from '../services/postStore'
import { ExplorePage } from './ExplorePage'
import { renderExplore, seedPost } from './exploreTestUtils'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
  seedPost({ id: 'ex-1', text: 'Boil water advisory #WaterIssues', at: '2033-09-04T15:00:00Z' })
  seedPost({ id: 'ex-2', text: 'Taps are off on Elm #WaterIssues', at: '2033-09-04T14:00:00Z' })
  seedPost({ id: 'ex-3', text: 'Shelter open tonight #Shelter', at: '2033-09-04T15:30:00Z' })
})

afterEach(() => {
  postStore.resetForTests()
  resetExerciseClock()
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

  it('swaps Trending for the results while searching, and restores it when cleared', async () => {
    const user = userEvent.setup()
    renderExplore(<ExplorePage />)
    await screen.findAllByTestId('trending-row')

    await user.type(screen.getByRole('searchbox'), 'shelter')
    await screen.findByTestId('search-results')
    expect(screen.queryByTestId('trending-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('search-posts')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox'))
    expect(await screen.findByTestId('trending-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
  })

  it('opens a search result through the supplied callbacks', async () => {
    const onOpenPost = vi.fn()
    const user = userEvent.setup()
    renderExplore(<ExplorePage onOpenPost={onOpenPost} />)
    await screen.findByRole('searchbox')

    await user.type(screen.getByRole('searchbox'), 'elm')
    await user.click(await screen.findByRole('link', { name: /Taps are off on Elm/ }))
    expect(onOpenPost).toHaveBeenCalledWith('ex-2')
  })
})
