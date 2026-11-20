/**
 * features/staff/hooks/useSetActiveExercise.hub.test.tsx
 * ---------------------------------------------------------------------------
 * #856: the shared hub connection across an exercise switch. The server cuts the old connection
 * on a switch and SignalR's auto-reconnect would rejoin as the NEW exercise before the console
 * commits it, so the hook owns the transition:
 *  - the hub is stopped (`'scope-changed'`) BEFORE the switch request;
 *  - the exercise-scope resets of the module stores run, then the hub is resumed, only AFTER the
 *    scope has been re-resolved (the second `GET /exercise-context` has answered);
 *  - a failed POST resumes on the old scope (no scope reset);
 *  - a failed re-resolve leaves the hub STOPPED (fail closed) and resets nothing;
 *  - two back-to-back switches stop and resume once each, in order.
 *
 * Every step is logged to one array so ORDER is what is asserted.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider, useExerciseContext } from '@/core/exerciseContext'
import { resolveExerciseContext } from '@/core/exerciseContext/exerciseContextResolver'
import { registerExerciseScopeReset } from '@/core/auth/sessionReset'
import { realtimeConnection } from '@/core/realtime/connection'
import { setActiveExercise } from '../services/staffAssignmentsService'
import { useSetActiveExercise } from './useSetActiveExercise'

vi.mock('@/core/exerciseContext/exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))
vi.mock('../services/staffAssignmentsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/staffAssignmentsService')>()
  return { ...actual, setActiveExercise: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)
const mockSwitch = vi.mocked(setActiveExercise)

const scope = (id: string) => ({
  exerciseId: id,
  exerciseName: id,
  timeZone: 'UTC',
  status: 'live' as const,
})

const enrollment = (id: string) => ({
  exerciseId: id,
  exerciseName: id,
  role: 'controller' as const,
  personId: 'p',
  isLead: false,
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>{children}</ExerciseContextProvider>
    </QueryClientProvider>
  )
}

let log: string[]
let unregisterScopeReset: () => void

function useHarness() {
  return { mutation: useSetActiveExercise(), exerciseId: useExerciseContext().exerciseId }
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockResolve.mockReset()
  mockSwitch.mockReset()
  log = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(realtimeConnection, 'stop').mockImplementation(reason => {
    log.push(`stop:${reason ?? 'stopped'}`)
    return Promise.resolve()
  })
  vi.spyOn(realtimeConnection, 'resume').mockImplementation(() => {
    log.push('resume')
    return Promise.resolve()
  })
  unregisterScopeReset = registerExerciseScopeReset(() => {
    log.push('scope-reset')
  })
  let scopeIndex = 0
  mockResolve.mockImplementation(() => {
    const scopes = ['ex-a', 'ex-b', 'ex-c']
    const id = scopes[Math.min(scopeIndex, scopes.length - 1)] ?? 'ex-a'
    scopeIndex += 1
    log.push(`resolve:${id}`)
    return Promise.resolve(scope(id))
  })
  mockSwitch.mockImplementation(id => {
    log.push(`post:${id}`)
    return Promise.resolve(enrollment(id))
  })
})

afterEach(() => {
  unregisterScopeReset()
})

async function mount() {
  const hook = renderHook(useHarness, { wrapper })
  await waitFor(() => expect(hook.result.current).not.toBeNull())
  log.length = 0 // forget the mount resolution
  return hook
}

describe('useSetActiveExercise - hub connection', () => {
  it('stops the hub before the POST, and resumes only after the scope re-resolved and the stores reset', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b')
    })

    expect(log).toEqual([
      'stop:scope-changed',
      'post:ex-b',
      'resolve:ex-b',
      'scope-reset',
      'resume',
    ])
    await waitFor(() => expect(result.current.exerciseId).toBe('ex-b'))
  })

  it('a failed POST resumes on the old scope and resets nothing', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new Error('409'))
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b').catch(() => {})
    })

    expect(log).toEqual(['stop:scope-changed', 'post', 'resume'])
  })

  it('a failed re-resolve leaves the hub stopped and resets nothing (fail closed)', async () => {
    const { result } = await mount()
    mockResolve.mockImplementation(() => {
      log.push('resolve:fails')
      return Promise.reject(new Error('down'))
    })
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b').catch(() => {})
    })

    expect(log).toEqual(['stop:scope-changed', 'post:ex-b', 'resolve:fails'])
    expect(log).not.toContain('resume')
    expect(log).not.toContain('scope-reset')
  })

  it('two back-to-back switches stop and resume once each, in order', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b')
    })
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-c')
    })

    expect(log).toEqual([
      'stop:scope-changed',
      'post:ex-b',
      'resolve:ex-b',
      'scope-reset',
      'resume',
      'stop:scope-changed',
      'post:ex-c',
      'resolve:ex-c',
      'scope-reset',
      'resume',
    ])
  })
})
