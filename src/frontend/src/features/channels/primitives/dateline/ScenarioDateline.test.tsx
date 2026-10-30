/**
 * ScenarioDateline: scenario-time rendering (COR-053 / XC-008) and the FC-1 Updated
 * stamp rule (news FU-1, D3-P4).
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pinScenarioClock, resetExerciseClock } from '../primitivesTestUtils'
import { registerDatelineFormat, resetDatelineFormatsForTests } from './datelineFormats'
import { ScenarioDateline } from './ScenarioDateline'
import { shouldShowUpdatedStamp } from './updatedStamp'

const ctx = vi.hoisted(() => ({ timeZone: 'America/New_York' }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: ctx.timeZone }),
}))

const PUBLISHED = '2026-10-29T18:32:00Z' // 2:32 PM EDT

beforeEach(() => {
  ctx.timeZone = 'America/New_York'
  // Scenario "now" is two hours after publish; the WALL clock is a different year.
  pinScenarioClock('2026-10-29T20:32:00Z')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse('2031-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  resetExerciseClock()
  resetDatelineFormatsForTests()
})

describe('ScenarioDateline: scenario time', () => {
  it('renders in the exercise time zone from the exercise context', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} />)
    expect(screen.getByText('Oct 29, 2026, 2:32 PM')).toBeInTheDocument()
    ctx.timeZone = 'America/Chicago'
    render(<ScenarioDateline scenarioTime={PUBLISHED} />)
    expect(screen.getByText('Oct 29, 2026, 1:32 PM')).toBeInTheDocument()
  })

  it('a timeZone prop overrides the exercise zone', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} timeZone="UTC" />)
    expect(screen.getByText('Oct 29, 2026, 6:32 PM')).toBeInTheDocument()
  })

  it('"relative" is measured from scenarioNow(), never Date.now() (wall clock is 2031 here)', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} format="relative" />)
    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  it('"relative" follows the scenario clock when it advances', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2031-01-01T00:00:00Z'))
    render(<ScenarioDateline scenarioTime={PUBLISHED} format="relative" />)
    expect(screen.getByText('2h ago')).toBeInTheDocument()
    act(() => {
      pinScenarioClock('2026-10-29T23:40:00Z')
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByText('5h ago')).toBeInTheDocument()
  })

  it('the format comes from the skin name through the registry (a channel format, news "wire")', () => {
    registerDatelineFormat('wire', t => `${t.dateline()} · ${t.time()} ${t.zoneName()}`)
    render(<ScenarioDateline scenarioTime={PUBLISHED} format="wire" />)
    expect(screen.getByText('OCT 29, 2026 · 2:32 PM EDT')).toBeInTheDocument()
  })

  it('carries the machine-readable instant on <time dateTime>', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} />)
    expect(screen.getByText('Oct 29, 2026, 2:32 PM').closest('time'))
      .toHaveAttribute('dateTime', PUBLISHED)
  })

  it('never says "scenario time"', () => {
    const { container } = render(
      <ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime="2026-10-29T19:05:00Z" />,
    )
    // Visible text and every accessible-name attribute (test ids are not participant-facing).
    expect(container.textContent?.toLowerCase()).not.toContain('scenario')
    for (const element of container.querySelectorAll('*')) {
      for (const attr of ['aria-label', 'title', 'aria-description']) {
        expect(element.getAttribute(attr)?.toLowerCase() ?? '').not.toContain('scenario')
      }
    }
  })

  it('renders nothing for an unparseable instant', () => {
    const { container } = render(<ScenarioDateline scenarioTime="garbage" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ScenarioDateline: the FC-1 Updated stamp rule', () => {
  it('no stamp when updatedScenarioTime is null (never updated, or only `edit`ed)', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime={null} />)
    expect(screen.queryByTestId('scenario-dateline-updated')).toBeNull()
  })

  it('shows "Updated 3:05 PM" from updatedScenarioTime alone: a silent_rewrite with no revisions[] entry still shows it', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime="2026-10-29T19:05:00Z" />)
    const stamp = screen.getByTestId('scenario-dateline-updated')
    expect(stamp).toHaveTextContent('Updated 3:05 PM')
    expect(stamp.querySelector('time')).toHaveAttribute('dateTime', '2026-10-29T19:05:00Z')
  })

  it('a next-day update (exercise zone) carries its date, so it never reads as same-day', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime="2026-10-30T13:00:00Z" />)
    expect(screen.getByTestId('scenario-dateline-updated')).toHaveTextContent('Updated Oct 30 · 9:00 AM')
  })

  it('a stamp equal to or before the publish instant is not shown', () => {
    render(<ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime={PUBLISHED} />)
    render(<ScenarioDateline scenarioTime={PUBLISHED} updatedScenarioTime="2026-10-29T10:00:00Z" />)
    expect(screen.queryByTestId('scenario-dateline-updated')).toBeNull()
  })
})

describe('shouldShowUpdatedStamp', () => {
  it.each([
    ['null (edit / touchUpdatedStamp:false moved nothing)', null, false],
    ['undefined', undefined, false],
    ['unparseable', 'later', false],
    ['equal to publish', PUBLISHED, false],
    ['before publish', '2026-10-29T18:00:00Z', false],
    ['after publish (update / correction / silent_rewrite)', '2026-10-29T18:33:00Z', true],
  ])('%s => %s', (_label, updated, expected) => {
    expect(shouldShowUpdatedStamp(PUBLISHED, updated)).toBe(expected)
  })

  it('trusts the server stamp when the publish instant cannot be parsed', () => {
    expect(shouldShowUpdatedStamp('bad', '2026-10-29T18:33:00Z')).toBe(true)
  })
})
