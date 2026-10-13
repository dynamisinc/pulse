/**
 * features/controller/lifecycle/useExerciseLifecycle.test.tsx
 * ---------------------------------------------------------------------------
 * The hook behind the StartEx / EndEx control (demo-polish C6), under mock data and the REAL
 * exercise context: the simulated machine, the scope refresh that moves the header pill's source
 * of truth, the one-in-flight rule, and the error surface. (The live endpoints are
 * `ExerciseLifecycleControl.live.test.tsx`.)
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ExerciseContextProvider,
  resetMockExerciseStatus,
  setMockExerciseStatus,
  useExerciseContext,
  type ExerciseStatus,
} from '@/core/exerciseContext'
import { lifecycleQueryKey, useExerciseLifecycle } from './useExerciseLifecycle'

afterEach(() => {
  resetMockExerciseStatus()
})

function mountHook(status: ExerciseStatus) {
  setMockExerciseStatus(status)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>{children}</ExerciseContextProvider>
    </QueryClientProvider>
  )
  // Reads the scope's status next to the lifecycle, so a test can see the refresh land.
  const view = renderHook(
    () => ({ lifecycle: useExerciseLifecycle(), scope: useExerciseContext() }),
    { wrapper },
  )
  return { ...view, client }
}

describe('useExerciseLifecycle (mock data)', () => {
  it('derives the state and what may happen next from the exercise scope\'s status', async () => {
    const { result } = mountHook('staged')

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current.lifecycle).toMatchObject({
      state: 'staged',
      allowedTransitions: ['live'],
      loadPhase: 'ready',
      loadError: undefined,
      canStart: true,
      canEnd: false,
    })
  })

  it('a successful Start returns true, moves the scope\'s status and the buttons, and records what happened', async () => {
    const { result } = mountHook('staged')
    await waitFor(() => expect(result.current).not.toBeNull())

    let ok = false
    await act(async () => { ok = await result.current.lifecycle.transition('live') })

    expect(ok).toBe(true)
    // The scope was RE-RESOLVED (this is what the header pill reads).
    await waitFor(() => expect(result.current.scope.status).toBe('live'))
    expect(result.current.lifecycle).toMatchObject({
      state: 'live',
      canStart: false,
      canEnd: true,
      lastTransition: 'live',
      transitionError: undefined,
      pending: undefined,
    })
  })

  it('EndEx moves live -> completed and leaves nothing to press', async () => {
    const { result } = mountHook('live')
    await waitFor(() => expect(result.current).not.toBeNull())

    await act(async () => { await result.current.lifecycle.transition('completed') })

    await waitFor(() => expect(result.current.scope.status).toBe('completed'))
    expect(result.current.lifecycle).toMatchObject({
      state: 'completed',
      canStart: false,
      canEnd: false,
      lastTransition: 'completed',
    })
  })

  it('a transition the machine refuses returns false with the server\'s own 409 sentence, and changes nothing', async () => {
    const { result } = mountHook('completed')
    await waitFor(() => expect(result.current).not.toBeNull())

    let ok = true
    await act(async () => { ok = await result.current.lifecycle.transition('live') })

    expect(ok).toBe(false)
    // The mutation's error state is published on the query client's next notification tick.
    await waitFor(() => expect(result.current.lifecycle.transitionError).toBe(
      "'completed' -> 'live' is not an allowed lifecycle transition (allowed from 'completed': archived).",
    ))
    expect(result.current.scope.status).toBe('completed')
    expect(result.current.lifecycle.lastTransition).toBeUndefined()
  })

  it('clearError drops the message, and the next attempt starts without one', async () => {
    const { result } = mountHook('completed')
    await waitFor(() => expect(result.current).not.toBeNull())
    await act(async () => { await result.current.lifecycle.transition('live') })
    await waitFor(() => expect(result.current.lifecycle.transitionError).toBeDefined())

    act(() => result.current.lifecycle.clearError())

    await waitFor(() => expect(result.current.lifecycle.transitionError).toBeUndefined())
  })

  it('allows ONE transition in flight: a second call in the same tick is ignored, not an error', async () => {
    const { result } = mountHook('staged')
    await waitFor(() => expect(result.current).not.toBeNull())

    let results: boolean[] = []
    await act(async () => {
      // Both calls happen before React re-renders, so only the ref guard can tell them apart.
      results = await Promise.all([
        result.current.lifecycle.transition('live'),
        result.current.lifecycle.transition('live'),
      ])
    })

    expect(results).toEqual([true, false])
    // Had the second been attempted it would have been a live -> live refusal.
    expect(result.current.lifecycle.transitionError).toBeUndefined()
    await waitFor(() => expect(result.current.scope.status).toBe('live'))
  })

  it('keys the cached lifecycle by exercise, so an exercise switch never reads another\'s state', () => {
    expect(lifecycleQueryKey('ex-a')).not.toEqual(lifecycleQueryKey('ex-b'))
    expect(lifecycleQueryKey('ex-a')).toEqual(lifecycleQueryKey('ex-a'))
    expect(lifecycleQueryKey('ex-a')).toContain('ex-a')
  })
})
