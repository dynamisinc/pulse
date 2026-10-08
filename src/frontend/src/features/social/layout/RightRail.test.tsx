/**
 * features/social/layout/RightRail.test.tsx
 * ---------------------------------------------------------------------------
 * The right rail (demo-polish F1, "Right rail" AC): the `aside[aria-label=Sidebar]`
 * landmark exposing `searchSlot` and `trendingSlot`, with F6's search box and Trending
 * panel and "Who to follow" -- titled exactly that, never "official" (D1-R1) -- in
 * `RightRailContent`; on `/explore` the search and trending move to the page itself.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { RightRail } from './RightRail'
import { renderChannel } from './renderChannel.testUtils'

afterEach(() => {
  resetExerciseClock()
})

describe('RightRail', () => {
  it('is the Sidebar complementary landmark', () => {
    render(<RightRail />)
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  })

  it('renders no slot wrappers while the slots are empty', () => {
    render(<RightRail />)
    expect(screen.queryByTestId('right-rail-search-slot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('right-rail-trending-slot')).not.toBeInTheDocument()
  })

  it('renders the search slot, then the trending slot, then the children, in that order', () => {
    render(
      <RightRail
        searchSlot={<input aria-label="Search" />}
        trendingSlot={<p>Trending now</p>}
      >
        <p>Who to follow stand-in</p>
      </RightRail>,
    )
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })
    const text = rail.textContent ?? ''
    expect(within(rail).getByTestId('right-rail-search-slot')).toContainElement(
      screen.getByLabelText('Search'),
    )
    expect(within(rail).getByTestId('right-rail-trending-slot')).toHaveTextContent('Trending now')
    expect(text.indexOf('Trending now')).toBeLessThan(text.indexOf('Who to follow stand-in'))
  })
})

describe('RightRailContent (mounted by the channel)', () => {
  it('holds the search box, Trending and "Who to follow" (titled exactly that), in order', async () => {
    renderChannel()
    const module = await screen.findByTestId('who-to-follow')
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })
    expect(rail).toContainElement(module)
    expect(within(module).getByRole('heading', { name: 'Who to follow' })).toBeInTheDocument()
    // D1-R1: nothing in the module claims authority.
    expect(module.textContent ?? '').not.toMatch(/official|trusted|recommended/i)

    const search = within(rail).getByTestId('right-rail-search-slot')
    const trending = within(rail).getByTestId('right-rail-trending-slot')
    expect(within(search).getByRole('search', { name: 'Search posts and people' })).toBeInTheDocument()
    expect(within(trending).getByRole('region', { name: 'What’s happening' })).toBeInTheDocument()
    const order = (rail.textContent ?? '')
    expect(order.indexOf('Search posts and people')).toBeLessThan(order.indexOf('What’s happening'))
    expect(order.indexOf('What’s happening')).toBeLessThan(order.indexOf('Who to follow'))
  })

  it('hides the rail\'s search and trending on /explore (the page has its own)', async () => {
    renderChannel({ entries: ['/explore'] })
    await screen.findByTestId('explore-page')
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })

    expect(within(rail).queryByTestId('right-rail-search-slot')).not.toBeInTheDocument()
    expect(within(rail).queryByTestId('right-rail-trending-slot')).not.toBeInTheDocument()
    // One search landmark and one trends region on the whole page, not two.
    expect(screen.getAllByRole('search')).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'What’s happening' })).toHaveLength(1)
    // "Who to follow" stays.
    expect(await within(rail).findByTestId('who-to-follow')).toBeInTheDocument()
  })

  it('caps the module at 3 rows', async () => {
    renderChannel()
    const module = await screen.findByTestId('who-to-follow')
    const rows = await within(module).findAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(3)
  })
})
