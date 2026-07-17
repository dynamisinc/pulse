/**
 * features/participant-shell/components/OverlayLayer/OverlayLayer.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (overlay layer) — RTL coverage for `OverlayLayer.tsx`: the
 * z-order contract (COR-065), the break-fiction broadcast (CTL-024/D7-003:
 * hazard treatment, wall-clock, no dismiss control), pause/EndEx's in-fiction
 * vs out-of-fiction registers (CTL-023/D7-004, COR-054), the NFR-001
 * focus-trap/announced-modal contract, and the NFR-008 watermark-slot
 * fallback.
 *
 * `./overlayState`'s `useOverlayState` is mocked at the module boundary
 * (mirrors `ComplianceChrome.test.tsx` mocking `../chromeConfig`) so every
 * test controls exactly the resolved overlay state under test, independent
 * of that seam's own network/query behavior (covered separately in
 * `./overlayState.test.tsx` / `./overlayState.default.test.tsx`).
 *
 * `../../chromeConfig`'s `useChromeConfig` is mocked too, so the NFR-008
 * watermark tests control `isWatermarkRequired`'s input directly without
 * needing a `QueryClientProvider` ancestor. `isWatermarkRequired` itself is
 * re-implemented here as the same one-line pure predicate the real module
 * exports (`!config.enabled`) rather than imported, so this file needs no
 * `QueryClientProvider` wrapper at all (matches `ComplianceChrome.test.tsx`'s
 * fully-mocked-seam setup).
 *
 * `useOverlayFocusTrap` is NOT mocked - the a11y tests below exercise the
 * real focus-trap wiring (its own unit coverage lives in
 * `useOverlayFocusTrap.test.tsx`).
 */
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverlayLayer } from './OverlayLayer'
import { useOverlayState } from './overlayState'
import { useChromeConfig } from '../../chromeConfig'
import { SHELL_Z } from '../../mountContract'
import type { OverlayState } from './types'
import type { ChromeConfig } from '../../mountContract'

vi.mock('./overlayState', () => ({
  useOverlayState: vi.fn(),
}))

vi.mock('../../chromeConfig', () => ({
  useChromeConfig: vi.fn(),
  isWatermarkRequired: (config: { enabled: boolean }) => !config.enabled,
}))

const mockUseOverlayState = vi.mocked(useOverlayState)
const mockUseChromeConfig = vi.mocked(useChromeConfig)

const CHROME_ENABLED: ChromeConfig = {
  enabled: true,
  top: { text: 'top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'bottom', fg: '#000000', bg: '#ffffff' },
}
const CHROME_DISABLED: ChromeConfig = {
  enabled: false,
  top: { text: 'top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'bottom', fg: '#000000', bg: '#ffffff' },
}

function overlayState(overrides: Partial<OverlayState>): OverlayState {
  return { state: 'none', register: 'in-fiction', message: '', ...overrides }
}

beforeEach(() => {
  mockUseChromeConfig.mockReturnValue(CHROME_ENABLED)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OverlayLayer — no overlay (AC default)', () => {
  it('renders none of the four overlay pages when state is "none"', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'none' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-break-fiction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-overlay-pause-in-fiction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-overlay-pause-out-of-fiction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-overlay-endex-in-fiction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-overlay-endex-out-of-fiction')).not.toBeInTheDocument()
  })
})

describe('OverlayLayer — z-order (COR-065)', () => {
  it('renders break-fiction at SHELL_Z.breakFiction, above compliance chrome — covers everything', () => {
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'Test broadcast message' }),
    )

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(container.style.zIndex).toBe(String(SHELL_Z.breakFiction))
    expect(SHELL_Z.breakFiction).toBeGreaterThan(SHELL_Z.chrome)
  })

  it('renders pause at SHELL_Z.overlay — below chrome, above content/nav/alert bar', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-pause-in-fiction')
    expect(container.style.zIndex).toBe(String(SHELL_Z.overlay))
    expect(SHELL_Z.overlay).toBeLessThan(SHELL_Z.chrome)
    expect(SHELL_Z.overlay).toBeGreaterThan(SHELL_Z.alertBar)
  })

  it('renders EndEx at SHELL_Z.overlay — below chrome, above content/nav/alert bar', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-endex-out-of-fiction')
    expect(container.style.zIndex).toBe(String(SHELL_Z.overlay))
    expect(SHELL_Z.overlay).toBeLessThan(SHELL_Z.chrome)
    expect(SHELL_Z.overlay).toBeGreaterThan(SHELL_Z.alertBar)
  })
})

