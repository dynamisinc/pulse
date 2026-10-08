/**
 * features/social/explore/TrendingPanel.states.test.tsx
 * ---------------------------------------------------------------------------
 * The Trending panel's non-happy states (demo-polish F6, NFR-001): loading, error
 * and empty are each plain TEXT (never colour alone), and loading never flashes
 * "nothing is trending". `useFeed` is stubbed so each state is deterministic.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseFeedResult } from '../hooks/useFeed'
import { TrendingPanel } from './TrendingPanel'

const feedState: { current: UseFeedResult } = {
  current: { posts: [], loading: false, error: undefined },
}

vi.mock('../hooks/useFeed', () => ({
  useFeed: () => feedState.current,
}))

beforeEach(() => {
  feedState.current = { posts: [], loading: false, error: undefined }
})

describe('TrendingPanel — states', () => {
  it('says "Loading trends…" (a polite status) while loading, not "nothing trending"', () => {
    feedState.current = { posts: [], loading: true, error: undefined }
    render(<TrendingPanel />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading trends…')
    expect(screen.queryByText('Nothing is trending yet.')).not.toBeInTheDocument()
  })

  it('says so in text when trends are unavailable', () => {
    feedState.current = { posts: [], loading: false, error: new Error('boom') }
    render(<TrendingPanel />)

    expect(screen.getByRole('status')).toHaveTextContent('Trends aren’t available right now.')
    expect(screen.queryByText('Nothing is trending yet.')).not.toBeInTheDocument()
  })

  it('says "Nothing is trending yet." for an empty feed', () => {
    render(<TrendingPanel />)

    expect(screen.getByText('Nothing is trending yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('never lists a taken-down post\'s tag, even if one reaches the panel', () => {
    feedState.current = {
      posts: [
        {
          id: 'gone',
          status: 'taken-down',
          text: 'removed #Ghost',
          scenarioTime: '2033-09-04T15:00:00Z',
        },
      ] as unknown as UseFeedResult['posts'],
      loading: false,
      error: undefined,
    }
    render(<TrendingPanel />)

    expect(screen.queryByText('#Ghost')).not.toBeInTheDocument()
  })
})
