/**
 * core/exerciseContextResolver.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the Wave-0 mock resolver (COR-001, COR-004 /
 * XC-001): a failed or empty/malformed response must fail closed (reject)
 * rather than resolving to a default, partial, or aggregate scope.
 *
 * The shared axios client (`core/services/api.ts`) is mocked at the module
 * boundary so these tests exercise `resolveExerciseContext`'s own
 * validation/error-propagation logic directly, without depending on the
 * hardcoded canned adapter or a real network layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EXERCISE_STATUSES,
  isExerciseStatus,
  resolveExerciseContext,
} from './exerciseContextResolver'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

const mockGet = vi.mocked(api.get)

describe('resolveExerciseContext', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves a single, well-formed exercise scope from a valid response', async () => {
    mockGet.mockResolvedValue({
      data: {
        exerciseId: 'ex-0042',
        exerciseName: 'River Flood Drill',
        timeZone: 'America/Denver',
        status: 'scheduled',
      },
    } as Awaited<ReturnType<typeof api.get>>)

    const scope = await resolveExerciseContext()

    expect(scope).toEqual({
      exerciseId: 'ex-0042',
      exerciseName: 'River Flood Drill',
      timeZone: 'America/Denver',
      status: 'scheduled',
    })
  })

  it('fails closed when the response body is empty', async () => {
    mockGet.mockResolvedValue({ data: null } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).rejects.toThrow()
  })

  it('fails closed when a required field is missing', async () => {
    mockGet.mockResolvedValue({
      data: {
        exerciseName: 'No Id Drill',
        timeZone: 'America/Denver',
        status: 'active',
      },
    } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).rejects.toThrow()
  })

  it('fails closed when a required field is an empty string', async () => {
    mockGet.mockResolvedValue({
      data: {
        exerciseId: '',
        exerciseName: 'Drill',
        timeZone: 'America/Denver',
        status: 'active',
      },
    } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).rejects.toThrow()
  })

  it('propagates request failures rather than falling back to a default scope', async () => {
    mockGet.mockRejectedValue(new Error('network down'))

    await expect(resolveExerciseContext()).rejects.toThrow('network down')
  })

  it('fails closed when status is outside the known set', async () => {
    // NOTE: this used to use 'paused', which story 01a's Option-B widening made
    // VALID. The case still has to be covered, so it now uses a status nothing
    // in the stack may ever coin.
    mockGet.mockResolvedValue({
      data: {
        exerciseId: 'ex-0042',
        exerciseName: 'River Flood Drill',
        timeZone: 'America/Denver',
        status: 'in_progress',
      },
    } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).rejects.toThrow()
  })

  // The transitional superset, end to end: every literal the backend may serve
  // must resolve, or the participant world blanks on a backend-ahead deploy.
  it.each(EXERCISE_STATUSES)('resolves a scope whose status is "%s"', async status => {
    mockGet.mockResolvedValue({
      data: {
        exerciseId: 'ex-0042',
        exerciseName: 'River Flood Drill',
        timeZone: 'America/Denver',
        status,
      },
    } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).resolves.toEqual({
      exerciseId: 'ex-0042',
      exerciseName: 'River Flood Drill',
      timeZone: 'America/Denver',
      status,
    })
  })
})

/**
 * Story exercise-configuration/01a — the split-deploy guard (COR-032 Option B,
 * Tier-2 signed off). `isExerciseStatus` is the one place a wire `status` is
 * validated, and it FAILS CLOSED: an unknown value resolves nothing and the
 * participant shell renders nothing. So it must accept the TRANSITIONAL
 * SUPERSET — the COR-032 six AND the legacy four — before any backend emits a
 * new value, and must still reject everything else.
 */
describe('isExerciseStatus — the transitional superset (COR-032 Option B)', () => {
  const COR_032_STATUSES = ['build', 'staged', 'live', 'paused', 'completed', 'archived'] as const
  const LEGACY_STATUSES = ['scheduled', 'active', 'complete', 'archived'] as const

  it.each(COR_032_STATUSES)('accepts the COR-032 literal "%s"', status => {
    expect(isExerciseStatus(status)).toBe(true)
  })

  it.each(LEGACY_STATUSES)('still accepts the legacy literal "%s"', status => {
    // Deliberate: keeping the legacy four valid is what makes the deploy order
    // safe in BOTH directions. Retiring them is a documented follow-up.
    expect(isExerciseStatus(status)).toBe(true)
  })

  it('exposes exactly the ten literals of the transitional superset', () => {
    expect([...EXERCISE_STATUSES].sort()).toEqual(
      [...new Set([...COR_032_STATUSES, ...LEGACY_STATUSES])].sort(),
    )
  })

  it.each([
    // Coined variants the story docs explicitly forbid...
    'Build',
    'in_progress',
    'ended',
    // ...the legacy/new spelling confusion in both directions...
    'Completed',
    'LIVE',
    // ...and plain garbage.
    '',
    'not-a-status',
  ])('rejects "%s"', value => {
    expect(isExerciseStatus(value)).toBe(false)
  })

  it.each([undefined, null, 42, {}, ['live']])('rejects the non-string %p', value => {
    expect(isExerciseStatus(value)).toBe(false)
  })
})
