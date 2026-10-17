/**
 * features/controller/report/components/LookalikeSection.test.tsx
 * ---------------------------------------------------------------------------
 * Story 32 (DF-48): post counts in text, the bar scale's minimum range, and the verdict sentence
 * only for a pair the server marked `outdrew`, stating the two likes + reposts totals.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReportAccount, ReportLookalikePair } from '../types/report'
import { LookalikeSection, MIN_BAR_RANGE } from './LookalikeSection'

function account(overrides: Partial<ReportAccount>): ReportAccount {
  return {
    handle: '@FairhavenWater',
    displayName: 'Fairhaven Water Utility',
    verified: true,
    likes: 0,
    reposts: 0,
    posts: 1,
    ...overrides,
  }
}

function pair(
  verified: Partial<ReportAccount>,
  lookalike: Partial<ReportAccount>,
  outdrew: boolean,
): ReportLookalikePair {
  return {
    verified: account(verified),
    lookalike: account({
      handle: '@FairhavenWaterUpd',
      displayName: 'Fairhaven Water Update',
      verified: false,
      ...lookalike,
    }),
    outdrew,
  }
}

/** The bar widths in render order: verified likes, verified reposts, lookalike likes, reposts. */
function barWidths(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('i[aria-hidden="true"]')]
    .map(bar => Number.parseFloat(bar.style.width))
}

describe('LookalikeSection (story 32, DF-48)', () => {
  it('states each account\'s posts in the window in text', () => {
    render(<LookalikeSection pairs={[pair({ posts: 4 }, { posts: 1 }, false)]} />)
    expect(screen.getByText(/@FairhavenWater ·/)).toHaveTextContent('VERIFIED · 4 posts')
    expect(screen.getByText(/@FairhavenWaterUpd ·/)).toHaveTextContent('UNVERIFIED · 1 post')
  })

  it('draws 1 against 0 as a short bar on the minimum range, never a full-width one', () => {
    const { container } = render(<LookalikeSection pairs={[pair({}, { reposts: 1 }, false)]} />)
    expect(MIN_BAR_RANGE).toBe(10)
    // 1 on a range of 10, where the widest bar is 60% of the row.
    expect(barWidths(container)[3]).toBeCloseTo(6)
  })

  it('still scales to the largest value above the minimum range', () => {
    const { container } = render(
      <LookalikeSection pairs={[pair({ likes: 50 }, { likes: 100 }, true)]} />,
    )
    const widths = barWidths(container)
    expect(widths[0]).toBeCloseTo(30)
    expect(widths[2]).toBeCloseTo(60)
  })

  it('prints no verdict without outdrew, even when the lookalike leads on a measure', () => {
    render(<LookalikeSection pairs={[pair({ reposts: 230 }, { reposts: 241 }, false)]} />)
    expect(screen.queryByText(/more than/)).not.toBeInTheDocument()
    expect(screen.getByText('241 reposts')).toBeInTheDocument()
  })

  it('states the two totals for an outdrew pair, never singling out one measure', () => {
    // 1 like against 0 must not read as "liked more": the sentence is about the totals.
    const led = pair({ likes: 0, reposts: 0 }, { likes: 1, reposts: 1_499 }, true)
    render(<LookalikeSection pairs={[led]} />)
    expect(screen.getByText(
      '@FairhavenWaterUpd drew more engagement than @FairhavenWater: 1,500 likes and reposts against 0.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/liked more/)).not.toBeInTheDocument()
  })

  it('renders without a post count from an older server that sends none', () => {
    const old = pair({}, {}, false)
    delete old.verified.posts
    render(<LookalikeSection pairs={[old]} />)
    expect(screen.getByText(/@FairhavenWater ·/)).toHaveTextContent(/VERIFIED$/)
  })
})
