/**
 * features/social/explore/SearchBox.states.test.tsx
 * ---------------------------------------------------------------------------
 * The search box's non-happy and large-result states (demo-polish F6, NFR-001), with
 * `useExploreFeed` stubbed so each is deterministic:
 *  - loading shows "Searching…" and announces nothing;
 *  - when the feed read fails but the cast loads (or the reverse), THAT section says
 *    so in text and the other still works (L2);
 *  - past the 8-person / 50-post caps a single "Show all N" / "Show fewer" button
 *    reveals the rest and keeps focus (L3);
 *  - the unsearchable query shows nothing.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Persona } from '@/features/personas'
import type { PostView } from '../components/post/types'
import { renderExplore, resetExplore } from './exploreTestUtils'
import { SearchBox } from './SearchBox'
import type { UseExploreFeedResult } from './useExploreFeed'

function persona(index: number): Persona {
  const handle = `matchme${String(index).padStart(2, '0')}`
  return {
    id: `persona-${handle}`,
    exerciseId: 'ex-test',
    templateId: `tmpl-${handle}`,
    displayName: `Match Person ${index}`,
    handle,
    kind: 'human',
    verified: false,
    avatarColor: '#336',
    initials: 'MP',
    audienceBand: 'micro',
    followerCount: 10,
    joinedAt: '2033-01-01T00:00:00Z',
  }
}

const CAST = Array.from({ length: 12 }, (_, index) => persona(index + 1))

function viewOf(index: number): PostView {
  return {
    id: `bulk-${String(index).padStart(3, '0')}`,
    author: CAST[0] ?? persona(0),
    text: `bulkmatch post number ${index}`,
    counts: { reply: 0, repost: 0, like: index },
    scenarioTime: new Date(Date.UTC(2033, 8, 4, 10, 0, index)).toISOString(),
  }
}

const VIEWS = Array.from({ length: 60 }, (_, index) => viewOf(index + 1))

const feedState: { current: UseExploreFeedResult } = { current: ready() }

function ready(overrides: Partial<UseExploreFeedResult> = {}): UseExploreFeedResult {
  return {
    posts: [],
    views: VIEWS,
    personas: CAST,
    loading: false,
    failed: false,
    peopleLoading: false,
    peopleFailed: false,
    ...overrides,
  }
}

vi.mock('./useExploreFeed', () => ({
  useExploreFeed: () => feedState.current,
}))

beforeEach(() => {
  feedState.current = ready()
})

afterEach(() => {
  resetExplore()
})

async function search(query: string) {
  const user = userEvent.setup()
  renderExplore(<SearchBox />)
  await user.type(await screen.findByRole('searchbox'), query)
  return user
}

describe('SearchBox — loading and failure, per section', () => {
  it('says "Searching…" while the baseline loads, and announces nothing yet', async () => {
    feedState.current = ready({ loading: true, views: [], personas: [] })
    await search('anything')

    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('search-live')).toBeEmptyDOMElement()
  })

  it('waits for the cast too before showing posts (their authors come from it)', async () => {
    feedState.current = ready({ peopleLoading: true })
    await search('bulkmatch')

    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    expect(screen.queryByTestId('search-posts')).not.toBeInTheDocument()
  })

  it('shows "Posts aren’t available right now." in the Posts section while People still work', async () => {
    feedState.current = ready({ failed: true, views: [] })
    await search('match person 1')

    const people = await screen.findByTestId('search-people')
    expect(within(people).getAllByTestId('search-person').length).toBeGreaterThan(0)
    const posts = screen.getByTestId('search-posts')
    expect(posts).toHaveTextContent('Posts aren’t available right now.')
    // A failed section offers no sort toggle and no count; it is not "no results".
    expect(within(posts).queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument()
  })

  it('shows "People aren’t available right now." while Posts still work', async () => {
    feedState.current = ready({ peopleFailed: true, personas: [], views: VIEWS })
    await search('bulkmatch')

    expect(await screen.findByTestId('search-people')).toHaveTextContent(
      'People aren’t available right now.',
    )
    expect(within(screen.getByTestId('search-posts')).getAllByTestId('search-post')).toHaveLength(50)
  })

  it('says so once when both reads failed', async () => {
    feedState.current = ready({ failed: true, peopleFailed: true, views: [], personas: [] })
    await search('anything')

    expect(await screen.findByText('Search isn’t available right now.')).toBeInTheDocument()
    expect(screen.queryByTestId('search-posts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('search-people')).not.toBeInTheDocument()
    await waitFor(
      () =>
        expect(screen.getByTestId('search-live')).toHaveTextContent(
          'Search isn’t available right now.',
        ),
      { timeout: 3000 },
    )
  })

  it('announces the failed section along with the working one', async () => {
    feedState.current = ready({ failed: true, views: [] })
    await search('match person 1')

    await waitFor(
      () =>
        expect(screen.getByTestId('search-live')).toHaveTextContent(
          /people for “match person 1”\. Posts aren’t available right now\./,
        ),
      { timeout: 3000 },
    )
  })
})

describe('SearchBox — "Show all" past the caps', () => {
  it('caps people at 8 and posts at 50, each with a Show all button naming the total', async () => {
    await search('match')

    const people = await screen.findByTestId('search-people')
    expect(within(people).getAllByTestId('search-person')).toHaveLength(8)
    expect(within(people).getByRole('button', { name: 'Show all 12 people' })).toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'bulkmatch')
    const posts = await screen.findByTestId('search-posts')
    expect(within(posts).getAllByTestId('search-post')).toHaveLength(50)
    expect(within(posts).getByRole('button', { name: 'Show all 60 posts' })).toBeInTheDocument()
  })

  it('reveals everything, keeps focus on the same button, and folds back with Show fewer', async () => {
    const user = await search('bulkmatch')
    const posts = await screen.findByTestId('search-posts')

    const showAll = within(posts).getByRole('button', { name: 'Show all 60 posts' })
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    await user.click(showAll)

    expect(within(posts).getAllByTestId('search-post')).toHaveLength(60)
    const showFewer = within(posts).getByRole('button', { name: 'Show fewer' })
    expect(showFewer).toBe(showAll) // the same element: focus is not lost
    expect(showFewer).toHaveAttribute('aria-expanded', 'true')
    expect(showFewer).toHaveFocus()

    await user.click(showFewer)
    expect(within(posts).getAllByTestId('search-post')).toHaveLength(50)
  })

  it('offers no button when everything already fits', async () => {
    feedState.current = ready({ views: VIEWS.slice(0, 10) })
    await search('bulkmatch')

    await screen.findByTestId('search-posts')
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('folds back to the caps when the query changes', async () => {
    const user = await search('bulkmatch')
    const posts = await screen.findByTestId('search-posts')
    await user.click(within(posts).getByRole('button', { name: 'Show all 60 posts' }))
    expect(within(posts).getAllByTestId('search-post')).toHaveLength(60)

    await user.type(screen.getByRole('searchbox'), ' post')
    await waitFor(() =>
      expect(
        within(screen.getByTestId('search-posts')).getAllByTestId('search-post'),
      ).toHaveLength(50),
    )
  })
})
