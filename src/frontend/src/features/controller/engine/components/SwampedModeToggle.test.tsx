/**
 * features/controller/engine/components/SwampedModeToggle.test.tsx
 * ---------------------------------------------------------------------------
 * Covers `<SwampedModeToggle>` (engine-review-cockpit/03; ADP-040, NFR-001,
 * COR-015):
 *  - a lead controller sees the enable/disable control and can toggle it;
 *  - the on-state banner renders TEXT + an icon (never colour alone) while
 *    swamped mode is on;
 *  - a non-lead controller never sees the enable control (absent, not
 *    disabled) — COR-015;
 *  - story 17 (raise-only, Option A): while swamped mode is on, a non-lead controller gets an
 *    OFF-only control that asks for confirmation and pairs text with an icon; a planner (not a
 *    controller) sees no swamped-mode control at all.
 *
 * `useSwampedMode` is mocked at the module boundary so each test drives the
 * component's rendering directly, mirroring `ReviewQueue.test.tsx`'s
 * hook-mock precedent.
 */
import { render as renderPlain, screen, fireEvent, type RenderResult } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useSwampedMode, type UseSwampedModeResult } from '../hooks/useSwampedMode'
import { useEngineSettings } from '../hooks/useEngineSettings'
import { SwampedModeToggle } from './SwampedModeToggle'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
const access = vi.hoisted(() => ({ canControl: true }))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => access.canControl,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

vi.mock('../hooks/useSwampedMode', () => ({
  useSwampedMode: vi.fn(),
}))

vi.mock('../hooks/useEngineSettings', () => ({
  useEngineSettings: vi.fn(),
}))

const mockedUseSwampedMode = vi.mocked(useSwampedMode)
const mockedUseEngineSettings = vi.mocked(useEngineSettings)

/** Stubs only the fields the toggle reads (`providerCutToFake`, `timeoutAutoSendAuthorized`). */
function stubSettings(providerCutToFake: boolean, timeoutAutoSendAuthorized?: boolean): void {
  mockedUseEngineSettings.mockReturnValue({
    settings: { providerCutToFake, timeoutAutoSendAuthorized },
  } as unknown as ReturnType<typeof useEngineSettings>)
}

beforeEach(() => stubSettings(false, true))

beforeEach(() => {
  access.canControl = true
})

/** Renders inside the COBRA theme, as the console does (the OFF-only control is Cobra). */
function render(ui: React.ReactElement): RenderResult {
  return renderPlain(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

function stub(overrides: Partial<UseSwampedModeResult> = {}): UseSwampedModeResult {
  return {
    swampedMode: false,
    isLead: true,
    setSwampedMode: vi.fn(),
    pending: false,
    error: null,
    stale: false,
    lastConfirmedAt: null,
    ...overrides,
  }
}

describe('SwampedModeToggle — lead controller', () => {
  it('renders the enable control, off by default', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: true }))
    render(<SwampedModeToggle />)

    const toggle = screen.getByTestId('swamped-mode-enable-toggle')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('swamped-mode-active-banner')).not.toBeInTheDocument()
  })

  it('calls setSwampedMode(true) when clicked while off', () => {
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: true, setSwampedMode }))
    render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-enable-toggle'))
    expect(setSwampedMode).toHaveBeenCalledWith(true)
  })

  it('shows the persistent on-state banner with TEXT + an icon (NFR-001) when on', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: true }))
    render(<SwampedModeToggle />)

    const banner = screen.getByTestId('swamped-mode-active-banner')
    expect(banner).toHaveTextContent('TIMEOUT AUTO-SEND IS ACTIVE')
    expect(banner.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('swamped-mode-enable-toggle')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SwampedModeToggle — non-lead controller (COR-015 absent, not disabled)', () => {
  it('never renders the enable control', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: false }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-enable-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('swamped-mode-non-lead-note')).toBeInTheDocument()
  })

  it('still shows the on-state banner if the exercise\'s lead has enabled it', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-enable-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('swamped-mode-active-banner')).toHaveTextContent(
      'TIMEOUT AUTO-SEND IS ACTIVE',
    )
  })
})

