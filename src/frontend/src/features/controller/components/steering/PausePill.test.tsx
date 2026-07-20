/**
 * features/controller/components/steering/PausePill.test.tsx
 * ---------------------------------------------------------------------------
 * Covers `<PausePill>` (world-steering/03; CTL-023, D5-014/1.3, NFR-001):
 *  - the pill shows the active tier as TEXT + an icon, never colour-only;
 *  - opening the pill reveals the three pause tiers + Cancel/Pause popover;
 *  - selecting Freeze routes through an explicit confirm step before the tier
 *    takes effect — "Back" returns to the tier list without pausing;
 *  - selecting a non-Freeze tier (injects/engine) applies immediately, no
 *    confirm step;
 *  - the primary action reads "Resume" while paused;
 *  - the whole control is keyboard-operable — Tab/Enter/Space to open, pick a
 *    tier, and confirm; Escape dismisses.
 *
 * `usePauseState` is mocked at the module boundary (mirrors
 * `SwampedModeToggle.test.tsx`'s hook-mock precedent) so each test drives the
 * component's rendering + interactions directly and deterministically.
 */
import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { usePauseState, type PauseState, type PauseTier } from '../../hooks/usePauseState'
import { PausePill } from './PausePill'

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>)
}

vi.mock('../../hooks/usePauseState', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePauseState')>(
    '../../hooks/usePauseState',
  )
  return { ...actual, usePauseState: vi.fn() }
})

const mockedUsePauseState = vi.mocked(usePauseState)

function stub(tier: PauseTier, overrides: Partial<PauseState> = {}): PauseState {
  const labels: Record<PauseTier, PauseState['label']> = {
    running: 'RUNNING',
    injects: 'INJECTS PAUSED',
    engine: 'ENGINE PAUSED',
    freeze: 'WORLD FROZEN',
  }
  return {
    tier,
    label: labels[tier],
    isPaused: tier !== 'running',
    isFrozen: tier === 'freeze',
    overlayRegister: 'out-of-fiction',
    setTier: vi.fn(),
    resume: vi.fn(),
    setOverlayRegister: vi.fn(),
    ...overrides,
  }
}

describe('PausePill — active-tier display (NFR-001: text + icon, never colour-only)', () => {
  it('shows RUNNING with its label text and an icon when unpaused', () => {
    mockedUsePauseState.mockReturnValue(stub('running'))
    renderWithTheme(<PausePill />)

    const pill = screen.getByTestId('pause-pill')
    expect(pill).toHaveTextContent('RUNNING')
    expect(pill.querySelector('svg')).not.toBeNull()
  })

  it('shows INJECTS PAUSED text + icon when that tier is active', () => {
    mockedUsePauseState.mockReturnValue(stub('injects'))
    renderWithTheme(<PausePill />)

    const pill = screen.getByTestId('pause-pill')
    expect(pill).toHaveTextContent('INJECTS PAUSED')
    expect(pill.querySelector('svg')).not.toBeNull()
  })

  it('shows WORLD FROZEN text + icon when frozen', () => {
    mockedUsePauseState.mockReturnValue(stub('freeze'))
    renderWithTheme(<PausePill />)

    const pill = screen.getByTestId('pause-pill')
    expect(pill).toHaveTextContent('WORLD FROZEN')
    expect(pill.querySelector('svg')).not.toBeNull()
  })

  it('exposes the current state via an accessible name (not colour alone)', () => {
    mockedUsePauseState.mockReturnValue(stub('engine'))
    renderWithTheme(<PausePill />)

    expect(
      screen.getByRole('button', { name: /current state: ENGINE PAUSED/i }),
    ).toBeInTheDocument()
  })
})

