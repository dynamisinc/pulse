/**
 * features/social/explore/TrendingPanel.states.test.tsx
 * ---------------------------------------------------------------------------
 * The Trending panel's non-happy states (demo-polish F6, NFR-001): loading, error
 * and empty are each plain TEXT (never colour alone), and loading never flashes
 * "nothing is trending". `useFeed` is stubbed so each state is deterministic.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderExplore, resetExplore } from './exploreTestUtils'
import type { UseExploreBaselineResult } from './useExploreFeed'
import { TrendingPanel } from './TrendingPanel'

const baseline: { current: UseExploreBaselineResult } = {
  current: { posts: [], loading: false, failed: false },
}

vi.mock('./useExploreFeed', () => ({
  useExploreBaseline: () => baseline.current,
}))

beforeEach(() => {
  baseline.current = { posts: [], loading: false, failed: false }
})

afterEach(() => {
  resetExplore()
})

describe('TrendingPanel — states', () => {
  it('says "Loading trends…" (a polite status) while loading, not "nothing trending"', async () => {
    baseline.current = { posts: [], loading: true, failed: false }
    renderExplore(<TrendingPanel />)

    expect(await screen.findByRole('status')).toHaveTextContent('Loading trends…')
    expect(screen.queryByText('Nothing is trending yet.')).not.toBeInTheDocument()
  })

  it('says so in text when the baseline read failed', async () => {
    baseline.current = { posts: [], loading: false, failed: true }
    renderExplore(<TrendingPanel />)

    expect(await screen.findByRole('status')).toHaveTextContent('Trends aren’t available right now.')
    expect(screen.queryByText('Nothing is trending yet.')).not.toBeInTheDocument()
  })

  it('says "Nothing is trending yet." for an empty feed', async () => {
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('Nothing is trending yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('never lists a taken-down post\'s tag, even if one reaches the panel', async () => {
    baseline.current = {
      posts: [
        {
          id: 'gone',
          status: 'taken-down',
          text: 'removed #Ghost',
          scenarioTime: '2033-09-04T15:00:00Z',
        },
      ] as unknown as UseExploreBaselineResult['posts'],
      loading: false,
      failed: false,
    }
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('Nothing is trending yet.')).toBeInTheDocument()
    expect(screen.queryByText('#Ghost')).not.toBeInTheDocument()
  })

  it('keeps the trends it has while a refresh is failing', async () => {
    baseline.current = {
      posts: [
        {
          id: 'p1',
          authorPersonaId: 'persona-a',
          text: 'still here #Stays',
          counts: { reply: 0, repost: 0, like: 0 },
          scenarioTime: '2033-09-04T15:00:00Z',
        },
      ],
      loading: false,
      failed: true,
    }
    renderExplore(<TrendingPanel />)

    expect(await screen.findByText('#Stays')).toBeInTheDocument()
    expect(screen.queryByText('Trends aren’t available right now.')).not.toBeInTheDocument()
  })
})
