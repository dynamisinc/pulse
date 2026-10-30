/**
 * ExerciseEndedBanner + ComplianceChrome hosting (exercise-ended read-only review).
 * Pins: exact copy, icon + text (not colour-only), role=status, no dismiss, no time, renders with
 * chrome off, and its measured height joins `--pulse-chrome-top` so the alert bar (which sits at
 * that inset) lands BELOW it. (No axe engine ships in this repo; the a11y facts axe would check
 * for this markup -- role, text alternative, hidden decorative icon, no interactive control --
 * are asserted structurally instead.)
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComplianceChrome, TOP_BANNER_HEIGHT } from './ComplianceChrome'
import { EXERCISE_ENDED_BANNER_TEXT } from './ExerciseEndedBanner'
import { useChromeConfig } from '../chromeConfig'
import { ExerciseEndedProvider } from '../writeGate'
import { SHELL_CHROME_TOP_VAR } from '../mountContract'
import type { ChromeConfig } from '../mountContract'

vi.mock('../chromeConfig', () => ({ useChromeConfig: vi.fn() }))
const mockUseChromeConfig = vi.mocked(useChromeConfig)
let ended = true

function Chrome() {
  return (
    <ExerciseEndedProvider ended={ended}>
      <ComplianceChrome />
    </ExerciseEndedProvider>
  )
}

const CONFIG: ChromeConfig = {
  enabled: true,
  watermark: false,
  top: { text: 'EXERCISE', fg: '#101820', bg: '#f4a300' },
  bottom: { text: 'DRILL', fg: '#ffffff', bg: '#4b0082' },
}

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)
const ENDED_TEXT =
  'This exercise has ended. You can still read posts, but nothing new can be posted.'

let endedHeight = 36
const observers: Array<() => void> = []

beforeEach(() => {
  endedHeight = 36
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const h = this.dataset.testid === 'pulse-exercise-ended-banner' ? endedHeight : 22
    return {
      height: h, width: 360, top: 0, left: 0, right: 360, bottom: h, x: 0, y: 0, toJSON: () => ({}),
    }
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {},
  })))
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { observers.push(cb) }
    observe() {}
    disconnect() {}
  })
  mockUseChromeConfig.mockReturnValue(CONFIG)
  ended = true
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  observers.length = 0
  document.documentElement.style.removeProperty(SHELL_CHROME_TOP_VAR)
})

describe('ExerciseEndedBanner', () => {
  it('announces via a live region that exists BEFORE the flip and is filled after it (W-2)', () => {
    ended = false
    const view = render(<Chrome />)
    const region = screen.getByTestId('pulse-exercise-ended-announcer')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toBeEmptyDOMElement()

    ended = true
    view.rerender(<Chrome />)

    expect(screen.getByTestId('pulse-exercise-ended-announcer')).toBe(region)
    expect(region).toHaveTextContent(ENDED_TEXT)
    // The visible band is not itself a live region, so the text is not announced twice.
    expect(screen.getByTestId('pulse-exercise-ended-banner')).not.toHaveAttribute('role')
  })

  it('keeps the (empty) live region even with chrome off', () => {
    ended = false
    mockUseChromeConfig.mockReturnValue({ ...CONFIG, enabled: false })
    render(<Chrome />)
    expect(screen.getByTestId('pulse-exercise-ended-announcer')).toBeEmptyDOMElement()
  })

  it('carries the exact copy', () => {
    expect(EXERCISE_ENDED_BANNER_TEXT).toBe(ENDED_TEXT)
    render(<Chrome />)
    expect(screen.getByTestId('pulse-exercise-ended-banner')).toHaveTextContent(ENDED_TEXT)
    expect(screen.getByRole('status')).toHaveTextContent(ENDED_TEXT)
  })

  it('pairs a decorative icon with the text (never colour-only)', () => {
    render(<Chrome />)
    const banner = screen.getByTestId('pulse-exercise-ended-banner')
    const icon = banner.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(banner.textContent).toBe(ENDED_TEXT)
  })

  it('has no dismiss control and no time', () => {
    render(<Chrome />)
    const banner = screen.getByTestId('pulse-exercise-ended-banner')
    expect(banner.querySelector('button, a, [tabindex], input')).toBeNull()
    expect(banner.textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('is absent when the exercise has not ended', () => {
    ended = false
    render(<Chrome />)
    expect(screen.queryByTestId('pulse-exercise-ended-banner')).toBeNull()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
  })

  it('sits directly under the top banner and adds its measured height to the top inset', () => {
    render(<Chrome />)
    const banner = screen.getByTestId('pulse-exercise-ended-banner')
    expect(banner.style.top).toContain('22px')
    // The alert bar / pins / overlays are pinned at this var, so they land below the band.
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toContain('36px')
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toContain(TOP_BANNER_HEIGHT)
  })

  it('re-publishes when the band wraps to more lines', () => {
    render(<Chrome />)
    endedHeight = 58
    act(() => { for (const cb of observers) cb() })
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toContain('58px')
  })

  it('still renders with chrome off, at the very top, and drives the inset alone', () => {
    mockUseChromeConfig.mockReturnValue({ ...CONFIG, enabled: false })
    render(<Chrome />)
    expect(screen.queryByTestId('pulse-compliance-chrome-top')).toBeNull()
    const banner = screen.getByTestId('pulse-exercise-ended-banner')
    expect(banner.style.top).toBe('0px')
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('calc(0px + 36px)')
  })

  it('returns the inset to the plain banner height when the band goes away', () => {
    const { rerender } = render(<Chrome />)
    ended = false
    rerender(<Chrome />)
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
  })
})
