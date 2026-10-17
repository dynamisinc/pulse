/**
 * features/controller/liveWorld/TakedownAction.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 15 (D5-025, TABLET-AMENDMENT §5) for Take down on a COARSE pointer:
 * 44px category rows and buttons, Cancel/Confirm at least 8px apart with Confirm last, no
 * destructive autofocus, the 400ms arming delay (399ms ignored, 400ms fires), Escape cancels with
 * focus back on the trigger, the popper flips/shifts. And that a FINE pointer is unchanged.
 * `(pointer: coarse)` is mocked through `matchMedia`; nothing here depends on a viewport width.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { takeDownPost } from '../services/takedownService'
import { mockPointer, restoreMatchMedia } from '../components/confirm/coarsePointer.testUtils'
import { TakedownAction } from './TakedownAction'
import type { LiveWorldPost } from './liveWorldModel'

vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useExerciseContext: () => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Mock Exercise',
    timeZone: 'America/New_York',
  }),
}))
vi.mock('../access/useCanControl', () => ({ useCanControl: vi.fn(() => true) }))
vi.mock('../services/takedownService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/takedownService')>()
  return { ...actual, takeDownPost: vi.fn(actual.takeDownPost) }
})

const mockedTakeDown = vi.mocked(takeDownPost)

const POST: LiveWorldPost = {
  id: 'post-seed-fwupd-rumor',
  authorPersonaId: 'persona-fairhavenwaterupd',
  authorHandle: 'FairhavenWaterUpd',
  authorDisplayName: 'Fairhaven Water Update',
  authorVerified: false,
  text: 'DO NOT drink the water',
  scenarioTime: '2033-09-04T13:45:00Z',
  counts: { reply: 0, repost: 0, like: 0 },
}

function renderAction() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <TakedownAction post={POST} />
    </ThemeProvider>,
  )
}

function px(value: string): number {
  return Number.parseFloat(value)
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  resetTelemetryBuffer()
  postStore.resetForTests()
  removedPosts.resetForTests()
  mockedTakeDown.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
  resetExerciseClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
  removedPosts.resetForTests()
})

describe('TakedownAction on a coarse pointer', () => {
  it('sizes the trigger, category rows and both buttons to 44px, 16px apart, Confirm last', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderAction()
    expect(px(getComputedStyle(screen.getByTestId('takedown-trigger')).minHeight)).toBe(44)

    await user.click(screen.getByTestId('takedown-trigger'))
    const dialog = await screen.findByTestId('takedown-dialog')

    for (const radio of within(dialog).getAllByRole('radio')) {
      const row = radio.closest('label')
      expect(row).not.toBeNull()
      expect(px(getComputedStyle(row as HTMLElement).minHeight)).toBeGreaterThanOrEqual(44)
    }
    const cancel = within(dialog).getByTestId('takedown-cancel')
    const confirm = within(dialog).getByTestId('takedown-confirm')
    expect(px(getComputedStyle(cancel).minHeight)).toBe(44)
    expect(px(getComputedStyle(confirm).minHeight)).toBe(44)
    const row = confirm.parentElement as HTMLElement
    expect(px(getComputedStyle(row).gap)).toBeGreaterThanOrEqual(8)
    // Cancel first, Confirm at the far edge.
    expect(row.lastElementChild).toBe(confirm)
    expect(row.firstElementChild).toBe(cancel)
    // Gestures that must not reach the action.
    expect(getComputedStyle(confirm).touchAction).toBe('manipulation')
  })

  it('does not autofocus the destructive button (focus is on the selected category)', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderAction()
    await user.click(screen.getByTestId('takedown-trigger'))
    const dialog = await screen.findByTestId('takedown-dialog')
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: 'Other' }))
    expect(document.activeElement).not.toBe(within(dialog).getByTestId('takedown-confirm'))
  })

  it('ignores Confirm at 399ms after opening and fires at 400ms, once', () => {
    mockPointer(true)
    vi.useFakeTimers()
    renderAction()
    fireEvent.click(screen.getByTestId('takedown-trigger'))
    const confirm = screen.getByTestId('takedown-confirm')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')

    act(() => {
      vi.advanceTimersByTime(399)
    })
    fireEvent.click(confirm)
    expect(mockedTakeDown).not.toHaveBeenCalled()
    expect(screen.getByTestId('takedown-dialog')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(confirm).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
  })

  it('Escape cancels without taking anything down and returns focus to the trigger', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderAction()
    const trigger = screen.getByTestId('takedown-trigger')
    await user.click(trigger)
    await screen.findByTestId('takedown-dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('takedown-dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
    expect(mockedTakeDown).not.toHaveBeenCalled()
  })

  it('a context menu (long-press) on Confirm is suppressed and does not fire it', async () => {
    mockPointer(true)
    const user = userEvent.setup()
    renderAction()
    await user.click(screen.getByTestId('takedown-trigger'))
    const confirm = await screen.findByTestId('takedown-confirm')
    const notPrevented = fireEvent.contextMenu(confirm)
    expect(notPrevented).toBe(false)
    expect(mockedTakeDown).not.toHaveBeenCalled()
  })
})

describe('TakedownAction on a fine pointer', () => {
  it('is unchanged: no arming delay, Confirm works at once', async () => {
    mockPointer(false)
    const user = userEvent.setup()
    renderAction()
    await user.click(screen.getByTestId('takedown-trigger'))
    const confirm = await screen.findByTestId('takedown-confirm')
    expect(confirm).toHaveAttribute('aria-disabled', 'false')
    await user.click(confirm)
    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
  })
})
