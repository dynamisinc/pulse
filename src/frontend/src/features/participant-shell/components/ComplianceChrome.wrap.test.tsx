/**
 * features/participant-shell/components/ComplianceChrome.wrap.test.tsx
 * ---------------------------------------------------------------------------
 * Narrow-screen banner wrap (#612, D7-005 phone amendment). Below `CHROME_WRAP_QUERY`
 * the compliance banners wrap their text (up to `WRAP_MAX_LINES` lines, ellipsis past
 * that) instead of clipping it, and the published inset vars carry the MEASURED banner
 * heights, kept current by a ResizeObserver. At wider widths nothing changes.
 *
 * jsdom does no layout, so `matchMedia`, `ResizeObserver` and `getBoundingClientRect` are
 * stubbed: the tests drive "the band is now N px tall" and assert what gets published.
 * Real wrapping and the no-clipping guarantee are covered by
 * `e2e/compliance-chrome.phone.spec.ts`.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOTTOM_BANNER_HEIGHT,
  CHROME_WRAP_QUERY,
  ComplianceChrome,
  TOP_BANNER_HEIGHT,
  WRAP_MAX_LINES,
} from './ComplianceChrome'
import { useChromeConfig } from '../chromeConfig'
import { SHELL_CHROME_BOTTOM_VAR, SHELL_CHROME_TOP_VAR } from '../mountContract'
import type { ChromeConfig } from '../mountContract'

vi.mock('../chromeConfig', () => ({ useChromeConfig: vi.fn() }))
const mockUseChromeConfig = vi.mocked(useChromeConfig)

const CONFIG: ChromeConfig = {
  enabled: true,
  watermark: false,
  top: { text: 'ROLE-PLAY EXERCISE ONLY -- SECTOR 7 -- SIMULATED FEED', fg: '#101820', bg: '#f4a300' },
  bottom: { text: 'THIS IS A DRILL -- NO REAL-WORLD ACTION REQUIRED', fg: '#ffffff', bg: '#4b0082' },
}

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)

/** A controllable `matchMedia` whose CHROME_WRAP_QUERY result can be flipped mid-test. */
function stubMatchMedia(initiallyNarrow: boolean) {
  let narrow = initiallyNarrow
  const listeners = new Set<() => void>()
  const list = {
    get matches() { return narrow },
    media: CHROME_WRAP_QUERY,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => list))
  return {
    set(next: boolean) {
      narrow = next
      for (const fn of listeners) fn()
    },
  }
}

/** Heights the stubbed layout reports per banner test id; and the live ResizeObservers. */
const heights: Record<string, number> = {}
const observers: Array<() => void> = []

beforeEach(() => {
  heights['pulse-compliance-chrome-top'] = 28
  heights['pulse-compliance-chrome-bottom'] = 28
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  rect.mockImplementation(function (this: HTMLElement) {
    const h = heights[this.dataset.testid ?? ''] ?? 0
    return {
      height: h, width: 360, top: 0, left: 0, right: 360, bottom: h, x: 0, y: 0, toJSON: () => ({}),
    }
  })
  vi.stubGlobal('ResizeObserver', class {
    private readonly cb: () => void
    constructor(cb: () => void) { this.cb = cb; observers.push(cb) }
    observe() {}
    disconnect() { observers.splice(observers.indexOf(this.cb), 1) }
  })
  mockUseChromeConfig.mockReturnValue(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  observers.length = 0
  document.documentElement.style.removeProperty(SHELL_CHROME_TOP_VAR)
  document.documentElement.style.removeProperty(SHELL_CHROME_BOTTOM_VAR)
})

describe('ComplianceChrome on narrow screens (#612)', () => {
  it('wraps the text (clamped at WRAP_MAX_LINES) instead of a fixed one-line band', () => {
    stubMatchMedia(true)
    render(<ComplianceChrome />)
    const top = screen.getByTestId('pulse-compliance-chrome-top')
    expect(top).toHaveAttribute('data-wrapped', 'true')
    expect(top.style.whiteSpace).toBe('normal')
    expect(top.style.height).toBe('')
    // jsdom mangles env() inside inline styles, so check the 22px floor, not the exact calc().
    expect(top.style.minHeight).toContain('22px')
    const text = top.querySelector('span') as HTMLSpanElement
    expect(text.style.webkitLineClamp).toBe(String(WRAP_MAX_LINES))
    expect(text.textContent).toBe(CONFIG.top.text)
  })

  it('publishes the measured banner heights as the inset vars', () => {
    stubMatchMedia(true)
    heights['pulse-compliance-chrome-bottom'] = 39.2
    render(<ComplianceChrome />)
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('28px')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('40px') // rounded UP, nothing tucks under
  })

  it('re-publishes when a banner resizes (rotation, font load, text change)', () => {
    stubMatchMedia(true)
    render(<ComplianceChrome />)
    heights['pulse-compliance-chrome-top'] = 22
    act(() => { for (const cb of observers) cb() })
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('22px')
  })

  it('goes back to the constant 22px contract when the viewport widens, and back again', () => {
    const media = stubMatchMedia(true)
    render(<ComplianceChrome />)
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('28px')

    act(() => media.set(false))
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe(BOTTOM_BANNER_HEIGHT)
    expect(screen.getByTestId('pulse-compliance-chrome-top')).not.toHaveAttribute('data-wrapped')
    expect(observers).toHaveLength(0)

    act(() => media.set(true))
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('28px')
  })

  it('still clears both vars on unmount', () => {
    stubMatchMedia(true)
    const { unmount } = render(<ComplianceChrome />)
    unmount()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('')
  })

  it('chrome-off stays 0px and measures nothing', () => {
    stubMatchMedia(true)
    mockUseChromeConfig.mockReturnValue({ ...CONFIG, enabled: false })
    render(<ComplianceChrome />)
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('0px')
    expect(observers).toHaveLength(0)
  })
})

describe('ComplianceChrome at tablet/desktop widths', () => {
  it('is unchanged: one 22px line and the constant inset', () => {
    stubMatchMedia(false)
    render(<ComplianceChrome />)
    const top = screen.getByTestId('pulse-compliance-chrome-top')
    expect(top).not.toHaveAttribute('data-wrapped')
    expect(top.style.whiteSpace).toBe('nowrap')
    expect(top.style.height).toContain('22px') // jsdom mangles env(); see the wrap test above
    expect(top.style.minHeight).toBe('')
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(observers).toHaveLength(0)
  })
})
