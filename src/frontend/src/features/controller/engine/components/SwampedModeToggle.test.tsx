/**
 * features/controller/engine/components/SwampedModeToggle.test.tsx
 * ---------------------------------------------------------------------------
 * Covers `<SwampedModeToggle>` (engine-review-cockpit/03; ADP-040, NFR-001,
 * COR-015):
 *  - a lead controller sees the enable/disable control and can toggle it;
 *  - the on-state banner renders TEXT + an icon (never colour alone) while
 *    swamped mode is on;
 *  - a non-lead controller never sees the enable control (absent, not
 *    disabled) — COR-015.
 *
 * `useSwampedMode` is mocked at the module boundary so each test drives the
 * component's rendering directly, mirroring `ReviewQueue.test.tsx`'s
 * hook-mock precedent.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSwampedMode, type UseSwampedModeResult } from '../hooks/useSwampedMode'
import { useEngineSettings } from '../hooks/useEngineSettings'
import { SwampedModeToggle } from './SwampedModeToggle'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

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

beforeEach(() => stubSettings(false))

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
    expect(note).toHaveTextContent('Timeout auto-send is off until the lead-controller role ships.')
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
})
