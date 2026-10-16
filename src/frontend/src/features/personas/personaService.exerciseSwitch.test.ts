/**
 * features/personas/personaService.exerciseSwitch.test.ts
 * ---------------------------------------------------------------------------
 * The staff persona store is keyed by the ACTIVE EXERCISE (demo-feedback 24,
 * #542; #450 F-1; COR-001 — no cross-exercise bleed in the UI).
 *
 * The console does not remount on an exercise switch: the scope commits in
 * place, so `useStaffPersonas()` stays mounted while `useExerciseContext()`
 * starts reporting a different exercise. Asserted here, at the hook:
 *
 *  - switching A -> B discards A's list in the SAME render (empty + loading,
 *    before any read resolves) and loads B's list without a remount;
 *  - a response for A that lands after the switch is DROPPED — whether it
 *    lands before or after B's own response;
 *  - a FAILED first read for B leaves the list empty (never A's list);
 *  - `invalidatePersonas()` (persona edit, Live world's unknown-author refresh)
 *    still re-reads, keeping the current exercise's list on screen meanwhile;
 *  - a list whose personas carry ANOTHER exercise's id is dropped: the hook
 *    reads as unloaded rather than show it (Gate-1 L-2);
 *  - the participant `usePersonas()` read is keyed the same way (Gate-1 M-1);
 *  - with no exercise provider above it the hook still works, unkeyed.
 *
 * `useOptionalExerciseContext` is mocked at its module boundary with a mutable scope,
 * and `api.get` is driven with deferred promises so arrival order is explicit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '@/core/services/api'
import { invalidatePersonas, usePersonas, useStaffPersonas } from './personaService'
import type { StaffPersona } from './types'

const scope = vi.hoisted(() => ({ exerciseId: 'ex-a', missingProvider: false }))

vi.mock('@/core/exerciseContext/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext/exerciseContext')>()),
  useOptionalExerciseContext: () =>
    scope.missingProvider
      ? undefined
      : { exerciseId: scope.exerciseId, exerciseName: 'Ex', timeZone: 'UTC', status: 'live' },
}))

function staffPersona(id: string, exerciseId: string, displayName = `Persona ${id}`): StaffPersona {
  return {
    id,
    exerciseId,
    templateId: `tmpl-${id}`,
    displayName,
    handle: id.replace(/[^a-z0-9]/gi, ''),
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#334455',
    initials: 'PP',
    audienceBand: 'micro',
    followerCount: 1,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

const A_PERSONAS = [staffPersona('a-1', 'ex-a'), staffPersona('a-2', 'ex-a')]
const B_PERSONAS = [staffPersona('b-1', 'ex-b')]

type GetResult = Awaited<ReturnType<typeof api.get>>

interface PendingRead {
  readonly exerciseId: string
  resolve(data: unknown): void
  reject(error: unknown): void
}

/** Every `/personas` read, in issue order, each settled explicitly by the test. */
let reads: PendingRead[] = []

