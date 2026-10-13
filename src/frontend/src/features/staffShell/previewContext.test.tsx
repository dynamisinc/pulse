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
 *  - Every moment's config is just a label and a scenario offset: since demo-polish C6 it
 *    carries NO participant-facing copy (the retired PortalStub's alert / headline strings).
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

describe('getPreviewMomentConfig — the four moments carry a label and an offset, and no participant copy', () => {
  it('startex/advisory/burst/now are labelled STARTEX/ADVISORY/BURST/NOW', () => {
    expect(PREVIEW_MOMENT_ORDER.map(id => getPreviewMomentConfig(id).label))
      .toEqual(['STARTEX', 'ADVISORY', 'BURST', 'NOW'])
  })

  it('each moment id maps to its own config', () => {
    for (const id of PREVIEW_MOMENT_ORDER) expect(getPreviewMomentConfig(id).id).toBe(id)
  })

  it('carries no participant-facing copy (the retired PortalStub\'s alert / headline strings)', () => {
    for (const id of PREVIEW_MOMENT_ORDER) {
      expect(Object.keys(getPreviewMomentConfig(id)).sort()).toEqual(['id', 'label', 'offsetMinutes'])
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
