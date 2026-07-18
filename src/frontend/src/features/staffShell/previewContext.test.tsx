/**
 * features/staffShell/previewContext.test.ts
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) — coverage for the `PreviewProvider` /
 * `usePreview()` toggle seam and the scenario-moment mock model
 * (`getPreviewMomentConfig` / `resolvePreviewMomentInstant`):
 *
 *  - `usePreview()` throws outside a `<PreviewProvider>` — no default/
 *    module-global preview state (fail-closed, mirroring
 *    `useExerciseContext()` / `useToolstrip()`).
 *  - Default state is inactive, moment `'now'`.
 *  - `toggle()` flips `active`; `setMoment()` replaces the selected moment
 *    (mutually exclusive by construction — a single state value).
 *  - Every moment's config carries a DISTINCT alert state, covering all four
 *    NFR-001 states (none/info/advisory/emergency) across the four moments.
 *  - `resolvePreviewMomentInstant` is pinned against a FAKE exercise clock
 *    (divergent from the system clock, WAVE0-REVIEW precedent 18 — not a bare
 *    `Date.now` spy), proving it reads scenario time, never wall-clock, and
 *    applies each moment's exact fixed offset.
 *
 * A `Probe` component (rendered via a plain `render`, mirroring
 * `toolRegistry.test.tsx`'s own harness pattern) exercises the REAL hook
 * output rather than a re-implemented fixture (WAVE0-REVIEW precedent 17).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import {
  getPreviewMomentConfig,
  PREVIEW_MOMENT_ORDER,
  PreviewProvider,
  resolvePreviewMomentInstant,
  usePreview,
  type PreviewAlertState,
} from './previewContext'

function Probe() {
  const { active, toggle, moment, setMoment } = usePreview()
  return (
    <div>
      <div data-testid="active">{String(active)}</div>
      <div data-testid="moment">{moment}</div>
      <button type="button" onClick={toggle}>toggle</button>
      <button type="button" onClick={() => setMoment('advisory')}>select advisory</button>
      <button type="button" onClick={() => setMoment('burst')}>select burst</button>
    </div>
  )
}

afterEach(() => {
  resetExerciseClock()
})

describe('usePreview — fail-closed outside a <PreviewProvider>', () => {
  it('throws rather than returning a default active/moment a caller could render against', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Bare() {
      usePreview()
      return null
    }

    expect(() => render(<Bare />)).toThrow(/PreviewProvider/)
    consoleSpy.mockRestore()
  })
})

describe('PreviewProvider — default state', () => {
  it('starts inactive with moment "now"', () => {
    render(
      <PreviewProvider>
        <Probe />
      </PreviewProvider>,
    )

    expect(screen.getByTestId('active')).toHaveTextContent('false')
    expect(screen.getByTestId('moment')).toHaveTextContent('now')
  })
})

describe('usePreview — toggle()', () => {
  it('flips active on then off again', async () => {
    const user = userEvent.setup()
    render(
      <PreviewProvider>
        <Probe />
      </PreviewProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('active')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('active')).toHaveTextContent('false')
  })
})

describe('usePreview — setMoment() (mutually exclusive selection)', () => {
  it('replaces the selected moment — only ever one moment selected at a time', async () => {
    const user = userEvent.setup()
    render(
      <PreviewProvider>
        <Probe />
      </PreviewProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'select advisory' }))
    expect(screen.getByTestId('moment')).toHaveTextContent('advisory')

    await user.click(screen.getByRole('button', { name: 'select burst' }))
    expect(screen.getByTestId('moment')).toHaveTextContent('burst')
    // Never both — a single rendered value, never a list/combination.
    expect(screen.getByTestId('moment')).not.toHaveTextContent('advisory')
  })
})

describe('getPreviewMomentConfig — the four moments cover all four NFR-001 alert states', () => {
  it('startex/advisory/burst/now map to none/advisory/emergency/info respectively', () => {
    expect(getPreviewMomentConfig('startex').alertState).toBe('none')
    expect(getPreviewMomentConfig('advisory').alertState).toBe('advisory')
    expect(getPreviewMomentConfig('burst').alertState).toBe('emergency')
    expect(getPreviewMomentConfig('now').alertState).toBe('info')
  })

  it('exercises every distinct PreviewAlertState across the four moments (no accidental duplicate)', () => {
    const states = PREVIEW_MOMENT_ORDER.map(id => getPreviewMomentConfig(id).alertState)
    const distinct = new Set<PreviewAlertState>(states)
    expect(distinct.size).toBe(4)
    expect(distinct).toEqual(new Set(['none', 'info', 'advisory', 'emergency']))
  })

  it('a non-"none" moment always carries an alert message; "none" never does', () => {
    for (const id of PREVIEW_MOMENT_ORDER) {
      const config = getPreviewMomentConfig(id)
      if (config.alertState === 'none') {
        expect(config.alertMessage).toBeUndefined()
      } else {
        expect(config.alertMessage).toBeTruthy()
      }
    }
  })
})

describe('resolvePreviewMomentInstant — reads scenario time, never wall-clock', () => {
  const FAKE_SCENARIO_NOW = new Date('2031-06-15T18:00:00.000Z')

  it('uses a fake exercise clock divergent from the system clock (WAVE0-REVIEW precedent 18)', () => {
    // A bare `Date.now` spy would not catch a `new Date()` leak; pin the
    // exercise clock itself, well away from the real "now", and assert the
    // resolved instant tracks IT, not the system clock.
    setExerciseClock({ scenarioNow: () => FAKE_SCENARIO_NOW })

    const systemNow = Date.now()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    expect(Math.abs(FAKE_SCENARIO_NOW.getTime() - systemNow)).toBeGreaterThan(oneYearMs)

    expect(resolvePreviewMomentInstant('now').getTime()).toBe(FAKE_SCENARIO_NOW.getTime())
  })

  it.each([
    ['startex', 180],
    ['advisory', 90],
    ['burst', 20],
  ] as const)('"%s" resolves to exactly %d minutes before the live scenario clock', (moment, minutesBefore) => {
    setExerciseClock({ scenarioNow: () => FAKE_SCENARIO_NOW })

    const resolved = resolvePreviewMomentInstant(moment)
    const expected = FAKE_SCENARIO_NOW.getTime() - minutesBefore * 60_000

    expect(resolved.getTime()).toBe(expected)
  })

  it('never resolves a moment to a time AFTER the live scenario clock', () => {
    setExerciseClock({ scenarioNow: () => FAKE_SCENARIO_NOW })
    const liveNow = FAKE_SCENARIO_NOW.getTime()

    for (const id of PREVIEW_MOMENT_ORDER) {
      expect(resolvePreviewMomentInstant(id).getTime()).toBeLessThanOrEqual(liveNow)
    }
  })
})
