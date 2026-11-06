/**
 * features/participant-shell/ShellLayout.kiosk.test.tsx
 * ---------------------------------------------------------------------------
 * channels-foundation 22 (PP-2, #788): the shell's `kiosk` variant. Kept in its
 * own file so `ShellLayout.test.tsx` (the standard variants) runs unchanged (AC4).
 *
 *  - AC1 chrome stripped: compliance banners, channel nav and the sign-out row are
 *    absent from the DOM (so from the a11y tree too), and the content region grows.
 *  - AC2 alert bar kept: same severity styling and live-region attributes as `full`.
 *  - AC3 watermark clause: the EXERCISE chip is drawn whenever the banners are not.
 *  - AC5 isolation: kiosk adds no request (the same GETs as `full`).
 *  - AC6 a11y: axe reports no serious/critical violations.
 *
 * The variant is driven two ways, both through the flag alone: shell state resolving
 * `kiosk`, and a mounted channel calling `useRequestShellKiosk(true)` (how portal 18's
 * `KioskGate`, mounted inside the channel router, asks for it).
 *
 * `useShellState` and `useAlerts` are mocked at their module boundary (the variant and
 * the active alert are the inputs under test); everything else is the real shell.
 */
import { useState, type ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { api } from '@/core/services/api'
import { ShellLayout } from './ShellLayout'
import {
  SHELL_CHROME_BOTTOM_VAR,
  SHELL_CHROME_TOP_VAR,
  useRequestShellKiosk,
  useShellContext,
  type ShellVariant,
} from './mountContract'
import { useShellState } from './shellState'
import { useAlerts } from './components/AlertBar/useAlerts'
import type { Alert } from './components/AlertBar/alertTypes'

vi.mock('./shellState', () => ({ useShellState: vi.fn() }))
vi.mock('./components/AlertBar/useAlerts', () => ({ useAlerts: vi.fn() }))

const mockUseShellState = vi.mocked(useShellState)
const mockUseAlerts = vi.mocked(useAlerts)

const ACTIVE_ALERT: Alert = {
  id: 'alert-kiosk-1',
  severity: 'advisory',
  message: 'Flood warning for the river district.',
  scenarioTime: '2026-07-16T14:00:00.000Z',
}

function setVariant(variant: ShellVariant): void {
  mockUseShellState.mockReturnValue({ variant, pending: false })
}

function renderShell(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <ShellLayout>{children}</ShellLayout>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function VariantProbe() {
  const { variant } = useShellContext()
  return <span data-testid="probe">{variant}</span>
}

/** A channel that asks its shell for the kiosk variant (portal 18's `KioskGate` shape). */
function KioskRequestingChannel() {
  useRequestShellKiosk(true)
  return <VariantProbe />
}

/** Lets a test drop the kiosk request without re-rendering the shell. */
function DroppableKioskRequest() {
  const [active, setActive] = useState(true)
  return (
    <>
      {active && <KioskRequestingChannel />}
      {!active && <VariantProbe />}
      <button type="button" onClick={() => setActive(false)}>leave kiosk</button>
    </>
  )
}

function expectChromeStripped() {
  expect(screen.queryByTestId('pulse-compliance-chrome-top')).not.toBeInTheDocument()
  expect(screen.queryByTestId('pulse-compliance-chrome-bottom')).not.toBeInTheDocument()
  expect(screen.queryByTestId('pulse-channel-nav-strip')).not.toBeInTheDocument()
  expect(screen.queryByTestId('pulse-channel-nav-tabs')).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Channel navigation' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
}

beforeEach(() => {
  mockUseShellState.mockReset()
  mockUseAlerts.mockReset()
  mockUseAlerts.mockReturnValue([])
  setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:05:00.000Z') })
})

afterEach(() => {
  resetExerciseClock()
  document.documentElement.style.removeProperty(SHELL_CHROME_TOP_VAR)
  document.documentElement.style.removeProperty(SHELL_CHROME_BOTTOM_VAR)
})

describe('ShellLayout kiosk — chrome stripped (AC1)', () => {
  it('removes the compliance banners, channel nav and sign-out row from the DOM when shell state is kiosk', async () => {
    setVariant('kiosk')
    renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kiosk'))

    expectChromeStripped()
    expect(screen.getByTestId('pulse-shell-root')).toHaveAttribute('data-shell-variant', 'kiosk')
  })

  it('lets the content region grow to fill the viewport below the alert bar', async () => {
    setVariant('kiosk')
    renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const root = screen.getByTestId('pulse-shell-root')
    expect(root.style.display).toBe('flex')
    expect(root.style.flexDirection).toBe('column')
    expect(root.style.minHeight).toBe('100vh')
    expect(screen.getByTestId('pulse-shell-content-region').style.flex).toBe('1 0 auto')
    // With no chrome mounted nothing publishes the inset var; the 0px fallback applies.
    expect(document.documentElement.style.getPropertyValue(SHELL_CHROME_TOP_VAR)).toBe('')
  })

  it('strips the chrome when a mounted channel requests kiosk, and the channel sees variant kiosk', async () => {
    setVariant('readOnly')
    renderShell(<KioskRequestingChannel />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kiosk'))

    expectChromeStripped()
  })

  it('clears the chrome inset vars when a mounted shell enters kiosk', async () => {
    // The request path mounts ComplianceChrome for one commit (variant full), which
    // publishes the inset vars; entering kiosk unmounts it and must leave no gap.
    setVariant('full')
    renderShell(<KioskRequestingChannel />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kiosk'))

    expect(document.documentElement.style.getPropertyValue(SHELL_CHROME_TOP_VAR)).toBe('')
    expect(document.documentElement.style.getPropertyValue(SHELL_CHROME_BOTTOM_VAR)).toBe('')
  })

  it('restores the standard chrome when the kiosk request is released', async () => {
    const user = userEvent.setup()
    setVariant('full')
    renderShell(<DroppableKioskRequest />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kiosk'))
    expectChromeStripped()

    await user.click(screen.getByRole('button', { name: 'leave kiosk' }))

    expect(screen.getByTestId('probe')).toHaveTextContent('full')
    expect(screen.getByTestId('pulse-compliance-chrome-top')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByTestId('pulse-shell-kiosk-exercise-chip')).not.toBeInTheDocument()
  })

  it('keeps the standard chrome and no kiosk chip in every non-kiosk variant', async () => {
    for (const variant of ['full', 'readOnly', 'preview'] as const) {
      setVariant(variant)
      const view = renderShell(<VariantProbe />)
      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(variant))

      expect(screen.getByTestId('pulse-compliance-chrome-top')).toBeInTheDocument()
      expect(screen.getByTestId('pulse-compliance-chrome-bottom')).toBeInTheDocument()
      expect(screen.queryByTestId('pulse-shell-kiosk-exercise-chip')).not.toBeInTheDocument()
      expect(screen.getByTestId('pulse-shell-root').style.display).toBe('')
      view.unmount()
    }
  })
})

describe('ShellLayout kiosk — alert bar kept (AC2, PRT-010)', () => {
  /** The bar's a11y-relevant shape, to compare kiosk against the standard variant. */
  function alertBarShape() {
    const bar = screen.getByTestId('pulse-alert-bar')
    // Story 11 moved the live region off the host onto an inner node, so rotation is not re-read.
    const live = screen.getByTestId('pulse-alert-bar-live')
    return {
      role: live.getAttribute('role'),
      ariaLive: live.getAttribute('aria-live'),
      ariaAtomic: live.getAttribute('aria-atomic'),
      severity: bar.getAttribute('data-alert-severity'),
      treatment: bar.getAttribute('data-alert-treatment'),
      text: bar.textContent,
    }
  }

  it('renders the active alert with the same severity styling and live region as the full variant', async () => {
    mockUseAlerts.mockReturnValue([ACTIVE_ALERT])

    setVariant('full')
    const full = renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('full'))
    const fullShape = alertBarShape()
    full.unmount()

    setVariant('kiosk')
    renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kiosk'))
    const kioskShape = alertBarShape()

    expect(kioskShape).toEqual(fullShape)
    expect(kioskShape.role).toBe('status')
    expect(kioskShape.severity).toBe('advisory')
    // Never color-only: the severity is carried in text too.
    expect(within(screen.getByTestId('pulse-alert-bar')).getByText('ADVISORY')).toBeInTheDocument()
    expect(screen.getByText(ACTIVE_ALERT.message)).toBeInTheDocument()
  })
})

describe('ShellLayout kiosk — watermark clause (AC3, NFR-008, Q-33)', () => {
  it('always draws the EXERCISE chip in kiosk, as text, announced as a note', async () => {
    setVariant('kiosk')
    renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    const chip = screen.getByRole('note', { name: 'Exercise watermark' })
    expect(chip).toHaveTextContent('EXERCISE')
    expect(chip.style.position).toBe('fixed')
    expect(chip.style.pointerEvents).toBe('none')
    // The fixed AA pair (about 18:1); skins cannot reach an inline style outside their scope.
    expect(chip.style.color).toBe('rgb(255, 255, 255)')
    expect(chip.style.background).toBe('rgb(17, 20, 24)')
  })

  // The full variant x config proof is the pure truth table in chromeConfig.test.tsx; this
  // is its rendered counterpart over the shipped (chrome-on) config: whichever variant,
  // the shell draws the banners or the chip.
  it('never renders with both the banners and the chip off, in any variant', async () => {
    for (const variant of ['full', 'readOnly', 'kiosk', 'preview'] as const) {
      setVariant(variant)
      const view = renderShell(<VariantProbe />)
      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(variant))

      const bannersOn = screen.queryByTestId('pulse-compliance-chrome-top') !== null
      const chipOn = screen.queryByTestId('pulse-shell-kiosk-exercise-chip') !== null
      expect(bannersOn || chipOn).toBe(true)
      view.unmount()
    }
  })
})

describe('ShellLayout kiosk — isolation untouched (AC5, XC-001)', () => {
  it('issues exactly the same requests as the full variant (no new query or endpoint)', async () => {
    const getSpy = vi.spyOn(api, 'get')
    const urls = async (variant: ShellVariant) => {
      getSpy.mockClear()
      setVariant(variant)
      const view = renderShell(<VariantProbe />)
      await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(variant))
      // Let every mounted query fire.
      await waitFor(() => expect(getSpy).toHaveBeenCalled())
      const seen = new Set(getSpy.mock.calls.map(call => call[0]))
      view.unmount()
      return seen
    }

    const fullUrls = await urls('full')
    const kioskUrls = await urls('kiosk')

    // Kiosk mounts fewer layers, so it can only ever drop a request, never add one. It
    // still reads its exercise's data (the exercise scope at least), so it is not empty.
    expect(kioskUrls.size).toBeGreaterThan(0)
    for (const url of kioskUrls) expect(fullUrls).toContain(url)
    getSpy.mockRestore()
  })

  it('adds no storage key', async () => {
    localStorage.clear()
    sessionStorage.clear()
    setVariant('kiosk')
    renderShell(<VariantProbe />)
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument())

    expect(Object.keys(localStorage)).toEqual([])
    expect(Object.keys(sessionStorage)).toEqual([])
  })
})

