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
  affordancesAvailable,
  useShellContext,
  type ShellVariant,
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

describe('affordancesAvailable (COR-015/COR-064 least-affordance predicate)', () => {
  it('is true only for the full variant - every other variant withholds affordances', () => {
    const cases: Array<[ShellVariant, boolean]> = [
      ['full', true],
      ['readOnly', false],
      ['kiosk', false],
      ['preview', false],
    ]

    for (const [variant, expected] of cases) {
      expect(affordancesAvailable(variant)).toBe(expected)
    }
  })
})

/**
 * A minimal stand-in for a real channel (social now; portal/news/press/
 * weather later): it reads `useShellContext()` and gates its interactive
 * affordances on `affordancesAvailable(variant)` rather than re-deriving its
 * own `variant === 'full'` check - the pattern every channel is meant to
 * follow. Feed content (non-interactive) always renders regardless of
 * variant; only the composer/Post affordance is conditional.
 */
function MockChannelWithComposer() {
  const { variant } = useShellContext()
  return (
    <div>
      <p>Feed content always renders</p>
      {affordancesAvailable(variant) && (
        <form aria-label="Compose a post">
          <label htmlFor="composer-input">What's happening?</label>
          <textarea id="composer-input" />
          <button type="submit">Post</button>
        </form>
      )}
    </div>
  )
}

describe('a mock channel honoring variant (COR-015 — absent, not disabled)', () => {
  it('renders no composer textbox or Post button in the a11y tree under readOnly', () => {
    render(
      <ShellContextProvider
        value={{ variant: 'readOnly', scenarioNow: new Date('2026-01-01T00:00:00Z') }}
      >
        <MockChannelWithComposer />
      </ShellContextProvider>,
    )

    // Genuinely ABSENT from the accessibility tree - not merely disabled (a
    // disabled control still has an accessible role and would still satisfy
    // `getByRole`, so this specifically distinguishes "gone" from "greyed out").
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post/i })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[disabled]')).toHaveLength(0)

    // The rest of the channel is unaffected - only the affordance is gone.
    expect(screen.getByText('Feed content always renders')).toBeInTheDocument()
  })

  it('renders the composer textbox and Post button in the a11y tree under full', () => {
    render(
      <ShellContextProvider
        value={{ variant: 'full', scenarioNow: new Date('2026-01-01T00:00:00Z') }}
      >
        <MockChannelWithComposer />
      </ShellContextProvider>,
    )

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /post/i })).toBeInTheDocument()
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
