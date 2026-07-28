/**
 * features/planner/components/FieldGrid.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the exercise-configuration field-layout primitive (#41).
 *
 * WHAT IS WORTH ASSERTING HERE — AND WHAT IS NOT. jsdom does no layout: it will
 * never tell us how many columns a 860px pane produces, and a test that claimed
 * to know would be lying. (The column counts and section heights were measured
 * in a real browser at 1440x900 / 1280x800; see the story notes.)
 *
 * What jsdom DOES resolve faithfully is the declaration itself, and that is
 * where this component's two correctness properties live:
 *
 *  1. `auto-fit` + `minmax(..., 1fr)` — the reason a section stops scrolling at
 *     desktop widths and still collapses to one column when it must. Replacing
 *     it with a fixed `1fr 1fr` would silently un-fix the narrow case;
 *  2. the `min(100%, …)` guard — the reason a pane narrower than the column
 *     floor COLLAPSES instead of overflowing horizontally. It is one easily
 *     "tidied away" function call, and dropping it is invisible until someone
 *     opens the console on a small window.
 *
 * Plus the ordering property the accessibility claim rests on: CSS Grid must not
 * be reordering anything, so DOM order (= tab order) is the visual order.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FieldGrid } from './FieldGrid'

/** The grid element itself — the parent the children are placed into. */
function gridFor(child: HTMLElement): HTMLElement {
  const grid = child.parentElement
  if (grid === null) throw new Error('FieldGrid rendered no container')
  return grid
}

describe('FieldGrid — the responsive column contract', () => {
  it('lays children out in a grid, not a stack', () => {
    render(
      <FieldGrid>
        <input data-testid="first" />
        <input data-testid="second" />
      </FieldGrid>,
    )

    const grid = gridFor(screen.getByTestId('first'))
    expect(getComputedStyle(grid).display).toBe('grid')
    // Both children are placed by the SAME grid — a wrapper per child would
    // defeat the column packing entirely.
    expect(gridFor(screen.getByTestId('second'))).toBe(grid)
  })

  it('fits as many columns as the container can hold, rather than a fixed count', () => {
    render(<FieldGrid><input data-testid="field" /></FieldGrid>)

    const columns = getComputedStyle(gridFor(screen.getByTestId('field'))).gridTemplateColumns
    // `auto-fit` is what makes the count follow the available width; `1fr` is
    // what makes the columns share the leftover.
    expect(columns).toContain('auto-fit')
    expect(columns).toContain('1fr')
  })

  it('guards the narrow case with min(100%, …) so it collapses instead of overflowing', () => {
    render(<FieldGrid minColumnWidth={320}><input data-testid="field" /></FieldGrid>)

    // A bare `minmax(320px, 1fr)` track cannot shrink below 320px, so in a
    // 240px pane the grid would be wider than its container and clip.
    expect(getComputedStyle(gridFor(screen.getByTestId('field'))).gridTemplateColumns)
      .toContain('min(100%, 320px)')
  })

  it('honours the caller’s column floor, and defaults to a readable one', () => {
    const { unmount } = render(<FieldGrid minColumnWidth={190}><input data-testid="a" /></FieldGrid>)
    expect(getComputedStyle(gridFor(screen.getByTestId('a'))).gridTemplateColumns).toContain('190px')
    unmount()

    render(<FieldGrid><input data-testid="b" /></FieldGrid>)
    expect(getComputedStyle(gridFor(screen.getByTestId('b'))).gridTemplateColumns).toContain('280px')
  })

  it('keeps DOM order — the grid never reorders, so tab order still reads left to right', () => {
    render(
      <FieldGrid>
        <input data-testid="one" />
        <input data-testid="two" />
        <input data-testid="three" />
      </FieldGrid>,
    )

    const grid = gridFor(screen.getByTestId('one'))
    expect([...grid.children].map(child => child.getAttribute('data-testid')))
      .toEqual(['one', 'two', 'three'])
    // `grid-auto-flow: dense` would let the browser fill holes out of order,
    // divorcing the visual order from the tab order (NFR-001).
    expect(getComputedStyle(grid).gridAutoFlow).not.toContain('dense')
  })
})
