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
 * watermark tests control the resolved config directly without needing a
 * `QueryClientProvider` ancestor. The slot reads `config.enabled` itself (the
 * D7 chrome-off rule, NOT the media predicate `isWatermarkRequired`), so this
 * file needs no `QueryClientProvider` wrapper at all (matches `ComplianceChrome.test.tsx`'s
 * fully-mocked-seam setup).
 *
 * `useOverlayFocusTrap` is NOT mocked - the a11y tests below exercise the
 * real focus-trap wiring (its own unit coverage lives in
 * `useOverlayFocusTrap.test.tsx`).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverlayLayer } from './OverlayLayer'
import { useOverlayState } from './overlayState'
import { useChromeConfig } from '../../chromeConfig'
import { SHELL_Z } from '../../mountContract'
import { alertPauseBridge } from '../../alertPauseBridge'
import type { OverlayState } from './types'
import type { ChromeConfig } from '../../mountContract'

vi.mock('./overlayState', () => ({
  useOverlayState: vi.fn(),
}))

vi.mock('../../chromeConfig', () => ({
  useChromeConfig: vi.fn(),
}))

const mockUseOverlayState = vi.mocked(useOverlayState)
const mockUseChromeConfig = vi.mocked(useChromeConfig)

const CHROME_ENABLED: ChromeConfig = {
  enabled: true,
  watermark: false,
  top: { text: 'top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'bottom', fg: '#000000', bg: '#ffffff' },
}
const CHROME_DISABLED: ChromeConfig = {
  enabled: false,
  watermark: false,
  top: { text: 'top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'bottom', fg: '#000000', bg: '#ffffff' },
}

function overlayState(overrides: Partial<OverlayState>): OverlayState {
  return { state: 'none', register: 'in-fiction', message: '', ended: false, ...overrides }
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

afterEach(() => {
  act(() => alertPauseBridge.reset())
})

describe('OverlayLayer — pause leaves the alert bar visible; EndEx covers it (Tom, 10/16)', () => {
  const inset = 'calc(var(--pulse-chrome-top, 0px) + var(--pulse-alert-height, 0px))'

  it.each([
    ['in-fiction', 'pulse-overlay-pause-in-fiction'],
    ['out-of-fiction', 'pulse-overlay-pause-out-of-fiction'],
  ] as const)('pause / %s starts below the chrome and the alert bar', (register, testId) => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register }))
    render(<OverlayLayer />)
    const el = screen.getByTestId(testId)
    expect(el.style.top).toBe(inset)
    expect(el.style.paddingTop).toBe('24px')
  })

  it.each([
    ['in-fiction', 'pulse-overlay-endex-in-fiction'],
    ['out-of-fiction', 'pulse-overlay-endex-out-of-fiction'],
  ] as const)('endex / %s covers the alert bar (top 0)', (register, testId) => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register }))
    render(<OverlayLayer />)
    expect(screen.getByTestId(testId).style.top).toBe('0px')
  })

  it('break-fiction still covers the whole viewport', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'Stand by.' }))
    render(<OverlayLayer />)
    expect(screen.getByTestId('pulse-overlay-break-fiction').style.top).toBe('0px')
  })

  it('publishes pauseActive only while paused, and clears it on unmount', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))
    const { rerender, unmount } = render(<OverlayLayer />)
    expect(alertPauseBridge.getSnapshot().pauseActive).toBe(false)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))
    rerender(<OverlayLayer />)
    expect(alertPauseBridge.getSnapshot().pauseActive).toBe(true)
    unmount()
    expect(alertPauseBridge.getSnapshot().pauseActive).toBe(false)
  })

  it('renders a transparent aria-hidden shield over exactly the alert band, only while paused', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))
    const { rerender } = render(<OverlayLayer />)
    const shield = screen.getByTestId('pulse-overlay-pause-alert-shield')
    expect(shield).toHaveAttribute('aria-hidden', 'true')
    expect(shield.style.top).toBe('var(--pulse-chrome-top, 0px)')
    expect(shield.style.height).toBe('var(--pulse-alert-height, 0px)')
    expect(shield.style.zIndex).toBe(String(SHELL_Z.overlay))
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))
    rerender(<OverlayLayer />)
    expect(screen.queryByTestId('pulse-overlay-pause-alert-shield')).not.toBeInTheDocument()
  })

  it('marks EndEx and break-fiction as covering overlays for the alert bar', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))
    const { rerender } = render(<OverlayLayer />)
    expect(alertPauseBridge.getSnapshot())
      .toMatchObject({ overlayActive: true, pauseActive: false })
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))
    rerender(<OverlayLayer />)
    expect(alertPauseBridge.getSnapshot())
      .toMatchObject({ overlayActive: true, pauseActive: false })
  })

  it('announces mid-pause changes in fixed-politeness regions, not the alert present at open', () => {
    act(() => alertPauseBridge.setAlert('ADVISORY: Road closed.', 'advisory'))
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))
    render(<OverlayLayer />)
    const polite = screen.getByTestId('pulse-overlay-pause-alert-live')
    const assertive = screen.getByTestId('pulse-overlay-pause-alert-live-assertive')
    expect(polite).toHaveAttribute('role', 'status')
    expect(polite).toHaveAttribute('aria-live', 'polite')
    expect(assertive).toHaveAttribute('aria-live', 'assertive')
    expect(assertive).not.toHaveAttribute('role')
    expect(polite).toBeEmptyDOMElement()
    expect(assertive).toBeEmptyDOMElement()

    act(() => alertPauseBridge.setAlert('ADVISORY: Shelters open.', 'advisory'))
    expect(polite).toHaveTextContent('Alert changed. ADVISORY: Shelters open.')
    expect(assertive).toBeEmptyDOMElement()

    // advisory -> emergency lands in the assertive region; roles never flip.
    act(() => alertPauseBridge.setAlert('EMERGENCY: Evacuate now.', 'emergency'))
    expect(assertive).toHaveTextContent('Alert changed. EMERGENCY: Evacuate now.')
    expect(polite).toBeEmptyDOMElement()
    expect(polite).toHaveAttribute('aria-live', 'polite')
    expect(assertive).toHaveAttribute('aria-live', 'assertive')
  })

  it('announces "Alert cleared." politely when the alert clears mid-pause', () => {
    act(() => alertPauseBridge.setAlert('EMERGENCY: Evacuate now.', 'emergency'))
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))
    render(<OverlayLayer />)
    act(() => alertPauseBridge.setAlert('', null))
    expect(screen.getByTestId('pulse-overlay-pause-alert-live')).toHaveTextContent('Alert cleared.')
    expect(screen.getByTestId('pulse-overlay-pause-alert-live-assertive')).toBeEmptyDOMElement()
  })

  it('mirrors the active alert into the pause dialog description (and not into EndEx)', () => {
    act(() => alertPauseBridge.setAlert('EMERGENCY: Evacuate now.', 'emergency'))
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'out-of-fiction' }))
    const { rerender } = render(<OverlayLayer />)
    const dialog = screen.getByTestId('pulse-overlay-pause-out-of-fiction')
    expect(dialog).toHaveAccessibleDescription('Active alert. EMERGENCY: Evacuate now.')
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))
    rerender(<OverlayLayer />)
    expect(screen.queryByTestId('pulse-overlay-pause-alert-mirror')).not.toBeInTheDocument()
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
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(container).toHaveStyle({ backgroundColor: '#0d0d0d', color: '#ffb300' })
    expect(screen.getAllByTestId('pulse-overlay-break-fiction-hazard-bar')).toHaveLength(2)
  })

  it('has no dismiss control — no button or link anywhere in the broadcast', () => {
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    const container = screen.getByTestId('pulse-overlay-break-fiction')
    expect(within(container).queryByRole('button')).not.toBeInTheDocument()
    expect(within(container).queryByRole('link')).not.toBeInTheDocument()
  })

  it('ticks the wall-clock display forward once a second while broadcasting — never frozen', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2032-04-01T08:00:00Z'))
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))

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
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })

  it('is announced as role="alertdialog" with aria-modal, and receives focus on activation', () => {
    mockUseOverlayState.mockReturnValue(
      overlayState({ state: 'broadcast', message: 'x' }))

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

  it('does not render the watermark with chrome ON even when the MEDIA watermark switch is on (Gate-1 M-1)', () => {
    mockUseChromeConfig.mockReturnValue({ ...CHROME_ENABLED, watermark: true })
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })

  it('renders it with chrome OFF whatever the media watermark switch says', () => {
    mockUseChromeConfig.mockReturnValue({ ...CHROME_DISABLED, watermark: false })
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))

    render(<OverlayLayer />)

    expect(screen.getByTestId('pulse-overlay-watermark-slot')).toHaveTextContent('EXERCISE')
  })

  it('does not render the watermark on the out-of-fiction page even when chrome is disabled — it already names the exercise explicitly', () => {
    mockUseChromeConfig.mockReturnValue(CHROME_DISABLED)
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    expect(screen.queryByTestId('pulse-overlay-watermark-slot')).not.toBeInTheDocument()
  })
})

