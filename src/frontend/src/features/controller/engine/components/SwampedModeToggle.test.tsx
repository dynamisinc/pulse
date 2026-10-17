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

const mockedUseSwampedMode = vi.mocked(useSwampedMode)

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