describe('ShellLayout kiosk — accessibility (AC6, NFR-001)', () => {
  it('has no serious or critical axe violations with an active alert', async () => {
    mockUseAlerts.mockReturnValue([ACTIVE_ALERT])
    setVariant('kiosk')
    const { container } = renderShell(<main><h1>Front page</h1></main>)
    await waitFor(() => expect(screen.getByText('Front page')).toBeInTheDocument())

    // color-contrast is off: jsdom does no painting (the chip's pair is pinned above).
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    const serious = results.violations
      .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
      .map(violation => `${violation.id}: ${violation.help}`)
    expect(serious).toEqual([])
  })

  it('leaves no focusable shell control on a quiet kiosk screen (no active alert)', async () => {
    setVariant('kiosk')
    const { container } = renderShell(<p>content</p>)
    await waitFor(() => expect(screen.getByText('content')).toBeInTheDocument())

    const shellRoot = within(container).getByTestId('pulse-shell-root')
    const focusable = shellRoot.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    expect(focusable).toHaveLength(0)
  })

  it('with an active alert, the only focusable shell controls are the unchanged alert bar\'s', async () => {
    // AC2 keeps the bar exactly as in every variant, so its own Details link / "+N more"
    // stay. Hiding or neutering them on a display is portal 18's frame concern, not the
    // shell's; what kiosk guarantees is that no nav or sign-out control is left.
    mockUseAlerts.mockReturnValue([ACTIVE_ALERT])
    setVariant('kiosk')
    const { container } = renderShell(<p>content</p>)
    await waitFor(() => expect(screen.getByText('content')).toBeInTheDocument())

    expectChromeStripped()
    const bar = screen.getByTestId('pulse-alert-bar')
    const focusable = within(container).getByTestId('pulse-shell-root').querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    expect(focusable.length).toBeGreaterThan(0)
    for (const element of focusable) expect(bar.contains(element)).toBe(true)
  })
})
