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
import { describe, expect, it, vi } from 'vitest'
import { useSwampedMode, type UseSwampedModeResult } from '../hooks/useSwampedMode'
import { SwampedModeToggle } from './SwampedModeToggle'

vi.mock('../hooks/useSwampedMode', () => ({
  useSwampedMode: vi.fn(),
}))

const mockedUseSwampedMode = vi.mocked(useSwampedMode)

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