describe('OverlayLayer — break-fiction (CTL-024/D7-003)', () => {
  it('shows the exact AC header, the director-authored message, and the "remains until cleared" line', () => {
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'A dam has failed near Millbrook.' }),
    )

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(within(container).getByText('REAL-WORLD MESSAGE · EXERCISE CONTROL')).toBeInTheDocument()
    expect(within(container).getByText('A dam has failed near Millbrook.')).toBeInTheDocument()
    expect(container).toHaveTextContent(
      'This message remains in effect until cleared by exercise control.',
    )
  })

  it('renders whatever message is configured, not a hardcoded string', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'FIRST MESSAGE' }))
    const { rerender } = render(<OverlayLayer />)
    expect(screen.getByTestId('pulse-overlay-break-fiction')).toHaveTextContent('FIRST MESSAGE')

    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'SECOND MESSAGE' }))
    rerender(<OverlayLayer />)

    expect(screen.getByTestId('pulse-overlay-break-fiction')).toHaveTextContent('SECOND MESSAGE')
    expect(screen.queryByText('FIRST MESSAGE')).not.toBeInTheDocument()
  })

  it('ignores the register field — the same alien treatment regardless of in-fiction/out-of-fiction', () => {
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', register: 'in-fiction', message: 'Same message' }),
    )
    const { rerender } = render(<OverlayLayer />)
    const firstText = screen.getByTestId('pulse-overlay-break-fiction').textContent

    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', register: 'out-of-fiction', message: 'Same message' }),
    )
    rerender(<OverlayLayer />)
    const secondText = screen.getByTestId('pulse-overlay-break-fiction').textContent

    expect(secondText).toBe(firstText)
  })

  it('applies the black field / amber hazard treatment and renders both hazard-stripe bars', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(container).toHaveStyle({ backgroundColor: '#0d0d0d', color: '#ffb300' })
    expect(screen.getAllByTestId('pulse-overlay-break-fiction-hazard-bar')).toHaveLength(2)
  })

  it('has no dismiss control — no button or link anywhere in the broadcast', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(within(container).queryByRole('button')).not.toBeInTheDocument()
    expect(within(container).queryByRole('link')).not.toBeInTheDocument()
  })

  it('ticks the wall-clock display forward once a second while broadcasting — never frozen', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2032-04-01T08:00:00Z'))
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)
    const initialText = screen.getByTestId('pulse-overlay-break-fiction').textContent ?? ''
    expect(initialText).toContain('WALL CLOCK:')
    expect(initialText).toContain('2032')

    act(() => {
      vi.setSystemTime(new Date('2032-04-01T09:30:45Z'))
      vi.advanceTimersByTime(1000)
    })

    const laterText = screen.getByTestId('pulse-overlay-break-fiction').textContent ?? ''
    expect(laterText).not.toBe(initialText)
  })

  it('reserves no NFR-008 watermark slot — forbidden from carrying that signal even when chrome is off', () => {
    mockUseChromeConfig.mockReturnValue(CHROME_DISABLED)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })

  it('is announced as role="alertdialog" with aria-modal, and receives focus on activation', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(dialog).toHaveAttribute('data-testid', 'pulse-overlay-break-fiction')
    expect(document.activeElement).toBe(dialog)
  })
})