describe('SwampedModeToggle — OFF-only control for a non-lead controller (story 17)', () => {
  it('shows "Turn swamped mode off" with an icon while swamped mode is on', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    render(<SwampedModeToggle />)

    const button = screen.getByTestId('swamped-mode-turn-off-button')
    expect(button).toHaveTextContent('Turn swamped mode off')
    expect(button.querySelector('svg')).not.toBeNull()
    // Raising stays impossible: no switch that could turn it on.
    expect(screen.queryByTestId('swamped-mode-enable-toggle')).not.toBeInTheDocument()
  })

  it('asks for confirmation first, and only then calls setSwampedMode(false)', () => {
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, setSwampedMode }))
    render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    expect(setSwampedMode).not.toHaveBeenCalled()
    expect(screen.getByTestId('swamped-mode-turn-off')).toHaveTextContent(
      'Turn swamped mode off? Expired timers will hold again',
    )

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-confirm'))
    expect(setSwampedMode).toHaveBeenCalledTimes(1)
    expect(setSwampedMode).toHaveBeenCalledWith(false)
  })

  it('Cancel changes nothing and returns to the single button', () => {
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, setSwampedMode }))
    render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-cancel'))

    expect(setSwampedMode).not.toHaveBeenCalled()
    expect(screen.getByTestId('swamped-mode-turn-off-button')).toBeInTheDocument()
    expect(screen.queryByTestId('swamped-mode-turn-off-confirm')).not.toBeInTheDocument()
  })

  it('WR-004: opening the confirm step focuses Confirm; the trigger says aria-expanded, not a popup', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    render(<SwampedModeToggle />)

    const trigger = screen.getByTestId('swamped-mode-turn-off-button')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-haspopup')
    fireEvent.click(trigger)
    expect(screen.getByTestId('swamped-mode-turn-off-confirm')).toHaveFocus()
  })

  it('WR-004: Cancel returns focus to the trigger', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-cancel'))
    expect(screen.getByTestId('swamped-mode-turn-off-button')).toHaveFocus()
  })

  it('WR-004: Confirm that turns it off lands focus on the note, not on <body>', () => {
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, setSwampedMode }))
    const view = render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-confirm'))
    // Still on (the server has not answered): focus is back on the trigger.
    expect(screen.getByTestId('swamped-mode-turn-off-button')).toHaveFocus()

    mockedUseSwampedMode.mockReturnValue(
      stub({ swampedMode: false, isLead: false, setSwampedMode }),
    )
    view.rerender(
      <ThemeProvider theme={cobraTheme}>
        <SwampedModeToggle />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('swamped-mode-non-lead-note')).toHaveFocus()
  })

  it('SG-005: the lead-only note is for controllers; a planner does not see it', () => {
    access.canControl = false
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: false }))
    render(<SwampedModeToggle />)
    expect(screen.queryByTestId('swamped-mode-non-lead-note')).not.toBeInTheDocument()
  })

  it('is absent while swamped mode is off (nothing to lower)', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: false }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-turn-off')).not.toBeInTheDocument()
  })

  it('the lead does not get the OFF-only control: it has the full switch', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: true }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-turn-off')).not.toBeInTheDocument()
    expect(screen.getByTestId('swamped-mode-enable-toggle')).toBeInTheDocument()
  })

  it('a planner (not a controller) sees neither the switch nor the OFF-only control', () => {
    access.canControl = false
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-enable-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('swamped-mode-turn-off')).not.toBeInTheDocument()
    // The persistent on-state banner stays for everyone who can see the console.
    expect(screen.getByTestId('swamped-mode-active-banner')).toBeInTheDocument()
  })
})

describe('SwampedModeToggle — hold-on-cut qualifier (ADP-042)', () => {
  it('says auto-send is SUSPENDED (text, not colour) while cut to Fake', () => {
    stubSettings(true)
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true }))
    render(<SwampedModeToggle />)

    const banner = screen.getByTestId('swamped-mode-active-banner')
    expect(banner).toHaveTextContent(/SUSPENDED while generation is cut to Fake/)
    expect(banner).toHaveTextContent('TIMEOUT AUTO-SEND IS SUSPENDED')
    expect(banner).not.toHaveTextContent('TIMEOUT AUTO-SEND IS ACTIVE')
    expect(banner).not.toHaveTextContent(/publish instead of holding/)
  })
})

