/**
 * features/social/explore/TrendingPanel.test.tsx
 * ---------------------------------------------------------------------------
 * The Trending panel over the real feed read (demo-polish F6, SOC-041 client-side,
 * D1-R5, COR-053, NFR-001): organic ranking from the loaded posts, the 5-row
 * default and the `limit` prop, the post-count line, the varied category label,
 * scenario-time windowing (the exercise clock, not the wall-clock), links that
 * navigate to `/hashtag/:tag`, and keyboard operation.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { postStore } from '../services/postStore'
import { nth, renderExplore, seedPost } from './exploreTestUtils'
import { TrendingPanel } from './TrendingPanel'

/** Scenario "now" for these tests (2033 — nothing like the real wall-clock). */
const NOW = '2033-09-04T16:00:00.000Z'

function useScenarioNow(iso: string = NOW) {
  setExerciseClock({ scenarioNow: () => new Date(iso) })
}

afterEach(() => {
  postStore.resetForTests()
  resetExerciseClock()
})

function seedOrganicFeed() {
  // #WaterIssues: 3 recent posts. #Shelter: 2 (one older). #RoadClosure: 1 very fresh.
  seedPost({ id: 't-w1', text: 'Boil water advisory #WaterIssues', at: '2033-09-04T15:00:00Z' })
  seedPost({ id: 't-w2', text: 'Taps are off on Elm #waterissues', at: '2033-09-04T14:00:00Z' })
  seedPost({ id: 't-w3', text: 'Bottled water at the depot #WaterIssues', at: '2033-09-04T13:00:00Z' })
  seedPost({ id: 't-s1', text: 'Shelter open at the high school #Shelter', at: '2033-09-04T15:30:00Z' })
  seedPost({ id: 't-s2', text: 'Cots needed #Shelter', at: '2033-09-04T10:00:00Z' })
  seedPost({ id: 't-r1', text: 'Main St closed #RoadClosure', at: '2033-09-04T15:55:00Z' })
}

describe('TrendingPanel — organic trends over the loaded feed', () => {
  it('lists the tags ranked by recency-weighted activity, with a post-count line', async () => {
    useScenarioNow()
    seedOrganicFeed()
    renderExplore(<TrendingPanel />)

    const rows = await screen.findAllByTestId('trending-row')
    expect(rows.map(row => within(row).getByRole('link').getAttribute('data-tag'))).toEqual([
      'waterissues',
      'shelter',
      'roadclosure',
    ])
    expect(within(nth(rows, 0)).getByText('#WaterIssues')).toBeInTheDocument()
    expect(within(nth(rows, 0)).getByText('3 posts')).toBeInTheDocument()
    expect(within(nth(rows, 1)).getByText('2 posts')).toBeInTheDocument()
    expect(within(nth(rows, 2)).getByText('1 post')).toBeInTheDocument()
  })

  it('shows a varied category label on each row, never an authority label', async () => {
    useScenarioNow()
    seedOrganicFeed()
    renderExplore(<TrendingPanel />)

    const rows = await screen.findAllByTestId('trending-row')
    expect(within(nth(rows, 0)).getByText('Public safety · Trending')).toBeInTheDocument()
    expect(within(nth(rows, 1)).getByText('Public safety · Trending')).toBeInTheDocument()
    expect(within(nth(rows, 2)).getByText('Traffic · Trending')).toBeInTheDocument()
    expect(screen.getByTestId('trending-panel')).not.toHaveTextContent(
      /official|promoted|sponsored|recommended|verified/i,
    )
  })

  it('is a labelled section with an ordered list', async () => {
    useScenarioNow()
    seedOrganicFeed()
    renderExplore(<TrendingPanel />)

    await screen.findAllByTestId('trending-row')
    const panel = screen.getByRole('region', { name: 'What’s happening' })
    expect(within(panel).getByRole('list')).toBeInstanceOf(HTMLOListElement)
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
  })

  it('lists at most 5 trends by default, and up to `limit`', async () => {
    useScenarioNow()
    for (let index = 0; index < 8; index += 1) {
      seedPost({
        id: `t-many-${index}`,
        text: `topic number ${index} #Topic${index}x`,
        at: `2033-09-04T15:${String(10 + index).padStart(2, '0')}:00Z`,
      })
    }
    const first = renderExplore(<TrendingPanel />)
    expect(await screen.findAllByTestId('trending-row')).toHaveLength(5)
    first.unmount()

    renderExplore(<TrendingPanel limit={10} />)
    expect(await screen.findAllByTestId('trending-row')).toHaveLength(8)
  })

  it('renders nothing declared: no tag appears unless posts carry it', async () => {
    useScenarioNow()
    seedPost({ id: 't-plain', text: 'No hashtags in this one at all', at: '2033-09-04T15:00:00Z' })
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('Nothing is trending yet.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('trending-row')).toHaveLength(0)
  })
})

describe('TrendingPanel — scenario time, never the wall-clock (COR-053)', () => {
  it('windows from the exercise clock: posts older than the window do not trend', async () => {
    // "Now" is a day after the posts. Under the real wall-clock (2026) these 2033
    // posts would look like the FUTURE and count as brand new; under the scenario
    // clock they are 30h old and fall outside the 12h window.
    useScenarioNow('2033-09-05T16:00:00.000Z')
    seedPost({ id: 't-old', text: 'Yesterday #Yesterday', at: '2033-09-04T10:00:00Z' })
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('Nothing is trending yet.')).toBeInTheDocument()
    expect(screen.queryByText('#Yesterday')).not.toBeInTheDocument()
  })

  it('counts a post that is inside the scenario window', async () => {
    useScenarioNow('2033-09-04T20:00:00.000Z')
    seedPost({ id: 't-in', text: 'Earlier today #Today', at: '2033-09-04T10:00:00Z' })
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('#Today')).toBeInTheDocument()
  })
})

describe('TrendingPanel — activating a trend opens the hashtag feed', () => {
  it('links each trend to /hashtag/:tag by default', async () => {
    useScenarioNow()
    seedOrganicFeed()
    renderExplore(<TrendingPanel />)

    const link = await screen.findByRole('link', { name: /#WaterIssues/ })
    expect(link).toHaveAttribute('href', '/hashtag/waterissues')
  })

  it('hands the normalized tag to onOpenHashtag on click', async () => {
    useScenarioNow()
    seedOrganicFeed()
    const onOpenHashtag = vi.fn()
    renderExplore(<TrendingPanel onOpenHashtag={onOpenHashtag} />)

    await userEvent.click(await screen.findByRole('link', { name: /#WaterIssues/ }))
    expect(onOpenHashtag).toHaveBeenCalledTimes(1)
    expect(onOpenHashtag).toHaveBeenCalledWith('waterissues')
  })

  it('is keyboard operable: Tab reaches a trend and Enter opens it', async () => {
    useScenarioNow()
    seedOrganicFeed()
    const onOpenHashtag = vi.fn()
    renderExplore(<TrendingPanel onOpenHashtag={onOpenHashtag} />)
    await screen.findAllByTestId('trending-row')

    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('link', { name: /#WaterIssues/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: /#Shelter/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpenHashtag).toHaveBeenCalledWith('shelter')
  })
})
