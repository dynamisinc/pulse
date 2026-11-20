/**
 * features/staff/hooks/useSetActiveExercise.hub.test.tsx
 * ---------------------------------------------------------------------------
 * #856: the shared hub connection across an exercise switch. The server cuts the old connection
 * on a switch and SignalR's auto-reconnect would rejoin as the NEW exercise before the console
 * commits it, so the hook owns the transition:
 *  - the hub is stopped (`'scope-changed'`) BEFORE the switch request;
 *  - the exercise-scope resets of the module stores run, then the hub is resumed, only AFTER the
 *    scope has been re-resolved (the second `GET /exercise-context` has answered);
 *  - a DEFINITE POST refusal (4xx) resumes on the old scope (no scope reset); an AMBIGUOUS
 *    failure (5xx, network error, timeout) asks the server: B -> full commit and resume, A ->
 *    resume, the re-resolve fails -> stay stopped;
 *  - overlapping switches are serialized; every switch that changed the scope resets the stores,
 *    but only the LATEST resumes the hub;
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
import { setActiveExercise, StaffAssignmentError } from '../services/staffAssignmentsService'
import {
  resetSetActiveExerciseForTests,
  SCOPE_REREAD_RETRY_MS,
  SWITCH_POST_TIMEOUT_MS,
  useSetActiveExercise,
} from './useSetActiveExercise'

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
  resetSetActiveExerciseForTests()
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
  vi.useRealTimers()
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

  it('a definite refusal (4xx) resumes on the old scope and resets nothing', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new StaffAssignmentError('conflict', { status: 409 }))
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b').catch(() => {})
    })

    expect(log).toEqual(['stop:scope-changed', 'post', 'resume'])
  })

  it.each([
    ['a 503', { status: 503 }],
    ['a network error', {}],
    ['a 408 timeout', { status: 408 }],
  ])('an ambiguous failure (%s) asks the server; B means a full commit and resume', async (_name, init) => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new StaffAssignmentError('boom', init))
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b').catch(() => {})
    })

    expect(log).toEqual(['stop:scope-changed', 'post', 'resolve:ex-b', 'scope-reset', 'resume'])
    await waitFor(() => expect(result.current.exerciseId).toBe('ex-b'))
  })

  it('an ambiguous failure where the server still reports A just resumes (no store reset)', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new StaffAssignmentError('boom', { status: 502 }))
    })
    const { result } = await mount()
    mockResolve.mockImplementation(() => {
      log.push('resolve:ex-a')
      return Promise.resolve(scope('ex-a'))
    })
    await act(async () => {
      await result.current.mutation.mutateAsync('ex-b').catch(() => {})
    })

    expect(log).toEqual(['stop:scope-changed', 'post', 'resolve:ex-a', 'resume'])
  })

  it('an ambiguous failure whose re-resolve also fails leaves the hub stopped', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new StaffAssignmentError('boom'))
    })
    const { result } = await mount()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockResolve.mockImplementation(() => {
      log.push('resolve:fails')
      return Promise.reject(new Error('down'))
    })
    await act(async () => {
      const switching = result.current.mutation.mutateAsync('ex-b').catch(() => {})
      await vi.advanceTimersByTimeAsync(SCOPE_REREAD_RETRY_MS + 1)
      await switching
    })

    // Read, retried once, failed closed: the hub stays stopped.
    expect(log).toEqual(['stop:scope-changed', 'post', 'resolve:fails', 'resolve:fails'])
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

describe('useSetActiveExercise - a POST that never settles, and a blip on the re-read', () => {
  it('treats a POST that never settles as ambiguous: re-resolves, then commits and resumes', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return new Promise(() => {}) // never settles
    })
    const { result } = await mount()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await act(async () => {
      const switching = result.current.mutation.mutateAsync('ex-b').catch(() => {})
      await vi.advanceTimersByTimeAsync(SWITCH_POST_TIMEOUT_MS + 1)
      await switching
    })

    expect(log).toEqual(['stop:scope-changed', 'post', 'resolve:ex-b', 'scope-reset', 'resume'])
  })

  it('re-reads the scope once after an ambiguous failure before failing closed', async () => {
    mockSwitch.mockImplementation(() => {
      log.push('post')
      return Promise.reject(new StaffAssignmentError('boom', { status: 503 }))
    })
    const { result } = await mount()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let reads = 0
    mockResolve.mockImplementation(() => {
      reads += 1
      if (reads === 1) {
        log.push('resolve:blip')
        return Promise.reject(new Error('offline'))
      }
      log.push('resolve:ex-b')
      return Promise.resolve(scope('ex-b'))
    })

    await act(async () => {
      const switching = result.current.mutation.mutateAsync('ex-b').catch(() => {})
      await vi.advanceTimersByTimeAsync(SCOPE_REREAD_RETRY_MS + 1)
      await switching
    })

    // One blip did not take the console to "Session unavailable": the retry committed B.
    expect(log).toEqual([
      'stop:scope-changed',
      'post',
      'resolve:blip',
      'resolve:ex-b',
      'scope-reset',
      'resume',
    ])
  })
})

describe('useSetActiveExercise - overlapping switches', () => {
  it('serializes the POSTs, and only the latest switch resets the stores and resumes the hub', async () => {
    let releaseFirst: () => void = () => {}
    mockSwitch.mockImplementationOnce(id => {
      log.push(`post:${id}`)
      return new Promise(resolve => {
        releaseFirst = () => resolve(enrollment(id))
      })
    })
    const { result } = await mount()

    let first: Promise<unknown> = Promise.resolve()
    let second: Promise<unknown> = Promise.resolve()
    await act(async () => {
      first = result.current.mutation.mutateAsync('ex-b')
      second = result.current.mutation.mutateAsync('ex-c')
      await Promise.resolve()
    })
    // The second switch's POST has NOT gone out: it waits for the first.
    expect(log).toEqual(['stop:scope-changed', 'stop:scope-changed', 'post:ex-b'])

    await act(async () => {
      releaseFirst()
      await Promise.all([first, second])
    })

    expect(log).toEqual([
      'stop:scope-changed',
      'stop:scope-changed',
      'post:ex-b',
      'resolve:ex-b',
      'scope-reset', // the stale switch resets the stores (it changed the scope) but does not resume
      'post:ex-c',
      'resolve:ex-c',
      'scope-reset',
      'resume',
    ])
  })

  it('a stale switch that committed B still resets the stores when the latest switch is refused (4xx)', async () => {
    let releaseFirst: () => void = () => {}
    mockSwitch
      .mockImplementationOnce(id => {
        log.push(`post:${id}`)
        return new Promise(resolve => {
          releaseFirst = () => resolve(enrollment(id))
        })
      })
      .mockImplementationOnce(() => {
        log.push('post:refused')
        return Promise.reject(new StaffAssignmentError('conflict', { status: 409 }))
      })
    const { result } = await mount()

    let first: Promise<unknown> = Promise.resolve()
    let second: Promise<unknown> = Promise.resolve()
    await act(async () => {
      first = result.current.mutation.mutateAsync('ex-b')
      second = result.current.mutation.mutateAsync('ex-c').catch(() => {})
      await Promise.resolve()
    })
    await act(async () => {
      releaseFirst()
      await Promise.all([first, second])
    })

    expect(log).toEqual([
      'stop:scope-changed',
      'stop:scope-changed',
      'post:ex-b',
      'resolve:ex-b',
      'scope-reset', // the stale switch committed B: the stores must forget A even though it is stale
      'post:refused',
      'resume', // the latest switch was refused: resume (on B, where the server is)
    ])
  })
})
