/**
 * features/participant-shell/components/AlertBar/AlertBar.fullscreen.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 M-5 (PRT-010): the browser paints a fullscreen element ABOVE the shell's
 * fixed alert bar, so a channel's fullscreen video would hide a new alert indefinitely.
 * The bar leaves fullscreen ONCE when a NEW advisory / emergency alert becomes active:
 *
 *  - fullscreen active -> a new emergency alert -> `exitFullscreen` is called exactly once;
 *  - re-entering fullscreen with the SAME alert still active is allowed (no re-exit --
 *    that is what `useLeaveFullscreenWhileActive` would do, which would make fullscreen
 *    unusable for the whole life of a long alert ticker);
 *  - the NEXT new alert interrupts again; an alert that clears and returns is new again;
 *  - `advisory` interrupts, `info` does not; nothing is called when nothing is fullscreen;
 *  - StrictMode's double effect does not double-fire.
 *
 * `jsdom` implements none of the Fullscreen API, so each test installs what it needs on
 * `document` (the bar talks to `document` only, via `@/core/dom/fullscreen`).
 */
import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertBar } from './AlertBar'
import { useAlerts } from './useAlerts'
import type { Alert, AlertSeverity } from './alertTypes'

vi.mock('./useAlerts', () => ({
  useAlerts: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alert-bar-0001',
    exerciseName: 'Alert Bar Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlerts = vi.mocked(useAlerts)

function makeAlert(id: string, severity: AlertSeverity): Alert {
  return {
    id,
    severity,
    message: `Message for ${id}.`,
    scenarioTime: '2026-07-16T14:00:00.000Z',
  }
}

/** Installs a fullscreen element (or none) on `document` and fires the change event. */
function setFullscreen(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'))
  })
}

let exit: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockUseAlerts.mockReset()
  exit = vi.fn().mockResolvedValue(undefined)
  document.exitFullscreen = exit as unknown as typeof document.exitFullscreen
})

afterEach(() => {
  for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'exitFullscreen']) {
    Reflect.deleteProperty(document, key)
  }
})

describe('AlertBar — a NEW alert leaves fullscreen once (PRT-010)', () => {
  it('fullscreen active -> a new emergency alert -> exitFullscreen is called exactly once', () => {
    mockUseAlerts.mockReturnValue([])
    setFullscreen(document.body)
    const { rerender } = render(<AlertBar />)
    expect(exit).not.toHaveBeenCalled()

    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    rerender(<AlertBar />)

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-exit when fullscreen is re-entered with the same alert still active', () => {
    mockUseAlerts.mockReturnValue([])
    setFullscreen(document.body)
    const { rerender } = render(<AlertBar />)
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    rerender(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(1)

    // The viewer leaves, then goes fullscreen AGAIN; the alert is still active.
    setFullscreen(null)
    setFullscreen(document.body)
    // Unrelated re-renders with an equivalent (new array identity) alert list.
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    rerender(<AlertBar />)
    rerender(<AlertBar />)

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('the NEXT new alert interrupts again, and an alert that clears and returns is new again', () => {
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    setFullscreen(document.body)
    const { rerender } = render(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(1)

    // A second emergency joins while the first is still up -> interrupts again.
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency'), makeAlert('e2', 'emergency')])
    rerender(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(2)

    // Everything clears, then e1 comes back -> new again.
    mockUseAlerts.mockReturnValue([])
    rerender(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(2)
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    rerender(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(3)
  })

  it('a new ADVISORY leaves fullscreen; a new INFO alert does not', () => {
    mockUseAlerts.mockReturnValue([])
    setFullscreen(document.body)
    const { rerender } = render(<AlertBar />)

    mockUseAlerts.mockReturnValue([makeAlert('i1', 'info')])
    rerender(<AlertBar />)
    expect(exit).not.toHaveBeenCalled()

    mockUseAlerts.mockReturnValue([makeAlert('i1', 'info'), makeAlert('a1', 'advisory')])
    rerender(<AlertBar />)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does not call exitFullscreen when nothing is fullscreen', () => {
    mockUseAlerts.mockReturnValue([])
    const { rerender } = render(<AlertBar />)

    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    rerender(<AlertBar />)

    expect(exit).not.toHaveBeenCalled()
  })

  it('fires once under StrictMode (the double effect does not double-exit)', () => {
    mockUseAlerts.mockReturnValue([makeAlert('e1', 'emergency')])
    setFullscreen(document.body)

    render(
      <StrictMode>
        <AlertBar />
      </StrictMode>,
    )

    expect(exit).toHaveBeenCalledTimes(1)
  })
})
