/**
 * features/controller/report/components/LookalikeSection.test.tsx
 * ---------------------------------------------------------------------------
 * Story 32 (DF-48): post counts in text, the bar scale's minimum range, and the verdict sentence
 * only for a pair the server marked `outdrew`, naming only the measures the lookalike led on.
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
    const lookalikeReposts = barWidths(container)[3]
    expect(lookalikeReposts).toBeCloseTo(60 / MIN_BAR_RANGE)
    expect(lookalikeReposts).toBeLessThan(10)
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

  it('prints the verdict for an outdrew pair, naming only the measures the lookalike led on', () => {
    const led = pair({ likes: 9, reposts: 1 }, { likes: 2, reposts: 30 }, true)
    render(<LookalikeSection pairs={[led]} />)
    expect(screen.getByText('@FairhavenWaterUpd was reposted more than @FairhavenWater.'))
      .toBeInTheDocument()
  })
})
