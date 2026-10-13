/**
 * features/social/notifications/NotificationsEngine.overlay.test.tsx
 * ---------------------------------------------------------------------------
 * The engine and the shell's pause / EndEx overlay (demo-polish F7, Gate-2 S-5): while the
 * overlay is up the world is frozen, so the periodic feed re-read holds (the store's
 * `setPaused`, tested with fake timers in `notificationsStore.test.ts`); the engine's part is
 * to TELL the store, from the shell's own public `useOverlayState()` hook.
 *
 *  - `pause` and `endex` hold the re-read; `broadcast` (a break-fiction notice) and `none` do not;
 *  - clearing the overlay resumes it, and so does unmounting;
 *  - a mount that has no notifications (a staff preview, a read-only observer) never even
 *    subscribes to the overlay state.
 *
 * Own file: the overlay hook is replaced module-wide with a controllable one.
 */
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { renderChannel } from '../layout/renderChannel.testUtils'
import { postStore } from '../services/postStore'
import { notificationsStore } from './notificationsStore'

type OverlayKind = 'none' | 'pause' | 'endex' | 'broadcast'

const overlay = vi.hoisted(() => {
  let snapshot: { state: OverlayKind } = { state: 'none' }
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(state: OverlayKind) {
      snapshot = { state }
      for (const listener of [...listeners]) listener()
    },
    subscribers: () => listeners.size,
  }
})

vi.mock('@/features/participant-shell/components/OverlayLayer', async () => {
  const { useSyncExternalStore } = await import('react')
  return { useOverlayState: () => useSyncExternalStore(overlay.subscribe, overlay.get) }
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  overlay.set('none')
  resetTelemetryBuffer()
})

afterEach(() => {
  notificationsStore.reset()
  postStore.resetForTests()
  resetExerciseClock()
  resetTelemetryBuffer()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('the engine holds the re-read while the shell overlay is up', () => {
  it.each([
    ['pause', true],
    ['endex', true],
    ['broadcast', false],
    ['none', false],
  ] as const)('overlay %s -> setPaused(%s)', async (kind, expected) => {
    const setPaused = vi.spyOn(notificationsStore, 'setPaused')
    renderChannel({ entries: ['/home'] })
    await screen.findByRole('link', { name: /^Notifications/ })

    act(() => overlay.set(kind))
    await waitFor(() => expect(setPaused).toHaveBeenLastCalledWith(expected))
  })

  it('resumes when the overlay clears', async () => {
    const setPaused = vi.spyOn(notificationsStore, 'setPaused')
    renderChannel({ entries: ['/home'] })
    await screen.findByRole('link', { name: /^Notifications/ })

    act(() => overlay.set('pause'))
    await waitFor(() => expect(setPaused).toHaveBeenLastCalledWith(true))
    act(() => overlay.set('none'))
    await waitFor(() => expect(setPaused).toHaveBeenLastCalledWith(false))
  })

  it('resumes (and stops listening) when the channel unmounts mid-pause', async () => {
    const setPaused = vi.spyOn(notificationsStore, 'setPaused')
    const view = renderChannel({ entries: ['/home'] })
    await screen.findByRole('link', { name: /^Notifications/ })
    act(() => overlay.set('pause'))
    await waitFor(() => expect(setPaused).toHaveBeenLastCalledWith(true))

    view.unmount()
    expect(setPaused).toHaveBeenLastCalledWith(false)
    expect(overlay.subscribers()).toBe(0)
  })

  it.each(['preview', 'readOnly', 'kiosk'] as const)(
    'a %s mount never subscribes to the overlay for notifications',
    async variant => {
      const setPaused = vi.spyOn(notificationsStore, 'setPaused')
      renderChannel({ entries: ['/home'], variant })
      await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
      act(() => overlay.set('pause'))
      expect(setPaused).not.toHaveBeenCalled()
    },
  )
})
