/**
 * features/social/layout/RightRail.test.tsx
 * ---------------------------------------------------------------------------
 * The right rail (demo-polish F1, "Right rail" AC): the `aside[aria-label=Sidebar]`
 * landmark exposing `searchSlot` and `trendingSlot` (EMPTY until F6), with
 * "Who to follow" -- titled exactly that, never "official" (D1-R1) -- in
 * `RightRailContent`.
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

  it('renders no slot wrappers while the slots are empty (F6 has not landed)', () => {
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
  it('holds "Who to follow" only, titled exactly that, with no search / trending yet', async () => {
    renderChannel()
    const module = await screen.findByTestId('who-to-follow')
    const rail = screen.getByRole('complementary', { name: 'Sidebar' })
    expect(rail).toContainElement(module)
    expect(within(module).getByRole('heading', { name: 'Who to follow' })).toBeInTheDocument()
    // D1-R1: nothing in the module claims authority.
    expect(module.textContent ?? '').not.toMatch(/official|trusted|recommended/i)
    expect(screen.queryByTestId('right-rail-search-slot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('right-rail-trending-slot')).not.toBeInTheDocument()
  })

  it('caps the module at 3 rows', async () => {
    renderChannel()
    const module = await screen.findByTestId('who-to-follow')
    const rows = await within(module).findAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(3)
  })
})
