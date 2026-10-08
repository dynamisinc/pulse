/**
 * features/social/explore/SearchBox.test.tsx
 * ---------------------------------------------------------------------------
 * The search box + results over the real feed and persona reads (demo-polish F6,
 * SOC-042, SOC-052 / D1-008, COR-053, NFR-001):
 *  - a `role="search"` landmark named by a VISIBLE label;
 *  - posts match on text and hashtag; People match name/handle; the Recent / Top
 *    toggle reorders POSTS;
 *  - the lookalike pair appears side by side, the seal being the only difference;
 *  - result counts reach a polite live region (debounced), and "no results" is TEXT;
 *  - keyboard: arrow navigation between results, Enter/Down from the box, Escape;
 *  - times render in scenario time; rows navigate via callbacks or real links.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  nth,
  renderExplore,
  resetExplore,
  seedPost,
  structureSignature,
} from './exploreTestUtils'
import { SearchBox } from './SearchBox'

beforeEach(() => {
  resetTelemetryBuffer()
  // Scenario "now": 2033-09-04 14:00Z (nothing like the real wall-clock).
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00.000Z') })
  seedPost({
    id: 'sb-1',
    text: 'Tanker zephyr deliveries at 3pm #ZephyrWater',
    at: '2033-09-04T10:00:00Z',
    handle: 'FairhavenWater',
    counts: { like: 20 },
  })
  seedPost({
    id: 'sb-2',
    text: 'More zephyr deliveries tomorrow morning',
    at: '2033-09-04T12:00:00Z',
    handle: 'mvega_fh',
    counts: { like: 5 },
  })
  seedPost({
    id: 'sb-3',
    text: 'zephyr pharmacy is open on Main Street',
    at: '2033-09-04T11:00:00Z',
    handle: 'kwardFH',
    counts: { like: 50 },
  })
  seedPost({ id: 'sb-4', text: 'Something else entirely', at: '2033-09-04T13:00:00Z' })
})

afterEach(() => {
  resetExplore()
  resetTelemetryBuffer()
})

async function renderBox(props: Parameters<typeof SearchBox>[0] = {}) {
  const user = userEvent.setup()
  renderExplore(<SearchBox {...props} />)
  const input = await screen.findByRole('searchbox', { name: 'Search posts and people' })
  return { user, input }
}

function postIds(): string[] {
  return screen.getAllByTestId('search-post').map(row => row.getAttribute('data-post-id') ?? '')
}

describe('SearchBox — landmark and label (NFR-001)', () => {
  it('is a search landmark named by its visible label', async () => {
    await renderBox()

    const landmark = screen.getByRole('search', { name: 'Search posts and people' })
    expect(landmark).toBeInTheDocument()
    // The label is real, visible text associated with the input (not just aria-label).
    const label = screen.getByText('Search posts and people')
    expect(label.tagName).toBe('LABEL')
    expect(label).toBeVisible()
    expect(screen.getByRole('searchbox')).toHaveAccessibleName('Search posts and people')
  })

  it('shows no results area until there is something to search for', async () => {
    const { user, input } = await renderBox()
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()

    await user.type(input, '  ')
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '#')
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
  })
})

describe('SearchBox — posts (text and hashtag)', () => {
  it('filters the loaded posts by text, Recent first, with a result count', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')

    await screen.findByTestId('search-posts')
    expect(postIds()).toEqual(['sb-2', 'sb-3', 'sb-1'])
    const section = screen.getByRole('region', { name: /Posts/ })
    expect(within(section).getByText('3 results')).toBeInTheDocument()
  })

  it('matches a hashtag query on the tag', async () => {
    const { user, input } = await renderBox()
    await user.type(input, '#zephyr')

    await screen.findByTestId('search-posts')
    expect(postIds()).toEqual(['sb-1'])
    // A hashtag search is not a people search.
    expect(screen.queryByTestId('search-people')).not.toBeInTheDocument()
  })

  it('narrows as more terms are typed (all terms must match)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr pharmacy')

    await waitFor(() => expect(postIds()).toEqual(['sb-3']))
  })

  it('renders each time as scenario-relative text from the exercise clock', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')

    await screen.findByTestId('search-posts')
    const rows = screen.getAllByTestId('search-post')
    // now = 14:00Z; sb-2 12:00Z, sb-3 11:00Z, sb-1 10:00Z
    expect(within(nth(rows, 0)).getByText('2h ago')).toHaveAttribute(
      'dateTime',
      '2033-09-04T12:00:00Z',
    )
    expect(within(nth(rows, 1)).getByText('3h ago')).toBeInTheDocument()
    expect(within(nth(rows, 2)).getByText('4h ago')).toBeInTheDocument()
  })
})

describe('SearchBox — Recent / Top toggle', () => {
  it('defaults to Recent and offers Recent and Top as a radio group', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')

    const group = screen.getByRole('group', { name: 'Sort posts by' })
    expect(within(group).getAllByRole('radio').map(r => r.getAttribute('value'))).toEqual([
      'recent',
      'top',
    ])
    expect(screen.getByRole('radio', { name: 'Recent' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Top' })).not.toBeChecked()
  })

  it('Top orders posts by engagement; Recent by scenario time', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')
    expect(postIds()).toEqual(['sb-2', 'sb-3', 'sb-1']) // 12:00, 11:00, 10:00

    await user.click(screen.getByRole('radio', { name: 'Top' }))
    await waitFor(() => expect(postIds()).toEqual(['sb-3', 'sb-1', 'sb-2'])) // 50, 20, 5
    expect(screen.getByRole('radio', { name: 'Top' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Recent' }))
    await waitFor(() => expect(postIds()).toEqual(['sb-2', 'sb-3', 'sb-1']))
  })

  it('marks the selected option with more than colour (a check icon)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')

    const recentLabel = screen.getByRole('radio', { name: 'Recent' }).closest('label')
    const topLabel = screen.getByRole('radio', { name: 'Top' }).closest('label')
    expect(recentLabel?.querySelector('svg')).not.toBeNull()
    expect(topLabel?.querySelector('svg')).toBeNull()
  })

  it('does not reorder People (the toggle is for posts)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'fairhaven')
    await screen.findByTestId('search-people')
    const before = screen.getAllByTestId('search-person').map(row => row.textContent)

    await user.click(await screen.findByRole('radio', { name: 'Top' }))
    expect(screen.getAllByTestId('search-person').map(row => row.textContent)).toEqual(before)
  })
})

describe('SearchBox — People: the lookalike pair (SOC-052 / D1-008)', () => {
  it('shows the verified agency and its unverified lookalike side by side', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'fairhaven water')

    const people = await screen.findByTestId('search-people')
    const rows = within(people).getAllByTestId('search-person')
    expect(rows).toHaveLength(2)
    const [real, fake] = [nth(rows, 0), nth(rows, 1)]
    expect(within(real).getByText('Fairhaven Water Utility')).toBeInTheDocument()
    expect(within(fake).getByText('Fairhaven Water Update')).toBeInTheDocument()

    // The seal is the ONLY difference.
    expect(within(real).getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
    expect(within(fake).queryByRole('img')).not.toBeInTheDocument()
    const sealWrapper = real.querySelector('[data-testid="verified-mark"]')?.parentElement
    expect(structureSignature(real, sealWrapper ?? undefined)).toBe(structureSignature(fake))
  })

  it('adds no label or warning to the lookalike anywhere in the People section', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'fairhaven water')

    const people = await screen.findByTestId('search-people')
    // (An account's OWN bio may say "Official ..." — that is persona-authored, D1-R1 —
    // so this checks for platform-added flags, not that word.)
    expect(people).not.toHaveTextContent(/unverified|not verified|fake|imperson|warning|caution/i)
    expect(within(people).queryAllByRole('img')).toHaveLength(1) // the one real seal
  })

  it('finds accounts by handle, with or without @', async () => {
    const { user, input } = await renderBox()
    await user.type(input, '@mvega')

    const people = await screen.findByTestId('search-people')
    expect(within(people).getByText('@mvega_fh')).toBeInTheDocument()
  })

  it('labels the People section and links each account to its profile', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'vega')

    const people = await screen.findByRole('region', { name: /People/ })
    const link = within(people).getByRole('link', { name: /View .*profile/ })
    expect(link).toHaveAttribute('href', '/mvega_fh')
  })
})

describe('SearchBox — result counts are announced politely (NFR-001)', () => {
  it('has an always-mounted polite, atomic status region', async () => {
    await renderBox()
    const live = screen.getByTestId('search-live')
    expect(live).toHaveAttribute('role', 'status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveAttribute('aria-atomic', 'true')
    expect(live).toBeEmptyDOMElement()
  })

  it('announces a query-aware summary once the reader pauses', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')

    await screen.findByTestId('search-posts')
    await waitFor(
      () =>
        expect(screen.getByTestId('search-live')).toHaveTextContent(
          '3 posts and 0 people for “zephyr”.',
        ),
      { timeout: 3000 },
    )
  })

  it('names the people too, and singularises one', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'tanker')

    await waitFor(
      () =>
        expect(screen.getByTestId('search-live')).toHaveTextContent(
          '1 post and 0 people for “tanker”.',
        ),
      { timeout: 3000 },
    )
  })

  it('announces "no results" and also shows it as text with an icon (not colour)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'qqqzzz')

    const empty = await screen.findByTestId('search-empty')
    expect(empty).toHaveTextContent('No results for “qqqzzz”.')
    expect(empty.querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('search-posts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('search-people')).not.toBeInTheDocument()
    await waitFor(
      () => expect(screen.getByTestId('search-live')).toHaveTextContent('No results for “qqqzzz”.'),
      { timeout: 3000 },
    )
  })

  it('clears the announcement when the search is cleared', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await waitFor(
      () => expect(screen.getByTestId('search-live')).toHaveTextContent('3 posts'),
      { timeout: 3000 },
    )

    await user.clear(input)
    await waitFor(() => expect(screen.getByTestId('search-live')).toBeEmptyDOMElement(), {
      timeout: 3000,
    })
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
  })
})

describe('SearchBox — one search event per settled query (XC-004)', () => {
  const searches = () => getEmittedTelemetryEvents().filter(event => event.eventType === 'search')

  it('records the settled query with its result counts, once', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')

    await waitFor(() => expect(searches()).toHaveLength(1), { timeout: 3000 })
    const [event] = searches()
    expect(event).toMatchObject({
      eventType: 'search',
      channel: 'social',
      actor: { kind: 'participant', participantId: 'acct-dreyes' },
      exerciseId: 'ex-mock-0001',
      payload: { query: 'zephyr', postCount: 3, peopleCount: 0 },
    })
    // Scenario time rides the envelope; nothing identifies a persona or a post.
    expect(event?.scenarioTime).toBe('2033-09-04T14:00:00.000Z')
    expect(JSON.stringify(event?.payload)).not.toMatch(/persona|sb-\d/)
    expect(event?.target).toBeUndefined()
  })

  it('does not record the keystrokes on the way (only the settled query)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await waitFor(() => expect(searches()).toHaveLength(1), { timeout: 3000 })

    const queries = searches().map(event => event.payload?.query)
    expect(queries).toEqual(['zephyr'])
  })

  it('records a new event for a changed query, and for a re-typed one after clearing', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await waitFor(() => expect(searches()).toHaveLength(1), { timeout: 3000 })

    await user.type(input, ' pharmacy')
    await waitFor(() => expect(searches()).toHaveLength(2), { timeout: 3000 })
    expect(searches().map(e => e.payload?.query)).toEqual(['zephyr', 'zephyr pharmacy'])

    await user.clear(input)
    await waitFor(() => expect(screen.getByTestId('search-live')).toBeEmptyDOMElement(), {
      timeout: 3000,
    })
    await user.type(input, 'zephyr')
    await waitFor(() => expect(searches()).toHaveLength(3), { timeout: 3000 })
  })

  it('records an empty-result search with zero counts', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'qqqzzz')

    await waitFor(() => expect(searches()).toHaveLength(1), { timeout: 3000 })
    expect(searches()[0]?.payload).toEqual({ query: 'qqqzzz', postCount: 0, peopleCount: 0 })
  })

  it('records nothing for an empty or unsearchable query', async () => {
    const { user, input } = await renderBox()
    await user.type(input, '  #')
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(searches()).toHaveLength(0)
  })

  it('clamps a very long query', async () => {
    const { user, input } = await renderBox()
    await user.click(input)
    await user.paste('x'.repeat(250))

    await waitFor(() => expect(searches()).toHaveLength(1), { timeout: 3000 })
    expect(String(searches()[0]?.payload?.query)).toHaveLength(100)
  })
})

describe('SearchBox — keyboard (NFR-001)', () => {
  it('Down-arrow in the box jumps to the first result; Up/Down move between results', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')

    await user.keyboard('{ArrowDown}')
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(links[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(links[2]).toHaveFocus()
    await user.keyboard('{ArrowDown}') // already last: stays
    expect(links[2]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(links[1]).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}') // first, then back to the box
    expect(input).toHaveFocus()
  })

  it('Enter in the box moves focus to the first result', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr{Enter}')

    await screen.findByTestId('search-posts')
    await user.type(input, '{Enter}')
    expect(screen.getAllByRole('link')[0]).toHaveFocus()
  })

  it('Escape in the results returns to the box; Escape in the box clears it', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('link')[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('zephyr')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(screen.queryByTestId('search-results')).not.toBeInTheDocument()
  })

  it('keeps arrow keys for the Recent / Top radios (they are not hijacked)', async () => {
    const { user, input } = await renderBox()
    await user.type(input, 'zephyr')
    await screen.findByTestId('search-posts')

    screen.getByRole('radio', { name: 'Recent' }).focus()
    await user.keyboard('{ArrowDown}')
    // The radio group handled it (focus did not jump into the result list).
    expect(screen.queryAllByRole('link').some(link => link === document.activeElement)).toBe(false)
  })

  it('has a clear button that empties the box and returns focus to it', async () => {
    const { user, input } = await renderBox()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

    await user.type(input, 'zephyr')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })
})

describe('SearchBox — opening results', () => {
  it('opens a post and a profile through the supplied callbacks', async () => {
    const onOpenPost = vi.fn()
    const onOpenProfile = vi.fn()
    const { user, input } = await renderBox({ onOpenPost, onOpenProfile })

    await user.type(input, 'vega')
    await user.click(await screen.findByRole('link', { name: /View .*profile/ }))
    expect(onOpenProfile).toHaveBeenCalledWith('persona-mvega_fh')
    expect(screen.getByTestId('where')).toHaveTextContent('/explore') // the override ran instead

    await user.clear(input)
    await user.type(input, 'pharmacy')
    const postLink = await screen.findByRole('link', { name: /zephyr pharmacy/ })
    expect(postLink).toHaveAttribute('href', '/kwardFH/status/sb-3')
    await user.click(postLink)
    expect(onOpenPost).toHaveBeenCalledWith('sb-3', 'kwardFH')
  })

  it('navigates in-app by default: a thread, then a profile (no reload)', async () => {
    const { user, input } = await renderBox()

    await user.type(input, 'pharmacy')
    await user.click(await screen.findByRole('link', { name: /zephyr pharmacy/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/kwardFH/status/sb-3')

    await user.clear(input)
    await user.type(input, 'vega')
    await user.click(await screen.findByRole('link', { name: /View .*profile/ }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/mvega_fh'))
  })

  it('caps the results panel in the rail variant', async () => {
    const { user, input } = await renderBox({ variant: 'rail' })
    await user.type(input, 'zephyr')

    const results = await screen.findByTestId('search-results')
    expect(results.className).toMatch(/resultsRail/)
  })

  it('reports when a search starts and ends', async () => {
    const onSearchingChange = vi.fn()
    const { user, input } = await renderBox({ onSearchingChange })

    await user.type(input, 'zep')
    expect(onSearchingChange).toHaveBeenCalledTimes(1)
    expect(onSearchingChange).toHaveBeenLastCalledWith(true)

    await user.clear(input)
    expect(onSearchingChange).toHaveBeenCalledTimes(2)
    expect(onSearchingChange).toHaveBeenLastCalledWith(false)
  })
})
