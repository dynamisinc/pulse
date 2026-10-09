/**
 * features/controller/runSheet/RunSheetBeatRow.slowFire.test.tsx
 * ---------------------------------------------------------------------------
 * Gate-1 M-4: a request that hangs must not freeze the sheet in silence. After
 * `SLOW_FIRE_NOTICE_MS` (20 s) of "Firing", the row says there is no answer yet and what a
 * reload will do (the beat shows as Unconfirmed). There is NO auto-retry: nothing here ever
 * calls the fire again. Uses fake timers and restores real ones after every test.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { RunSheetBeatRow, type RunSheetBeatRowProps } from './RunSheetBeatRow'
import { SLOW_FIRE_NOTICE, SLOW_FIRE_NOTICE_MS } from './runSheetStatus'
import { beatFixture } from './runSheetTestKit'

const noop = () => {}

function renderRow(overrides: Partial<RunSheetBeatRowProps> = {}) {
  const onFire = vi.fn()
  const props: RunSheetBeatRowProps = {
    beat: beatFixture({ id: 'a' }),
    record: { status: 'pending', inFlight: true, attemptId: 't1' },
    position: 0,
    total: 1,
    selected: true,
    timeZone: 'America/New_York',
    mediaSummary: '',
    mediaMissing: 0,
    sheetFiring: true,
    rowRef: noop,
    onSelect: noop,
    onFire,
    onSkip: noop,
    onEdit: noop,
    onDuplicate: noop,
    onMove: noop,
    onDelete: noop,
    ...overrides,
  }
  const view = (p: RunSheetBeatRowProps) => (
    <ThemeProvider theme={cobraTheme}>
      <ul>
        <RunSheetBeatRow {...p} />
      </ul>
    </ThemeProvider>
  )
  const utils = render(view(props))
  return { ...utils, onFire, props, view }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('slow fire notice (M-4)', () => {
  it('says nothing for the first 20 s, then says there is no answer yet and what a reload does', () => {
    renderRow()
    expect(SLOW_FIRE_NOTICE_MS).toBe(20_000)
    expect(screen.getByText(/Firing\.\.\. waiting for the server/)).toBeInTheDocument()
    expect(screen.queryByTestId('beat-slow-notice')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(SLOW_FIRE_NOTICE_MS - 1)
    })
    expect(screen.queryByTestId('beat-slow-notice')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    const notice = screen.getByTestId('beat-slow-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(
      'No answer yet. If this persists, reload — the beat will show as Unconfirmed.',
    )
    expect(SLOW_FIRE_NOTICE).toBe(
      'No answer yet. If this persists, reload — the beat will show as Unconfirmed.',
    )
  })

  it('never retries by itself: no fire is triggered however long it waits', () => {
    const { onFire } = renderRow()
    act(() => {
      vi.advanceTimersByTime(10 * SLOW_FIRE_NOTICE_MS)
    })
    expect(screen.getByTestId('beat-slow-notice')).toBeInTheDocument()
    expect(onFire).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('goes away as soon as the fire ends, and starts again from zero for the next one', () => {
    const { rerender, props, view } = renderRow()
    act(() => {
      vi.advanceTimersByTime(SLOW_FIRE_NOTICE_MS)
    })
    expect(screen.getByTestId('beat-slow-notice')).toBeInTheDocument()

    rerender(view({ ...props, record: { status: 'fired', firedPostId: 'p', firedAtScenario: '2033-09-04T14:00:00.000Z' }, sheetFiring: false }))
    expect(screen.queryByTestId('beat-slow-notice')).toBeNull()

    rerender(view({ ...props, record: { status: 'pending', inFlight: true, attemptId: 't2' } }))
    act(() => {
      vi.advanceTimersByTime(SLOW_FIRE_NOTICE_MS - 1)
    })
    expect(screen.queryByTestId('beat-slow-notice')).toBeNull()
  })

  it('shows nothing for a beat that is not firing', () => {
    renderRow({ record: { status: 'pending' }, sheetFiring: false })
    act(() => {
      vi.advanceTimersByTime(5 * SLOW_FIRE_NOTICE_MS)
    })
    expect(screen.queryByTestId('beat-slow-notice')).toBeNull()
  })
})
