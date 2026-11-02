/**
 * ProductStateBanner + productBanner (weather-source 07, #758; COR-053): icon + text banner
 * for pending / expired / cancelled, none when active, recomputed from scenario now so it
 * flips without a refetch.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WEATHER_CANCEL_FIXTURE,
  WEATHER_UPGRADE_FIXTURE,
  WEATHER_WATCH_FIXTURE,
} from '@/features/weather/contract'
import { pinScenarioClock, resetExerciseClock } from '@/features/channels/primitives/primitivesTestUtils'
import { ProductStateBanner } from './ProductStateBanner'
import { formatCountdown, productBanner } from './productBanner'

// The watch is effective 13:30Z and expires 19:00Z.
const WATCH = WEATHER_WATCH_FIXTURE

afterEach(() => {
  vi.useRealTimers()
  resetExerciseClock()
})

describe('formatCountdown', () => {
  it.each([
    [1, '1 MIN'],
    [59_000, '1 MIN'],
    [60_000, '1 MIN'],
    [61_000, '2 MIN'],
    [45 * 60_000, '45 MIN'],
    [60 * 60_000, '1 HR'],
    [(2 * 60 + 5) * 60_000, '2 HR 5 MIN'],
    [(24 * 60) * 60_000, '1 DAY'],
    [(26 * 60 + 30) * 60_000, '1 DAY 2 HR'],
    [(3 * 24 * 60 + 7) * 60_000, '3 DAYS 7 MIN'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text)
  })
})

describe('productBanner', () => {
  it.each([
    ['pending', '2026-12-02T11:25:00Z', { state: 'pending', text: 'EFFECTIVE IN 2 HR 5 MIN' }],
    ['active (no banner)', '2026-12-02T13:30:00Z', null],
    ['expired at the expiry instant', '2026-12-02T19:00:00Z', { state: 'expired', text: 'EXPIRED' }],
  ])('%s', (_label, now, expected) => {
    expect(productBanner(WATCH, now)).toEqual(expected)
  })

  it('a published cancel wins over every time-based state', () => {
    expect(productBanner(WEATHER_UPGRADE_FIXTURE, '2026-12-02T14:30:00Z', [WEATHER_CANCEL_FIXTURE]))
      .toEqual({ state: 'cancelled', text: 'CANCELLED' })
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(productBanner(WATCH, new Date(Date.parse('2026-12-02T20:00:00Z')))?.state).toBe('expired')
  })
})

describe('ProductStateBanner: from a parent snapshot', () => {
  it.each([
    ['2026-12-02T13:00:00Z', 'pending', 'EFFECTIVE IN 30 MIN', 'clock'],
    ['2026-12-02T19:30:00Z', 'expired', 'EXPIRED', 'hourglass-end'],
  ])('at %s shows %s with icon and text', (now, state, text, icon) => {
    render(<ProductStateBanner product={WATCH} scenarioNow={now} />)
    const banner = screen.getByTestId('weather-product-state-banner')
    expect(banner).toHaveAttribute('data-product-state', state)
    expect(banner).toHaveTextContent(text)
    const svg = banner.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-icon', icon)
  })

  it('shows CANCELLED when the caller holds the published cancel', () => {
    render(
      <ProductStateBanner
        product={WEATHER_UPGRADE_FIXTURE}
        published={[WEATHER_UPGRADE_FIXTURE, WEATHER_CANCEL_FIXTURE]}
        scenarioNow="2026-12-02T14:56:00Z"
      />,
    )
    expect(screen.getByTestId('weather-product-state-banner')).toHaveTextContent('CANCELLED')
    expect(screen.getByTestId('weather-product-state-banner').querySelector('svg'))
      .toHaveAttribute('data-icon', 'ban')
  })

  it('renders nothing while the product is active ("IN EFFECT UNTIL …" is the default)', () => {
    const { container } = render(<ProductStateBanner product={WATCH} scenarioNow="2026-12-02T15:00:00Z" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ProductStateBanner: follows the live scenario clock (no refetch)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The wall clock is far from the scenario: the banner must never read it.
    vi.setSystemTime(Date.parse('2031-01-01T00:00:00Z'))
  })

  it('counts down, turns active, then expires as scenario time moves', () => {
    pinScenarioClock('2026-12-02T13:00:00Z')
    const { container } = render(<ProductStateBanner product={WATCH} />)
    expect(screen.getByTestId('weather-product-state-banner')).toHaveTextContent('EFFECTIVE IN 30 MIN')

    act(() => {
      pinScenarioClock('2026-12-02T13:29:10Z')
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('weather-product-state-banner')).toHaveTextContent('EFFECTIVE IN 1 MIN')

    act(() => {
      pinScenarioClock('2026-12-02T14:00:00Z')
      vi.advanceTimersByTime(30_000)
    })
    expect(container).toBeEmptyDOMElement()

    // A time jump past expiry.
    act(() => {
      pinScenarioClock('2026-12-02T22:00:00Z')
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('weather-product-state-banner')).toHaveTextContent('EXPIRED')
  })
})