/**
 * HI-1 + M-A (demo-polish F2 re-review): the layer leaves any fullscreen when it becomes
 * active (a fullscreen element paints above the overlay), every root is a SHELL layer
 * (`data-shell-layer`, so the overlay's trap beats a channel modal), and a pause ->
 * break-fiction root swap re-engages the focus trap on the new root.
 */
describe('OverlayLayer — priority over the channel (F2)', () => {
  function mockFullscreen() {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })
    return exit
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'fullscreenElement')
    Reflect.deleteProperty(document, 'exitFullscreen')
  })

  it.each([
    ['pause', 'in-fiction', 'pulse-overlay-pause-in-fiction'],
    ['pause', 'out-of-fiction', 'pulse-overlay-pause-out-of-fiction'],
    ['endex', 'in-fiction', 'pulse-overlay-endex-in-fiction'],
    ['broadcast', 'in-fiction', 'pulse-overlay-break-fiction'],
  ] as const)('exits a channel fullscreen when the %s (%s) overlay becomes active', (state, register, testId) => {
    const exit = mockFullscreen()
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'none' }))
    const { rerender } = render(<OverlayLayer />)
    expect(exit).not.toHaveBeenCalled()

    mockUseOverlayState.mockReturnValue(overlayState({ state, register, message: 'm' }))
    rerender(<OverlayLayer />)

    expect(screen.getByTestId(testId)).toBeInTheDocument()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('re-takes focus once fullscreen is left (while fullscreen the page behind could keep it)', async () => {
    // Emulates the browser: leaving fullscreen leaves nothing focused (the overlay's own
    // focus() during fullscreen was refused), so without the re-take the page behind keeps focus.
    document.exitFullscreen = vi.fn(async () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'm' }))

    render(<OverlayLayer />)

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('pulse-overlay-break-fiction')))
  })

  it('does not touch fullscreen while no overlay is active', () => {
    const exit = mockFullscreen()
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'none' }))

    render(<OverlayLayer />)

    expect(exit).not.toHaveBeenCalled()
  })

  it.each([
    ['pause', 'in-fiction', 'pulse-overlay-pause-in-fiction'],
    ['pause', 'out-of-fiction', 'pulse-overlay-pause-out-of-fiction'],
    ['endex', 'out-of-fiction', 'pulse-overlay-endex-out-of-fiction'],
    ['broadcast', 'in-fiction', 'pulse-overlay-break-fiction'],
  ] as const)('marks the %s (%s) root as a shell layer', (state, register, testId) => {
    mockUseOverlayState.mockReturnValue(overlayState({ state, register, message: 'm' }))

    render(<OverlayLayer />)

    expect(screen.getByTestId(testId)).toHaveAttribute('data-shell-layer', 'overlay')
  })

  it('re-engages the focus trap on the NEW root when pause swaps to break-fiction', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'in-fiction' }))
    const { rerender } = render(<OverlayLayer />)
    expect(document.activeElement).toBe(screen.getByTestId('pulse-overlay-pause-in-fiction'))

    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'm' }))
    rerender(<OverlayLayer />)

    expect(document.activeElement).toBe(screen.getByTestId('pulse-overlay-break-fiction'))
  })
})