describe('OverlayLayer — pause (CTL-023/D7-004)', () => {
  it('in-fiction register: neutral "We\'ll be right back" maintenance page, zero exercise language', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-pause-in-fiction')
    expect(within(container).getByRole('heading', { name: "We'll be right back" })).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toContain('exercise')
    expect(container.textContent?.toLowerCase()).not.toContain('scenario')
    expect(container).toHaveStyle({ backgroundColor: '#f7f7f8' })
    expect(container.style.fontFamily).toContain('system-ui')
  })

  it('out-of-fiction register: slate/mono "EXERCISE PAUSED" control page with the scenario-clock-stopped line', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-pause-out-of-fiction')
    expect(within(container).getByRole('heading', { name: 'EXERCISE PAUSED' })).toBeInTheDocument()
    expect(container).toHaveTextContent(/scenario clock stopped/i)
    expect(container).toHaveStyle({ backgroundColor: '#1b232c' })
    expect(container.style.fontFamily).toMatch(/mono/i)
  })
})

describe('OverlayLayer — EndEx (COR-054)', () => {
  it('in-fiction register: "This service is no longer available", zero exercise language', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-endex-in-fiction')
    expect(
      within(container).getByRole('heading', { name: 'This service is no longer available' }),
    ).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toContain('exercise')
  })

  it('out-of-fiction register: "ENDEX" + hot-wash logistics', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-endex-out-of-fiction')
    expect(within(container).getByRole('heading', { name: 'ENDEX' })).toBeInTheDocument()
    expect(container).toHaveTextContent(/hot wash/i)
  })
})

describe('OverlayLayer — only break-fiction gets the alarm treatment', () => {
  it('pause/EndEx control pages never render a hazard bar or a dismiss control', () => {
    const cases: Array<{ state: 'pause' | 'endex'; register: 'in-fiction' | 'out-of-fiction'; testId: string }> = [
      { state: 'pause', register: 'in-fiction', testId: 'pulse-overlay-pause-in-fiction' },
      { state: 'pause', register: 'out-of-fiction', testId: 'pulse-overlay-pause-out-of-fiction' },
      { state: 'endex', register: 'in-fiction', testId: 'pulse-overlay-endex-in-fiction' },
      { state: 'endex', register: 'out-of-fiction', testId: 'pulse-overlay-endex-out-of-fiction' },
    ]

    for (const { state, register, testId } of cases) {
      mockUseOverlayState.mockReturnValue(overlayState({ state, register }))
      const { unmount } = render(<OverlayLayer />)

      expect(screen.queryByTestId('pulse-overlay-break-fiction-hazard-bar')).not.toBeInTheDocument()
      const container = screen.getByTestId(testId)
      expect(within(container).queryByRole('button')).not.toBeInTheDocument()
      expect(within(container).queryByRole('link')).not.toBeInTheDocument()

      unmount()
    }
  })
})

describe('OverlayLayer — accessibility (NFR-001): modal role + trapped focus', () => {
  it('pause is role="dialog" (not alertdialog) with aria-modal, and receives focus on activation', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    const dialog = screen.getByRole('dialog', { name: "We'll be right back" })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('EndEx is role="dialog" (not alertdialog) with aria-modal, and receives focus on activation', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const dialog = screen.getByRole('dialog', { name: 'ENDEX' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('OverlayLayer — NFR-008 watermark slot (in-fiction-only, chrome-off fallback)', () => {
  it('renders the EXERCISE watermark in the in-fiction pause page when chrome is disabled', () => {
    mockUseChromeConfig.mockReturnValue(CHROME_DISABLED)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    expect(screen.getByTestId('pulse-overlay-watermark-slot')).toHaveTextContent('EXERCISE')
  })

  it('does not render the watermark in the in-fiction page when chrome is enabled — the banners already carry the signal', () => {
    mockUseChromeConfig.mockReturnValue(CHROME_ENABLED)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })

  it('does not render the watermark on the out-of-fiction page even when chrome is disabled — it already names the exercise explicitly', () => {
    mockUseChromeConfig.mockReturnValue(CHROME_DISABLED)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })
})
