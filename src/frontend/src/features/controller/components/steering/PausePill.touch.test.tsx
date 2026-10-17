/**
 * features/controller/components/steering/PausePill.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 15 (D5-025, TABLET-AMENDMENT §5) for the Freeze confirm on a COARSE
 * pointer: 44px Back / Confirm freeze at least 8px apart with Confirm last, the step restating the
 * holding page, NO focused button on open, the 400ms arming delay, fires once, Escape cancels and
 * returns focus to the pill. A fine pointer is unchanged. `usePauseState` is mocked as in
 * `PausePill.test.tsx`; `(pointer: coarse)` through `matchMedia`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { usePauseState, type PauseState } from '../../hooks/usePauseState'
import { mockPointer, restoreMatchMedia } from '../confirm/coarsePointer.testUtils'
import { PausePill } from './PausePill'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))
vi.mock('../../hooks/usePauseState', async () => ({
  ...(await vi.importActual<typeof import('../../hooks/usePauseState')>('../../hooks/usePauseState')),
  usePauseState: vi.fn(),
}))

const mockedUsePauseState = vi.mocked(usePauseState)

function stub(): PauseState {
  return {
    tier: 'running',
    label: 'RUNNING',
    isPaused: false,
    isFrozen: false,
    overlayRegister: 'out-of-fiction',
    setTier: vi.fn(),
    resume: vi.fn(),
    setOverlayRegister: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
  }
}

function px(value: string): number {
  return Number.parseFloat(value)
}

/** Opens the pill, picks Freeze, and presses Pause: lands on the confirm step. */
function openFreezeStep(state: PauseState) {
  mockedUsePauseState.mockReturnValue(state)
  render(<ThemeProvider theme={cobraTheme}><PausePill /></ThemeProvider>)
  fireEvent.click(screen.getByTestId('pause-pill'))
  fireEvent.click(screen.getByRole('radio', { name: /freeze world/i }))
  fireEvent.click(screen.getByTestId('pause-apply'))
}

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
})

describe('PausePill Freeze confirm on a coarse pointer', () => {
  it('has 44px Back / Confirm freeze, 16px apart, Confirm last, and restates the holding page', () => {
    mockPointer(true)
    openFreezeStep(stub())
    const step = screen.getByTestId('pause-freeze-confirm')
    expect(screen.getByTestId('pause-freeze-confirm-register')).toHaveTextContent(
      'They will see: Out of fiction',
    )
    const back = screen.getByTestId('pause-freeze-back')
    const confirm = screen.getByTestId('pause-freeze-confirm-button')
    expect(px(getComputedStyle(back).minHeight)).toBe(44)
    expect(px(getComputedStyle(confirm).minHeight)).toBe(44)
    const row = confirm.parentElement as HTMLElement
    expect(px(getComputedStyle(row).gap)).toBeGreaterThanOrEqual(8)
    expect(row.lastElementChild).toBe(confirm)
    expect(row.firstElementChild).toBe(back)
    expect(step).toBeInTheDocument()
  })

  it('opens with no focused button (the step container holds focus)', () => {
    mockPointer(true)
    openFreezeStep(stub())
    const active = document.activeElement
    expect(active).toBe(screen.getByTestId('pause-freeze-confirm'))
    expect(active?.tagName).not.toBe('BUTTON')
  })

  it('ignores Confirm freeze at 399ms and fires at 400ms, once', () => {
    mockPointer(true)
    vi.useFakeTimers()
    const state = stub()
    openFreezeStep(state)
    const confirm = screen.getByTestId('pause-freeze-confirm-button')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')

    act(() => {
      vi.advanceTimersByTime(399)
    })
    fireEvent.click(confirm)
    expect(state.setTier).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(state.setTier).toHaveBeenCalledTimes(1)
    expect(state.setTier).toHaveBeenCalledWith('freeze')
  })

  it('Escape cancels the step without freezing and returns focus to the pill', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    const state = stub()
    mockedUsePauseState.mockReturnValue(state)
    render(<ThemeProvider theme={cobraTheme}><PausePill /></ThemeProvider>)
    // A real click focuses the pill, which is what MUI hands focus back to on close.
    await user.click(screen.getByTestId('pause-pill'))
    await user.click(screen.getByRole('radio', { name: /freeze world/i }))
    await user.click(screen.getByTestId('pause-apply'))
    await screen.findByTestId('pause-freeze-confirm')
    await user.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(screen.queryByTestId('pause-freeze-confirm')).not.toBeInTheDocument()
    })
    expect(state.setTier).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByTestId('pause-pill'))
  })

  it('sizes the tier radios and Pause to 44px', () => {
    mockPointer(true)
    mockedUsePauseState.mockReturnValue(stub())
    render(<ThemeProvider theme={cobraTheme}><PausePill /></ThemeProvider>)
    fireEvent.click(screen.getByTestId('pause-pill'))
    expect(px(getComputedStyle(screen.getByTestId('pause-apply')).minHeight)).toBe(44)
    expect(
      px(getComputedStyle(screen.getByTestId('pause-tier-option-freeze')).minHeight),
    ).toBeGreaterThanOrEqual(44)
  })
})

describe('PausePill Freeze confirm on a fine pointer', () => {
  it('is unchanged: armed at once', () => {
    mockPointer(false)
    const state = stub()
    openFreezeStep(state)
    const confirm = screen.getByTestId('pause-freeze-confirm-button')
    expect(confirm).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(confirm)
    expect(state.setTier).toHaveBeenCalledWith('freeze')
  })
})
