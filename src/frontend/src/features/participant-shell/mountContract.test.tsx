/**
 * features/participant-shell/mountContract.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (channel-mount contract) — pure-contract coverage for
 * `mountContract.ts`: the fail-closed `useShellContext()` hook, the
 * `ShellContextProvider` prop-passing wiring, the `SHELL_Z` z-order scale
 * (AC3), and the absence of any exercise/admin/picker concept on this
 * module's surface (AC4, WAVE0-REVIEW precedent 20).
 *
 * `ShellLayout.test.tsx` covers the integration-level mount (real clock, real
 * exercise scope, and the DOM reset/stacking boundary); this file is the
 * narrower, faster unit layer around the context module itself, mirroring
 * `core/exerciseContext/exerciseContext.test.tsx`'s own structure.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  SHELL_Z,
  ShellContextProvider,
  useShellContext,
  type ShellMountProps,
} from './mountContract'
import * as MountContractModule from './mountContract'

/** Renders whatever mount props the current provider exposes, for assertion. */
function MountPropsProbe() {
  const props = useShellContext()
  return (
    <div data-testid="probe">
      <span data-testid="variant">{props.variant}</span>
      <span data-testid="scenarioNow">{props.scenarioNow.toISOString()}</span>
    </div>
  )
}

describe('useShellContext outside a provider', () => {
  it('throws rather than returning a default variant/scenarioNow a channel could render against', () => {
    // React logs a caught render error to console.error; expected here since
    // there is no error boundary in the test - suppress the noise.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<MountPropsProbe />)).toThrow(/ShellContextProvider/)

    consoleSpy.mockRestore()
  })
})

describe('ShellContextProvider', () => {
  it('hands a mounted channel exactly the {variant, scenarioNow} it was bound with', () => {
    const mountProps: ShellMountProps = {
      variant: 'readOnly',
      scenarioNow: new Date('2026-03-01T12:00:00Z'),
    }

    render(
      <ShellContextProvider value={mountProps}>
        <MountPropsProbe />
      </ShellContextProvider>,
    )

    expect(screen.getByTestId('variant')).toHaveTextContent('readOnly')
    expect(screen.getByTestId('scenarioNow')).toHaveTextContent('2026-03-01T12:00:00.000Z')
  })

  it('rebinds to a different provider value for a differently-mounted subtree (not a hardcoded pass-through)', () => {
    const mountProps: ShellMountProps = {
      variant: 'kiosk',
      scenarioNow: new Date('2031-09-09T09:09:00Z'),
    }

    render(
      <ShellContextProvider value={mountProps}>
        <MountPropsProbe />
      </ShellContextProvider>,
    )

    expect(screen.getByTestId('variant')).toHaveTextContent('kiosk')
    expect(screen.getByTestId('scenarioNow')).toHaveTextContent('2031-09-09T09:09:00.000Z')
  })
})

describe('SHELL_Z (AC3 z-order contract)', () => {
  it('orders content below channelNav, alertBar, overlay, chrome, and breakFiction', () => {
    expect(SHELL_Z.content).toBeLessThan(SHELL_Z.channelNav)
    expect(SHELL_Z.channelNav).toBeLessThan(SHELL_Z.alertBar)
    expect(SHELL_Z.alertBar).toBeLessThan(SHELL_Z.overlay)
    expect(SHELL_Z.overlay).toBeLessThan(SHELL_Z.chrome)
    expect(SHELL_Z.chrome).toBeLessThan(SHELL_Z.breakFiction)
  })

  it('mounts a channel at the lowest layer (content), strictly below the overlay layer', () => {
    expect(SHELL_Z.content).toBeLessThan(SHELL_Z.overlay)
  })
})

describe('module surface (AC4, WAVE0-REVIEW precedent 20)', () => {
  // Asserts the ABSENCE of forbidden surface rather than exact export
  // equality, so this only fails for the reason that matters: an
  // exercise/admin/picker concept leaking into the channel-mount contract
  // (a channel only ever receives {variant, scenarioNow} - never an
  // exerciseId, an exercise list, or any staff/admin surface).
  it('never exports an exercise/admin/picker/list/selection concept', () => {
    const exportNames = Object.keys(MountContractModule).map(name => name.toLowerCase())
    const forbiddenSubstrings = ['exercise', 'picker', 'admin', 'list', 'select', 'switch']

    for (const forbidden of forbiddenSubstrings) {
      expect(exportNames.some(name => name.includes(forbidden))).toBe(false)
    }
  })
})