describe('SwampedModeToggle — Phase 1: timeout auto-send not authorized (PROVIDER-GOVERNANCE §8)', () => {
  it('disables the ON control and describes it with a text + icon note', () => {
    stubSettings(false, false)
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: true, setSwampedMode }))
    render(<SwampedModeToggle />)

    const toggle = screen.getByTestId('swamped-mode-enable-toggle')
    expect(toggle).toBeDisabled()
    const note = screen.getByTestId('swamped-mode-not-authorized-note')
    expect(note).toHaveTextContent('Timeout auto-send is not authorized on this environment.')
    expect(note.querySelector('svg')).not.toBeNull()
    expect(toggle).toHaveAttribute('aria-describedby', note.id)

    fireEvent.click(toggle)
    expect(setSwampedMode).not.toHaveBeenCalled()
  })

  it('never blocks turning an already-on switch OFF', () => {
    stubSettings(false, false)
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: true, setSwampedMode }))
    render(<SwampedModeToggle />)

    const toggle = screen.getByTestId('swamped-mode-enable-toggle')
    expect(toggle).toBeEnabled()
    expect(screen.queryByTestId('swamped-mode-not-authorized-note')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(setSwampedMode).toHaveBeenCalledWith(false)
  })

  it('keeps the control enabled when the flag is true or absent', () => {
    for (const authorized of [true, undefined]) {
      stubSettings(false, authorized)
      mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: true }))
      const { unmount } = render(<SwampedModeToggle />)
      expect(screen.getByTestId('swamped-mode-enable-toggle')).toBeEnabled()
      expect(screen.queryByTestId('swamped-mode-not-authorized-note')).not.toBeInTheDocument()
      unmount()
    }
  })
  it('requires BOTH gates to turn ON: a non-lead sees no switch and no governance note, only the lead note', () => {
    stubSettings(false, false)
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: false }))
    render(<SwampedModeToggle />)

    expect(screen.queryByTestId('swamped-mode-enable-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('swamped-mode-not-authorized-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('swamped-mode-non-lead-note')).toHaveTextContent(
      'Only the lead controller can enable swamped mode.',
    )
  })

  it('a lead with timeoutAutoSendAuthorized === false cannot turn ON and sees the governance note', () => {
    stubSettings(false, false)
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: false, isLead: true, setSwampedMode }))
    render(<SwampedModeToggle />)

    const toggle = screen.getByTestId('swamped-mode-enable-toggle')
    expect(toggle).toBeDisabled()
    const note = screen.getByTestId('swamped-mode-not-authorized-note')
    expect(note).toHaveTextContent('Timeout auto-send is not authorized')
    expect(note.querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('swamped-mode-non-lead-note')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(setSwampedMode).not.toHaveBeenCalled()
  })

  it('a non-lead can still lower while the flag is false (OFF is never refused)', () => {
    stubSettings(false, false)
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, setSwampedMode }))
    render(<SwampedModeToggle />)

    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-confirm'))
    expect(setSwampedMode).toHaveBeenCalledWith(false)
  })
})

describe('SwampedModeToggle — server-driven pending + refusal', () => {
  it('marks the switch unavailable while a request is pending, without native disabled (keeps focus, WR-101)', () => {
    const setSwampedMode = vi.fn()
    mockedUseSwampedMode.mockReturnValue(stub({ pending: true, setSwampedMode }))
    render(<SwampedModeToggle />)

    const toggle = screen.getByTestId('swamped-mode-enable-toggle')
    toggle.focus()
    expect(toggle).not.toBeDisabled()
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(toggle).toHaveAttribute('aria-busy', 'true')
    expect(toggle).toHaveFocus()
    fireEvent.click(toggle)
    expect(setSwampedMode).not.toHaveBeenCalled()
  })

  it('shows a refusal inline as text + icon in a status region', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ error: 'Timeout auto-send is not authorized.' }))
    render(<SwampedModeToggle />)

    const err = screen.getByTestId('swamped-mode-error')
    expect(err).toHaveAttribute('role', 'status')
    expect(err).toHaveTextContent('Timeout auto-send is not authorized.')
    expect(err.querySelector('svg')).not.toBeNull()
  })

  it('keeps an always-mounted, empty status region when there is no error', () => {
    mockedUseSwampedMode.mockReturnValue(stub())
    render(<SwampedModeToggle />)
    const region = screen.getByTestId('swamped-mode-error')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toBeEmptyDOMElement()
    expect(screen.getByTestId('swamped-mode-enable-toggle')).not.toHaveAttribute('aria-describedby')
  })

  it('ties the switch to the status region while it holds an error', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ error: 'Only the lead controller can turn swamped mode on.' }))
    render(<SwampedModeToggle />)
    expect(screen.getByTestId('swamped-mode-enable-toggle')).toHaveAttribute(
      'aria-describedby',
      'swamped-mode-status',
    )
  })

  it('does not claim ACTIVE when swamped is on but auto-send is not authorized (text + icon)', () => {
    stubSettings(false, false)
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true }))
    render(<SwampedModeToggle />)
    const banner = screen.getByTestId('swamped-mode-active-banner')
    expect(banner).toHaveTextContent('TIMEOUT AUTO-SEND IS NOT AUTHORIZED')
    expect(banner).not.toHaveTextContent('TIMEOUT AUTO-SEND IS ACTIVE')
    expect(banner.querySelector('svg')).not.toBeNull()
  })

  it('keeps the OFF confirm open while the request is pending (not closed as if done)', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false }))
    const { rerender } = render(<SwampedModeToggle />)
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    // Click confirm while still "not pending" would close at once; model a queued change:
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, pending: true }))
    rerender(
      <ThemeProvider theme={cobraTheme}>
        <SwampedModeToggle />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('swamped-mode-turn-off-confirm')).toBeDisabled()
    expect(screen.queryByTestId('swamped-mode-turn-off-button')).not.toBeInTheDocument()
  })

  it('disables the non-lead OFF confirm while pending', () => {
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true, isLead: false, pending: true }))
    render(<SwampedModeToggle />)
    fireEvent.click(screen.getByTestId('swamped-mode-turn-off-button'))
    expect(screen.getByTestId('swamped-mode-turn-off-confirm')).toBeDisabled()
  })
})