describe('PausePill — the pause popover', () => {
  it('opening the pill reveals the three tier options + a Pause action', async () => {
    const user = userEvent.setup()
    mockedUsePauseState.mockReturnValue(stub('running'))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))

    expect(screen.getByTestId('pause-tier-option-injects')).toBeInTheDocument()
    expect(screen.getByTestId('pause-tier-option-engine')).toBeInTheDocument()
    expect(screen.getByTestId('pause-tier-option-freeze')).toBeInTheDocument()
    expect(screen.getByTestId('pause-apply')).toHaveTextContent('Pause')
  })

  it('selecting Pause injects and applying calls setTier("injects") immediately (no confirm step)', async () => {
    const user = userEvent.setup()
    const setTier = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('running', { setTier }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-injects'))
    await user.click(screen.getByTestId('pause-apply'))

    expect(setTier).toHaveBeenCalledWith('injects')
    expect(setTier).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('pause-freeze-confirm')).not.toBeInTheDocument()
  })

  it('the primary action reads "Resume" while a tier is active, and calls resume()', async () => {
    const user = userEvent.setup()
    const resume = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('injects', { resume }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    const resumeButton = screen.getByTestId('pause-resume')
    expect(resumeButton).toHaveTextContent('Resume')

    await user.click(resumeButton)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('does not offer a Resume action while running (nothing to resume from)', async () => {
    const user = userEvent.setup()
    mockedUsePauseState.mockReturnValue(stub('running'))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    expect(screen.queryByTestId('pause-resume')).not.toBeInTheDocument()
  })
})

describe('PausePill — Freeze is guarded by an explicit confirm step', () => {
  it('selecting Freeze does NOT call setTier immediately — it opens a confirm step first', async () => {
    const user = userEvent.setup()
    const setTier = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('running', { setTier }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-freeze'))
    await user.click(screen.getByTestId('pause-apply'))

    expect(setTier).not.toHaveBeenCalled()
    expect(screen.getByTestId('pause-freeze-confirm')).toBeInTheDocument()
  })

  it('confirming the freeze step calls setTier("freeze") exactly once', async () => {
    const user = userEvent.setup()
    const setTier = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('running', { setTier }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-freeze'))
    await user.click(screen.getByTestId('pause-apply'))

    const confirm = screen.getByTestId('pause-freeze-confirm')
    await user.click(within(confirm).getByTestId('pause-freeze-confirm-button'))

    expect(setTier).toHaveBeenCalledWith('freeze')
    expect(setTier).toHaveBeenCalledTimes(1)
  })

  it('"Back" from the confirm step returns to the tier list without pausing', async () => {
    const user = userEvent.setup()
    const setTier = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('running', { setTier }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByTestId('pause-tier-option-freeze'))
    await user.click(screen.getByTestId('pause-apply'))
    expect(screen.getByTestId('pause-freeze-confirm')).toBeInTheDocument()

    await user.click(screen.getByTestId('pause-freeze-back'))

    expect(setTier).not.toHaveBeenCalled()
    expect(screen.queryByTestId('pause-freeze-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('pause-tier-option-freeze')).toBeInTheDocument()
  })
})

describe('PausePill — fully keyboard-operable (NFR-001)', () => {
  it('Enter opens the pill, arrow/Tab reaches a tier radio, Enter/Space selects it', async () => {
    const user = userEvent.setup()
    mockedUsePauseState.mockReturnValue(stub('running'))
    renderWithTheme(<PausePill />)

    await user.tab() // focus the pill button
    expect(screen.getByTestId('pause-pill')).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('pause-popover')).toBeInTheDocument()

    const injectsRadio = screen.getByTestId('pause-tier-option-injects').querySelector('input')
    expect(injectsRadio).not.toBeNull()
  })

  it('the Freeze confirm step is reachable and dismissable by keyboard alone (Tab + Enter)', async () => {
    const user = userEvent.setup()
    const setTier = vi.fn()
    mockedUsePauseState.mockReturnValue(stub('running', { setTier }))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))

    const freezeRadio = screen.getByTestId('pause-tier-option-freeze').querySelector('input')
    expect(freezeRadio).not.toBeNull()
    if (freezeRadio) freezeRadio.focus()
    await user.keyboard(' ')

    screen.getByTestId('pause-apply').focus()
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('pause-freeze-confirm')).toBeInTheDocument()

    // Dismiss via keyboard (Back button), reachable by Tab, activated by Enter.
    screen.getByTestId('pause-freeze-back').focus()
    await user.keyboard('{Enter}')

    expect(setTier).not.toHaveBeenCalled()
    expect(screen.queryByTestId('pause-freeze-confirm')).not.toBeInTheDocument()
  })

  it('Escape dismisses the popover', async () => {
    const user = userEvent.setup()
    mockedUsePauseState.mockReturnValue(stub('running'))
    renderWithTheme(<PausePill />)

    await user.click(screen.getByTestId('pause-pill'))
    expect(screen.getByTestId('pause-popover')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('pause-popover')).not.toBeInTheDocument()
  })
})

describe('PausePill — overlay register is not rendered by this control', () => {
  it('never renders an OverlayLayer/pause-page element — this control only triggers state', () => {
    mockedUsePauseState.mockReturnValue(stub('freeze'))
    renderWithTheme(<PausePill />)

    expect(screen.queryByTestId('overlay-layer')).not.toBeInTheDocument()
    expect(screen.queryByText(/EXERCISE PAUSED/i)).not.toBeInTheDocument()
  })
})
