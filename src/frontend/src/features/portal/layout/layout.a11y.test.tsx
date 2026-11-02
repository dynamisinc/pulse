/**
 * Story 07 (#772) AC "Accessibility" (NFR-001): one `main`, labelled
 * sections, `h1` (masthead) then an `h2` per module, tab order = reading
 * order, and axe clean in the harness. Touch targets and focus styles are
 * pinned from the stylesheets in `layout.static.test.ts` (jsdom does no layout).
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { seriousAxeViolations } from '@/features/channels/primitives/primitivesTestUtils'
import { PORTAL_LAYOUT_SUBSETS, renderPortalSubset } from './testing'

const MASTHEAD = <h1>Fairhaven Today</h1>
const FULL = ['topStories', 'socialStream', 'trending', 'pressLatest', 'weather'] as const

describe('layout accessibility', () => {
  it('has one main, labelled sections and h1 then h2 headings', () => {
    const { container } = renderPortalSubset(FULL, { before: MASTHEAD })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    expect(headings.map(heading => heading.tagName)).toEqual(['H1', 'H2', 'H2', 'H2', 'H2', 'H2'])
    for (const region of screen.getAllByRole('region')) {
      expect(region.getAttribute('aria-labelledby')).toBeTruthy()
    }
  })

  it('tabs through links in reading order (each module heading link, then its content)', async () => {
    const { container } = renderPortalSubset(FULL, { before: MASTHEAD })
    const domOrder = Array.from(container.querySelectorAll('a'))
    const user = userEvent.setup()
    const reached: Element[] = []
    for (let i = 0; i < domOrder.length; i += 1) {
      await user.tab()
      if (document.activeElement) reached.push(document.activeElement)
    }
    expect(reached).toEqual(domOrder)
  })

  it.each([FULL, ...PORTAL_LAYOUT_SUBSETS.filter(subset => subset.length <= 1)])(
    'axe reports no serious or critical violation (%s)',
    async (...subset) => {
      const { container } = renderPortalSubset(subset, { before: MASTHEAD })
      expect(await seriousAxeViolations(container)).toEqual([])
    },
  )

  it('axe stays clean while modules load', async () => {
    const { container } = renderPortalSubset(FULL, {
      before: MASTHEAD,
      statuses: { topStories: 'loading', weather: 'loading' },
    })
    expect(await seriousAxeViolations(container)).toEqual([])
  })
})
