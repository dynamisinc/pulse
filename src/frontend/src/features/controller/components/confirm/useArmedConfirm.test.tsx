/**
 * features/controller/components/confirm/useArmedConfirm.test.tsx
 * ---------------------------------------------------------------------------
 * Story 15 (D5-025, TABLET-AMENDMENT §5 rule 4): the arming delay and fire-once guard, with fake
 * timers. A tap at 399ms is ignored, at 400ms it fires; a double tap fires once; a changed
 * `resetKey` allows one more; with `enabled` false the step is armed at once (desktop).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArmedConfirm } from './useArmedConfirm'

function Probe({ enabled, onFire, resetKey }: {
  readonly enabled: boolean
  readonly onFire: () => void
  readonly resetKey?: unknown
}) {
  const { armed, guard } = useArmedConfirm({ open: true, enabled, resetKey })
  return (
    <button type="button" aria-disabled={!armed} onClick={guard(onFire)}>
      confirm
    </button>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useArmedConfirm', () => {
  it('ignores a tap at 399ms and fires at 400ms', () => {
    const onFire = vi.fn()
    render(<Probe enabled onFire={onFire} />)
    const button = screen.getByRole('button', { name: 'confirm' })
    expect(button).toHaveAttribute('aria-disabled', 'true')

    act(() => {
      vi.advanceTimersByTime(399)
    })
    fireEvent.click(button)
    expect(onFire).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(button).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('fires once on a double tap', () => {
    const onFire = vi.fn()
    render(<Probe enabled onFire={onFire} />)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    const button = screen.getByRole('button', { name: 'confirm' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('allows one more fire after resetKey changes (a refused request)', () => {
    const onFire = vi.fn()
    const { rerender } = render(<Probe enabled onFire={onFire} resetKey="a" />)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    const button = screen.getByRole('button', { name: 'confirm' })
    fireEvent.click(button)
    rerender(<Probe enabled onFire={onFire} resetKey="b" />)
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('is armed immediately when not enabled (fine pointer), and still fires once', () => {
    const onFire = vi.fn()
    render(<Probe enabled={false} onFire={onFire} />)
    const button = screen.getByRole('button', { name: 'confirm' })
    expect(button).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
