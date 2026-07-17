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
import { resolveExerciseContext } from './exerciseContextResolver'
import { api } from './services/api'

vi.mock('./services/api', () => ({
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
    mockGet.mockResolvedValue({
      data: {
        exerciseId: 'ex-0042',
        exerciseName: 'River Flood Drill',
        timeZone: 'America/Denver',
        status: 'paused',
      },
    } as Awaited<ReturnType<typeof api.get>>)

    await expect(resolveExerciseContext()).rejects.toThrow()
  })
})
