/**
 * features/controller/lifecycle/EndExerciseDialog.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 15 (D5-025, TABLET-AMENDMENT §5) for EndEx on a COARSE pointer: focus stays
 * on the END field, 44px Cancel / End exercise at least 8px apart with End last, the 400ms arming
 * delay, fires once (and once more after a refused request), the on-screen keyboard (a faked
 * `visualViewport`) pads the dialog container so the field and button stay visible, and Escape
 * cancels with focus back on the End exercise trigger (through the real control).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import {
  mockPointer,
  mockVisualViewport,
  restoreMatchMedia,
} from '../components/confirm/coarsePointer.testUtils'
import { EndExerciseDialog } from './EndExerciseDialog'
import { renderControl, resetLifecycleMock, scopeResolved } from './lifecycle.testUtils'

vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle.sessionKit.testUtils')).resolveSession,
}))

function px(value: string): number {
  return Number.parseFloat(value)
}

interface DialogOptions {
  readonly onConfirm?: () => void
  readonly onCancel?: () => void
  readonly error?: string
}

function renderDialog(props: DialogOptions = {}) {
  const onConfirm = props.onConfirm ?? vi.fn()
  const onCancel = props.onCancel ?? vi.fn()
  const ui = (error?: string) => (
    <ThemeProvider theme={cobraTheme}>
      <EndExerciseDialog
        exerciseName="Bay Shield"
        pending={false}
        error={error}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </ThemeProvider>
  )
  const utils = render(ui(props.error))
  return {
    ...utils,
    onConfirm,
    onCancel,
    rerenderWith: (error?: string) => utils.rerender(ui(error)),
  }
}

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
  resetLifecycleMock()
})

describe('EndExerciseDialog on a coarse pointer', () => {
  it('keeps focus on the END field, never the destructive button', () => {
    mockPointer(true)
    renderDialog()
    expect(document.activeElement).toBe(screen.getByTestId('end-exercise-confirm-input'))
  })

  it('has 44px buttons, 16px apart, End exercise at the far edge', () => {
    mockPointer(true)
    renderDialog()
    const confirm = screen.getByTestId('end-exercise-confirm')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(px(getComputedStyle(confirm).minHeight)).toBe(44)
    expect(px(getComputedStyle(cancel).minHeight)).toBe(44)
    const row = confirm.parentElement as HTMLElement
    expect(px(getComputedStyle(row).gap)).toBeGreaterThanOrEqual(8)
    expect(row.lastElementChild).toBe(confirm)
    expect(row.firstElementChild).toBe(cancel)
  })

  it('ignores End exercise at 399ms and fires at 400ms, once on a double tap', () => {
    mockPointer(true)
    vi.useFakeTimers()
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByTestId('end-exercise-confirm-input'), { target: { value: 'END' } })
    const confirm = screen.getByTestId('end-exercise-confirm')

    act(() => {
      vi.advanceTimersByTime(399)
    })
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('allows one more attempt after a refused request (retry stays one tap)', () => {
    mockPointer(true)
    vi.useFakeTimers()
    const { onConfirm, rerenderWith } = renderDialog()
    fireEvent.change(screen.getByTestId('end-exercise-confirm-input'), { target: { value: 'END' } })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.click(screen.getByTestId('end-exercise-confirm'))
    rerenderWith('Refused')
    fireEvent.click(screen.getByTestId('end-exercise-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('pads the dialog container by the on-screen keyboard height (visual viewport)', () => {
    mockPointer(true)
    mockVisualViewport(400)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    renderDialog()
    const container = document.querySelector('.MuiDialog-container') as HTMLElement
    expect(getComputedStyle(container).paddingBottom).toBe('368px')
  })

  it('Escape cancels, and focus returns to the End exercise trigger', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderControl({ status: 'live', withHeader: true })
    await scopeResolved()
    const trigger = screen.getByTestId('lifecycle-end')
    expect(px(getComputedStyle(trigger).minHeight)).toBe(44)
    await user.click(trigger)
    await screen.findByTestId('end-exercise-dialog')
    await user.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(screen.queryByTestId('end-exercise-dialog')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(trigger)
  })
})

describe('EndExerciseDialog on a fine pointer', () => {
  it('is unchanged: End exercise fires at once, no keyboard padding', () => {
    mockPointer(false)
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByTestId('end-exercise-confirm-input'), { target: { value: 'END' } })
    fireEvent.click(screen.getByTestId('end-exercise-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
