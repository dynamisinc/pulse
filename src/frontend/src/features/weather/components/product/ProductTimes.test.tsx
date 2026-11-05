/**
 * ProductTimes (weather-source 07, #758; COR-053): Issued / Effective / Expires through
 * ScenarioDateline, in the exercise zone, never wall clock and never "scenario time" wording.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEATHER_WATCH_FIXTURE } from '@/features/weather/contract'
import { pinScenarioClock, resetExerciseClock } from '@/features/channels/primitives/primitivesTestUtils'
import { ProductTimes } from './ProductTimes'

const ctx = vi.hoisted(() => ({ timeZone: 'America/Chicago' }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: ctx.timeZone }),
}))

const { payload, publishedScenarioTime } = WEATHER_WATCH_FIXTURE

beforeEach(() => {
  ctx.timeZone = 'America/Chicago'
  pinScenarioClock('2026-12-02T14:00:00Z')
  // The wall clock is a different year: nothing may come from it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2031-07-04T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetExerciseClock()
})

function renderTimes() {
  return render(
    <ProductTimes
      issuedScenarioTime={publishedScenarioTime}
      effectiveScenarioTime={payload.effectiveScenarioTime}
      expiresScenarioTime={payload.expiresScenarioTime}
    />,
  )
}

describe('ProductTimes', () => {
  it('renders Issued, Effective and Expires in order, as a definition list', () => {
    renderTimes()
    const list = screen.getByTestId('weather-product-times')
    expect(list.tagName).toBe('DL')
    expect([...list.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Issued', 'Effective', 'Expires'])
  })

  it('renders every instant in the exercise time zone', () => {
    renderTimes()
    // 13:25Z / 13:30Z / 19:00Z in America/Chicago (CST, UTC-6).
    expect(screen.getByText('Dec 2, 2026, 7:25 AM').closest('time')).toHaveAttribute('dateTime', publishedScenarioTime)
    expect(screen.getByText('Dec 2, 2026, 7:30 AM')).toBeInTheDocument()
    expect(screen.getByText('Dec 2, 2026, 1:00 PM')).toBeInTheDocument()
  })

  it('follows the exercise zone, not the browser zone', () => {
    ctx.timeZone = 'America/New_York'
    renderTimes()
    expect(screen.getByText('Dec 2, 2026, 2:00 PM')).toBeInTheDocument()
  })

  it('never shows the wall-clock year and never says "scenario"', () => {
    const { container } = renderTimes()
    expect(container.textContent).not.toContain('2031')
    expect(container.textContent?.toLowerCase()).not.toContain('scenario')
  })

  it('omits the Issued row for an unpublished preview', () => {
    render(
      <ProductTimes
        issuedScenarioTime={null}
        effectiveScenarioTime={payload.effectiveScenarioTime}
        expiresScenarioTime={payload.expiresScenarioTime}
      />,
    )
    expect(screen.queryByText('Issued')).toBeNull()
    expect(screen.getByText('Effective')).toBeInTheDocument()
  })

  it('passes the skin dateline format through', () => {
    render(
      <ProductTimes
        effectiveScenarioTime={payload.effectiveScenarioTime}
        expiresScenarioTime={payload.expiresScenarioTime}
        format="compact"
      />,
    )
    expect(screen.getByText('Dec 2 · 7:30 AM')).toBeInTheDocument()
  })
})
