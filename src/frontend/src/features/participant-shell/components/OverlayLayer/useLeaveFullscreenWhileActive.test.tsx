/**
 * features/participant-shell/components/OverlayLayer/useLeaveFullscreenWhileActive.test.tsx
 * ---------------------------------------------------------------------------
 * HI-1 (demo-polish F2 re-review): nothing stays fullscreen behind a Pause / EndEx /
 * break-fiction overlay — a fullscreen element paints above EVERYTHING, so it would hide
 * the overlay (break-fiction must cover everything, CTL-024). The hook talks to `document`
 * only; jsdom implements none of the Fullscreen API, so each test installs what it needs.
 */
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLeaveFullscreenWhileActive } from './useLeaveFullscreenWhileActive'

function Probe({
  active,
  layerKey,
  onLeft,
}: { active: boolean, layerKey?: string, onLeft?: () => void }) {
  useLeaveFullscreenWhileActive(active, layerKey, onLeft)
  return null
}

function setFullscreenElement(element: Element | null, event = 'fullscreenchange') {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
  act(() => {
    document.dispatchEvent(new Event(event))
  })
}

afterEach(() => {
  for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'exitFullscreen', 'webkitExitFullscreen']) {
    Reflect.deleteProperty(document, key)
  }
})

describe('useLeaveFullscreenWhileActive', () => {
  it('exits an existing fullscreen the moment the overlay becomes active', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })
    const { rerender } = render(<Probe active={false} />)
    expect(exit).not.toHaveBeenCalled()

    rerender(<Probe active={true} />)

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does nothing when nothing is fullscreen', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit

    render(<Probe active={true} />)

    expect(exit).not.toHaveBeenCalled()
  })

  it('does nothing while no overlay is active, even if something goes fullscreen', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    render(<Probe active={false} />)

    setFullscreenElement(document.body)

    expect(exit).not.toHaveBeenCalled()
  })

  it('leaves AGAIN if something enters fullscreen while the overlay is still up (standard and webkit events)', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    render(<Probe active={true} />)
    expect(exit).not.toHaveBeenCalled()

    setFullscreenElement(document.body)
    expect(exit).toHaveBeenCalledTimes(1)

    setFullscreenElement(document.body, 'webkitfullscreenchange')
    expect(exit).toHaveBeenCalledTimes(2)
  })

  it('leaves when the overlay swaps (pause -> break-fiction) and the page is fullscreen again', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    const { rerender } = render(<Probe active={true} layerKey="pause:in-fiction" />)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })

    rerender(<Probe active={true} layerKey="broadcast:in-fiction" />)

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('stops listening once the overlay clears or unmounts', () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    const { rerender, unmount } = render(<Probe active={true} />)

    rerender(<Probe active={false} />)
    setFullscreenElement(document.body)
    expect(exit).not.toHaveBeenCalled()

    rerender(<Probe active={true} />)
    expect(exit).toHaveBeenCalledTimes(1)
    unmount()
    setFullscreenElement(document.body)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('falls back to webkitExitFullscreen and never throws without an API', () => {
    const exit = vi.fn()
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, value: document.body })
    Object.defineProperty(document, 'webkitExitFullscreen', { configurable: true, value: exit })
    expect(() => render(<Probe active={true} />)).not.toThrow()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})

describe('useLeaveFullscreenWhileActive — onLeft (the overlay re-takes focus)', () => {
  it('fires once the exit has settled, after the overlay activates over a fullscreen', async () => {
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })
    const onLeft = vi.fn()

    render(<Probe active={true} onLeft={onLeft} />)

    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1))
  })

  it('fires when a fullscreenchange reports that fullscreen has ended while the overlay is up', () => {
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    const onLeft = vi.fn()
    render(<Probe active={true} onLeft={onLeft} />)
    expect(onLeft).not.toHaveBeenCalled()

    setFullscreenElement(null)

    expect(onLeft).toHaveBeenCalledTimes(1)
  })

  it('never fires when the overlay is not active', () => {
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    const onLeft = vi.fn()
    render(<Probe active={false} onLeft={onLeft} />)

    setFullscreenElement(document.body)
    setFullscreenElement(null)

    expect(onLeft).not.toHaveBeenCalled()
  })

  it('uses the LATEST callback without re-subscribing', () => {
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe active={true} onLeft={first} />)
    rerender(<Probe active={true} onLeft={second} />)

    setFullscreenElement(null)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
