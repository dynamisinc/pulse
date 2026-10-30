/**
 * useExerciseEnded: the overlay `ended` flag, with `scope.status === 'completed'` as a
 * FIRST-PAINT seed only. Once the overlay answer has landed it is authoritative (W-3), so a
 * future Reopen (completed -> live) with an `ended: false` push clears ended mode without a reload.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseEnded } from './overlayState'

const scope = vi.hoisted(() => ({ status: 'live' as string }))
const overlay = vi.hoisted(() => ({
  body: { state: 'none', register: 'in-fiction', message: '' } as Record<string, unknown>,
  release: undefined as undefined | (() => void),
  gate: undefined as undefined | Promise<void>,
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-ended-hook', timeZone: 'UTC', status: scope.status }),
  useOptionalExerciseContext: () => ({ exerciseId: 'ex-ended-hook', timeZone: 'UTC', status: scope.status }),
}))
vi.mock('@/core/services/api', () => ({
  api: {
    get: async () => {
      if (overlay.gate !== undefined) await overlay.gate
      return { data: overlay.body }
    },
  },
}))

function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useExerciseEnded(), { wrapper })
}

beforeEach(() => {
  scope.status = 'live'
  overlay.body = { state: 'none', register: 'in-fiction', message: '' }
  overlay.gate = undefined
})

describe('useExerciseEnded', () => {
  it('is false for a live exercise with no ended field (absent = false)', async () => {
    const { result } = run()
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('is true when the overlay answer says ended', async () => {
    overlay.body = { ...overlay.body, ended: true }
    const { result } = run()
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('seeds true from scope.status === completed BEFORE the overlay answer lands', async () => {
    scope.status = 'completed'
    overlay.gate = new Promise<void>(resolve => { overlay.release = resolve })
    const { result } = run()
    expect(result.current).toBe(true)
    overlay.release?.()
    await waitFor(() => expect(result.current).toBe(true)).catch(() => undefined)
  })

  it('once the overlay has answered ended:false it wins over a stale completed scope (Reopen)', async () => {
    scope.status = 'completed'
    overlay.body = { ...overlay.body, ended: false }
    const { result } = run()
    await waitFor(() => expect(result.current).toBe(false))
  })
})