describe('SwampedModeToggle — banner follows the inputs expiries really use (S2)', () => {
  /** Full-enough settings for the banner: authorized, and the autonomy fields it reads. */
  function stubBanner(
    over: {
      providerCutToFake?: boolean
      timeoutAutoSendAuthorized?: boolean
      autonomy?: { generationStopped?: boolean; safetyClampActive?: boolean; degradedReason?: string | null }
    },
  ): void {
    mockedUseEngineSettings.mockReturnValue({
      settings: {
        providerCutToFake: false,
        timeoutAutoSendAuthorized: true,
        ...over,
        autonomy: { generationStopped: false, safetyClampActive: false, degradedReason: null, ...over.autonomy },
      },
    } as unknown as ReturnType<typeof useEngineSettings>)
  }

  const cases: ReadonlyArray<[string, Parameters<typeof stubBanner>[0], string, RegExp]> = [
    ['healthy', {}, 'TIMEOUT AUTO-SEND IS ACTIVE', /publish instead of holding/],
    ['cut to Fake', { providerCutToFake: true }, 'TIMEOUT AUTO-SEND IS SUSPENDED', /cut to Fake/],
    [
      'kill switch full stop',
      { autonomy: { generationStopped: true } },
      'TIMEOUT AUTO-SEND IS SUSPENDED',
      /fully stopped/,
    ],
    [
      'kill switch suggest-only clamp',
      { autonomy: { safetyClampActive: true } },
      'TIMEOUT AUTO-SEND IS SUSPENDED',
      /clamped to suggest-only/,
    ],
    [
      'degraded mode',
      { autonomy: { safetyClampActive: true, degradedReason: 'provider unavailable' } },
      'TIMEOUT AUTO-SEND IS SUSPENDED',
      /degraded mode/,
    ],
    [
      'not authorized',
      { timeoutAutoSendAuthorized: false },
      'TIMEOUT AUTO-SEND IS NOT AUTHORIZED',
      /not authorized timeout auto-send/,
    ],
  ]

  it.each(cases)('%s -> %s (text + icon)', (_name, over, title, detail) => {
    stubBanner(over)
    mockedUseSwampedMode.mockReturnValue(stub({ swampedMode: true }))
    render(<SwampedModeToggle />)

    const banner = screen.getByTestId('swamped-mode-active-banner')
    expect(banner).toHaveTextContent(title)
    expect(banner).toHaveTextContent(detail)
    expect(banner.querySelector('svg')).not.toBeNull()
    if (title !== 'TIMEOUT AUTO-SEND IS ACTIVE') {
      expect(banner).not.toHaveTextContent('TIMEOUT AUTO-SEND IS ACTIVE')
    }
  })
})

describe('SwampedModeToggle — stale console note (W3)', () => {
  it('shows text + icon with the last confirmed time inside the status region when stale', () => {
    mockedUseSwampedMode.mockReturnValue(
      stub({ stale: true, lastConfirmedAt: new Date(2033, 8, 4, 9, 7).getTime() }),
    )
    render(<SwampedModeToggle />)

    const note = screen.getByTestId('swamped-mode-stale-note')
    expect(note).toHaveTextContent('Swamped state could not be refreshed. Last confirmed 09:07')
    const region = screen.getByTestId('swamped-mode-error')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toContainElement(note)
    expect(region.querySelector('svg')).not.toBeNull()
  })

  it('shows no note when fresh', () => {
    mockedUseSwampedMode.mockReturnValue(stub())
    render(<SwampedModeToggle />)
    expect(screen.queryByTestId('swamped-mode-stale-note')).not.toBeInTheDocument()
  })
})