beforeEach(() => {
  scope.exerciseId = 'ex-a'
  scope.missingProvider = false
  reads = []
  vi.spyOn(api, 'get').mockImplementation(() => new Promise<GetResult>((resolve, reject) => {
    reads.push({
      // The exercise the hook was rendering under when it issued the read.
      exerciseId: scope.exerciseId,
      resolve: data => resolve({ data } as GetResult),
      reject,
    })
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function read(index: number): PendingRead {
  const pending = reads[index]
  if (!pending) throw new Error(`no /personas read #${index} was issued`)
  return pending
}

function ids(personas: readonly StaffPersona[]): string[] {
  return personas.map(persona => persona.id)
}

describe('useStaffPersonas — keyed by the active exercise', () => {
  it('switching A -> B discards A in the same render and loads B without a remount', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    expect(reads).toHaveLength(1)
    await act(async () => read(0).resolve(A_PERSONAS))
    expect(ids(result.current.personas)).toEqual(['a-1', 'a-2'])
    expect(result.current.loading).toBe(false)

    scope.exerciseId = 'ex-b'
    rerender()

    // Nothing of A survives into B's first render, even before B's read lands.
    expect(result.current.personas).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(reads).toHaveLength(2)
    expect(read(1).exerciseId).toBe('ex-b')

    await act(async () => read(1).resolve(B_PERSONAS))
    expect(ids(result.current.personas)).toEqual(['b-1'])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it('drops a late A response that lands AFTER B has loaded', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    scope.exerciseId = 'ex-b'
    rerender()
    expect(reads).toHaveLength(2)

    await act(async () => read(1).resolve(B_PERSONAS))
    await act(async () => read(0).resolve(A_PERSONAS))

    expect(ids(result.current.personas)).toEqual(['b-1'])
  })

  it('drops a late A response that lands while B is still loading — never A under B', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    scope.exerciseId = 'ex-b'
    rerender()

    await act(async () => read(0).resolve(A_PERSONAS))
    expect(result.current.personas).toEqual([])
    expect(result.current.loading).toBe(true)

    await act(async () => read(1).resolve(B_PERSONAS))
    expect(ids(result.current.personas)).toEqual(['b-1'])
  })

  it('a failed first read for B leaves the list EMPTY with the error, never A\'s list', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(A_PERSONAS))

    scope.exerciseId = 'ex-b'
    rerender()
    await act(async () => read(1).reject(new Error('network down')))

    expect(result.current.personas).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('switching back to A reads A again rather than reviving the old list', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(A_PERSONAS))
    scope.exerciseId = 'ex-b'
    rerender()
    await act(async () => read(1).resolve(B_PERSONAS))

    scope.exerciseId = 'ex-a'
    rerender()
    expect(result.current.personas).toEqual([])
    expect(reads).toHaveLength(3)
    await act(async () => read(2).resolve(A_PERSONAS))
    expect(ids(result.current.personas)).toEqual(['a-1', 'a-2'])
  })
})

describe('a list for another exercise is dropped (Gate-1 L-2)', () => {
  it('does not show A\'s personas when the read under B answers with them', async () => {
    scope.exerciseId = 'ex-b'
    const { result } = renderHook(() => useStaffPersonas())
    // The server's session is still (or already) in A: its answer is not B's cast.
    await act(async () => read(0).resolve(A_PERSONAS))

    expect(result.current.personas).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it('drops a mixed list too: one foreign persona is enough', async () => {
    scope.exerciseId = 'ex-b'
    const { result } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve([...B_PERSONAS, staffPersona('a-9', 'ex-a')]))

    expect(result.current.personas).toEqual([])
  })

  it('a refetch answered for another exercise empties the list instead of swapping it in', async () => {
    scope.exerciseId = 'ex-b'
    const { result } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(B_PERSONAS))
    expect(ids(result.current.personas)).toEqual(['b-1'])

    act(() => invalidatePersonas())
    await act(async () => read(1).resolve(A_PERSONAS))

    expect(result.current.personas).toEqual([])
    expect(result.current.loading).toBe(true)
  })

  it('accepts personas that carry no exerciseId (the wire may omit it)', async () => {
    scope.exerciseId = 'ex-b'
    const { result } = renderHook(() => useStaffPersonas())
    const { exerciseId: _omitted, ...withoutExercise } = staffPersona('b-7', 'ex-b')
    await act(async () => read(0).resolve([withoutExercise]))

    expect(ids(result.current.personas)).toEqual(['b-7'])
  })
})

describe('usePersonas (participant projection) — keyed the same way (Gate-1 M-1)', () => {
  it('switching A -> B discards A and loads B', async () => {
    const { result, rerender } = renderHook(() => usePersonas())
    await act(async () => read(0).resolve(A_PERSONAS))
    expect(result.current.personas.map(p => p.id)).toEqual(['a-1', 'a-2'])

    scope.exerciseId = 'ex-b'
    rerender()
    expect(result.current.personas).toEqual([])

    await act(async () => read(1).resolve(B_PERSONAS))
    expect(result.current.personas.map(p => p.id)).toEqual(['b-1'])
    // Still the participant projection: no archetype tell.
    expect(result.current.personas[0]).not.toHaveProperty('personaType')
  })
})

describe('useStaffPersonas — invalidatePersonas() still re-reads', () => {
  it('re-reads the CURRENT exercise and keeps its list on screen until the new one lands', async () => {
    const { result, rerender } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(A_PERSONAS))
    scope.exerciseId = 'ex-b'
    rerender()
    await act(async () => read(1).resolve(B_PERSONAS))

    act(() => invalidatePersonas())
    expect(reads).toHaveLength(3)
    expect(read(2).exerciseId).toBe('ex-b')
    // A refetch is not a switch: the list stays, no loading flash.
    expect(ids(result.current.personas)).toEqual(['b-1'])
    expect(result.current.loading).toBe(false)

    await act(async () => read(2).resolve([staffPersona('b-1', 'ex-b', 'Edited Name')]))
    expect(result.current.personas[0]?.displayName).toBe('Edited Name')
  })

  it('a failed refetch keeps the current exercise\'s list and reports the error', async () => {
    const { result } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(A_PERSONAS))

    act(() => invalidatePersonas())
    await act(async () => read(1).reject(new Error('transient')))

    expect(ids(result.current.personas)).toEqual(['a-1', 'a-2'])
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('useStaffPersonas — outside an exercise provider', () => {
  it('still resolves (unkeyed) when no provider is mounted above it', async () => {
    scope.missingProvider = true
    const { result } = renderHook(() => useStaffPersonas())
    await act(async () => read(0).resolve(A_PERSONAS))

    expect(ids(result.current.personas)).toEqual(['a-1', 'a-2'])
    act(() => invalidatePersonas())
    await waitFor(() => expect(reads).toHaveLength(2))
  })
})