describe('OverlayLayer on phones (mobile-tablet story 03)', () => {
  it.each([
    ['pause', 'in-fiction', 'pulse-overlay-pause-in-fiction'],
    ['pause', 'out-of-fiction', 'pulse-overlay-pause-out-of-fiction'],
    ['endex', 'in-fiction', 'pulse-overlay-endex-in-fiction'],
    ['endex', 'out-of-fiction', 'pulse-overlay-endex-out-of-fiction'],
    ['broadcast', 'in-fiction', 'pulse-overlay-break-fiction'],
  ] as const)('%s (%s) carries its state with an icon as well as text', (state, register, testId) => {
    mockUseOverlayState.mockReturnValue(overlayState({ state, register, message: 'm' }))

    render(<OverlayLayer />)

    const icon = screen.getByTestId(testId).querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('insets the EndEx control page by the compliance chrome and scrolls its own overflow', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const style = screen.getByTestId('pulse-overlay-endex-out-of-fiction').style
    expect(style.top).toBe('0px')
    expect(style.paddingTop).toContain('--pulse-chrome-top')
    expect(style.paddingBottom).toContain('--pulse-chrome-bottom')
    expect(style.overflowY).toBe('auto')
  })

  it('the pause page clears chrome + alert bar via top, without double-counting the chrome inset', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'pause', register: 'out-of-fiction' }))

    render(<OverlayLayer />)

    const style = screen.getByTestId('pulse-overlay-pause-out-of-fiction').style
    expect(style.top).toContain('--pulse-chrome-top')
    expect(style.top).toContain('--pulse-alert-height')
    expect(style.paddingTop).toBe('24px')
    expect(style.paddingBottom).toContain('--pulse-chrome-bottom')
    expect(style.overflowY).toBe('auto')
  })

  it('the in-fiction EndEx page uses a neutral icon, not the flag; the flag is out-of-fiction only', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'in-fiction' }))
    const { unmount } = render(<OverlayLayer />)
    expect(screen.getByTestId('pulse-overlay-endex-in-fiction').querySelector('svg'))
      .toHaveAttribute('data-icon', 'circle-xmark')
    unmount()

    mockUseOverlayState.mockReturnValue(overlayState({ state: 'endex', register: 'out-of-fiction' }))
    render(<OverlayLayer />)
    expect(screen.getByTestId('pulse-overlay-endex-out-of-fiction').querySelector('svg'))
      .toHaveAttribute('data-icon', 'flag-checkered')
  })

  it('the break-fiction layer has no compliance-chrome inset (CTL-024 covers the chrome)', () => {
    mockUseOverlayState.mockReturnValue(overlayState({ state: 'broadcast', message: 'm' }))
    render(<OverlayLayer />)
    const style = screen.getByTestId('pulse-overlay-break-fiction').style
    expect(style.cssText).not.toContain('--pulse-chrome')
    expect(style.paddingTop).toBe('')
    expect(style.paddingBottom).toBe('')
  })
})
