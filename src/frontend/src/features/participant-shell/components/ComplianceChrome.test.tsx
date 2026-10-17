/**
 * features/participant-shell/components/ComplianceChrome.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01 (compliance chrome) — RTL coverage for `ComplianceChrome.tsx`:
 * config-driven banner text/colors (AC1/AC2), the ShellLayout inset contract
 * (AC1), chrome-off as a legal no-gap-artifact state (AC3), and the
 * non-interactive assistive-tech contract (AC5).
 *
 * `../chromeConfig`'s `useChromeConfig` is mocked at the module boundary so
 * every test controls exactly the resolved `ChromeConfig` under test,
 * independent of that seam's own network/query behavior (covered separately
 * in `../chromeConfig.test.tsx` / `../chromeConfig.default.test.tsx`).
 *
 * jsdom limitation (documented here, mirroring `ShellLayout.test.tsx` /
 * `mountContract.test.tsx`'s own notes): jsdom does not resolve CSS `var()`
 * references into a computed value, so `ShellLayout`'s
 * `padding: var(--pulse-chrome-top, 0px)` never resolves to a px number under
 * `getComputedStyle` in this harness. The AC1 inset-contract tests below
 * therefore assert on the PUBLISHED CSS custom-property values on
 * `document.documentElement` — the actual, observable mechanism
 * `ComplianceChrome` and `ShellLayout` communicate through, and the thing
 * that would regress if that publishing logic ever broke — rather than on
 * `ShellLayout`'s (unobservable-in-jsdom) computed padding.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOTTOM_BANNER_HEIGHT, ComplianceChrome, TOP_BANNER_HEIGHT } from './ComplianceChrome'
import { useChromeConfig } from '../chromeConfig'
import { SHELL_CHROME_BOTTOM_VAR, SHELL_CHROME_TOP_VAR } from '../mountContract'
import type { ChromeConfig } from '../mountContract'

vi.mock('../chromeConfig', () => ({
  useChromeConfig: vi.fn(),
}))

const mockUseChromeConfig = vi.mocked(useChromeConfig)

afterEach(() => {
  document.documentElement.style.removeProperty(SHELL_CHROME_TOP_VAR)
  document.documentElement.style.removeProperty(SHELL_CHROME_BOTTOM_VAR)
})

// Deliberately NOT the AC-canonical default copy/colors (chromeConfig.ts's
// DEFAULT_CHROME_CONFIG) - a component that ever hardcoded the default
// strings/colors instead of rendering strictly from config would still pass
// a test built around the default, so this fixture is a different exercise's
// config entirely (precedent 17: a real config test, not a tautology).
const NON_DEFAULT_CONFIG: ChromeConfig = {
  enabled: true,
  watermark: false,
  top: {
    text: 'ROLE-PLAY EXERCISE ONLY -- SECTOR 7 -- SIMULATED FEED',
    fg: '#101820',
    bg: '#f4a300',
  },
  bottom: {
    text: 'THIS IS A DRILL -- NO REAL-WORLD ACTION REQUIRED',
    fg: '#ffffff',
    bg: '#4b0082',
  },
}

const DISABLED_CONFIG: ChromeConfig = {
  enabled: false,
  watermark: false,
  top: { text: 'unused-while-disabled-top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'unused-while-disabled-bottom', fg: '#000000', bg: '#ffffff' },
}

describe('ComplianceChrome — config-driven banners (AC1/AC2)', () => {
  it('renders both banners with this config\'s text and colors, not any hardcoded string/color', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    render(<ComplianceChrome />)

    const top = screen.getByTestId('pulse-compliance-chrome-top')
    const bottom = screen.getByTestId('pulse-compliance-chrome-bottom')

    expect(top).toHaveTextContent(NON_DEFAULT_CONFIG.top.text)
    expect(bottom).toHaveTextContent(NON_DEFAULT_CONFIG.bottom.text)
    expect(top).toHaveStyle({
      color: NON_DEFAULT_CONFIG.top.fg,
      backgroundColor: NON_DEFAULT_CONFIG.top.bg,
    })
    expect(bottom).toHaveStyle({
      color: NON_DEFAULT_CONFIG.bottom.fg,
      backgroundColor: NON_DEFAULT_CONFIG.bottom.bg,
    })

    // Neither the AC-canonical default copy nor a leftover brand string
    // appears anywhere - if ComplianceChrome ever fell back to a hardcoded
    // string alongside/instead of the resolved config, this would catch it.
    expect(document.body.textContent).not.toContain('UNCLASSIFIED // EXERCISE')
    expect(document.body.textContent).not.toContain('PULSE TRAINING ENVIRONMENT')
  })

  it('reflects a second, differently-configured exercise on the next render (not a cached first render)', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)
    const { rerender } = render(<ComplianceChrome />)
    expect(screen.getByTestId('pulse-compliance-chrome-top'))
      .toHaveTextContent(NON_DEFAULT_CONFIG.top.text)

    const secondConfig: ChromeConfig = {
      enabled: true,
      watermark: false,
      top: { text: 'SECOND EXERCISE TOP BANNER', fg: '#00ff00', bg: '#000011' },
      bottom: { text: 'SECOND EXERCISE BOTTOM BANNER', fg: '#00ff00', bg: '#000011' },
    }
    mockUseChromeConfig.mockReturnValue(secondConfig)
    rerender(<ComplianceChrome />)

    expect(screen.getByTestId('pulse-compliance-chrome-top')).toHaveTextContent(secondConfig.top.text)
    expect(screen.queryByText(NON_DEFAULT_CONFIG.top.text)).not.toBeInTheDocument()
  })
})

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)

describe('ComplianceChrome — ShellLayout inset contract (AC1)', () => {
  it('publishes both chrome inset CSS vars as 22px on :root when chrome is enabled', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    render(<ComplianceChrome />)

    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe(BOTTOM_BANNER_HEIGHT)
  })

  it('removes both inset vars from :root on unmount, leaving no stale reserved gap', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)
    const { unmount } = render(<ComplianceChrome />)
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)

    unmount()

    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('')
  })
})

describe('ComplianceChrome — concurrent-mount inset safety (WR-001, preview COR-041)', () => {
  it('keeps the :root inset reserved when one of two live instances unmounts, clearing only when the last leaves', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    // Two shells publish the shared :root pair at once — the mount contract's
    // `preview` shell (COR-041, story 06) rendered inside the staff frame
    // while an outer participant shell is also live.
    const outer = render(<ComplianceChrome />)
    const preview = render(<ComplianceChrome />)

    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe(BOTTOM_BANNER_HEIGHT)

    // First unmount must NOT removeProperty the reserved inset out from under
    // the still-visible sibling shell — the exact WR-001 regression.
    preview.unmount()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe(BOTTOM_BANNER_HEIGHT)

    // Last instance out clears it — a lone shell still leaves no stale gap.
    outer.unmount()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('')
  })

  it('is StrictMode-safe: a mount→cleanup→mount cycle nets to published, then clears on unmount', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    // StrictMode double-invokes the layout effect on mount in dev
    // (acquire→release→acquire). A naive ref-count would strand the vars
    // cleared or the counter unbalanced; the count must net to exactly one.
    const { unmount } = render(
      <StrictMode>
        <ComplianceChrome />
      </StrictMode>,
    )
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe(TOP_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe(BOTTOM_BANNER_HEIGHT)

    unmount()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('')
  })
})

describe('ComplianceChrome — chrome-off is legal, no gap artifact (AC3)', () => {
  it('renders no banners and collapses both inset vars to 0px when chrome is disabled', () => {
    mockUseChromeConfig.mockReturnValue(DISABLED_CONFIG)

    render(<ComplianceChrome />)

    expect(screen.queryByTestId('pulse-compliance-chrome-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-compliance-chrome-bottom')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(rootVar(SHELL_CHROME_TOP_VAR)).toBe('0px')
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR)).toBe('0px')
  })
})

describe('ComplianceChrome — non-interactive assistive-tech context (AC5)', () => {
  it('announces each banner as role="note" with a descriptive label, never as interactive content', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    render(<ComplianceChrome />)

    const top = screen.getByRole('note', { name: /top/i })
    const bottom = screen.getByRole('note', { name: /bottom/i })

    expect(top).toHaveAttribute('aria-label')
    expect(bottom).toHaveAttribute('aria-label')

    for (const banner of [top, bottom]) {
      expect(banner.tagName).toBe('DIV')
      expect(banner).not.toHaveAttribute('tabindex')
      expect(banner.tabIndex).toBe(-1)
    }

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders exactly the configured static copy with no injected wall-clock/time text', () => {
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)

    render(<ComplianceChrome />)

    const top = screen.getByTestId('pulse-compliance-chrome-top')
    const bottom = screen.getByTestId('pulse-compliance-chrome-bottom')

    // Exact equality (not merely "contains") - if the component ever
    // appended a live clock string after the config text, this would fail.
    expect(top.textContent).toBe(NON_DEFAULT_CONFIG.top.text)
    expect(bottom.textContent).toBe(NON_DEFAULT_CONFIG.bottom.text)
  })
})

describe('ComplianceChrome — safe areas under viewport-fit=cover (WR-001, mobile-tablet)', () => {
  it('the banner heights grow by the safe-area insets, and the published vars match', () => {
    expect(BOTTOM_BANNER_HEIGHT).toBe('calc(22px + env(safe-area-inset-bottom, 0px))')
    expect(TOP_BANNER_HEIGHT).toBe('calc(22px + env(safe-area-inset-top, 0px))')
    mockUseChromeConfig.mockReturnValue(NON_DEFAULT_CONFIG)
    render(<ComplianceChrome />)
    expect(rootVar(SHELL_CHROME_BOTTOM_VAR))
      .toBe(BOTTOM_BANNER_HEIGHT)
    expect(rootVar(SHELL_CHROME_TOP_VAR))
      .toBe(TOP_BANNER_HEIGHT)
  })

  it('pads every banner side by its safe-area inset (source contract; jsdom drops env())', () => {
    const src = readFileSync(join(__dirname, 'ComplianceChrome.tsx'), 'utf8')
    expect(src).toContain('env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0')
    expect(src).toContain('0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)')
    expect(src).toContain('env(safe-area-inset-left, 0px)')
    expect(src).toContain("boxSizing: 'border-box'")
  })
})
