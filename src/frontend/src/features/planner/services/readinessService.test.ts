/**
 * features/planner/services/readinessService.test.ts
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 03: boundary-mocked coverage of the readiness seam
 * (request shape, FAIL-CLOSED validation, error translation). The shared axios
 * client is mocked at the module boundary (mirrors `practiceModeService.test.ts`)
 * so no request reaches a real sink.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  ReadinessError,
  getReadiness,
  isExerciseReadiness,
  type ExerciseReadiness,
} from './readinessService'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn() } }))

const mockGet = vi.mocked(api.get)

const CONTRACT: ExerciseReadiness = {
  ready: false,
  lifecycleState: 'draft',
  blocking: [
    { id: 'controller-enrolled', label: 'Controller enrolled', status: 'ok', detail: null },
    { id: 'schedule-set', label: 'Schedule set', status: 'open', detail: 'No start time.' },
    { id: 'participant-name', label: 'Participant name', status: 'notChecked', detail: null },
  ],
  warnings: [{ id: 'some-future-check', label: 'A new check', status: 'open', detail: null }],
}

function axiosErrorWith(status: number): AxiosError {
  const response = { status, data: '', statusText: '', headers: {}, config: {} } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('getReadiness', () => {
  it('reads the staff route with no exercise parameter and returns the contract', async () => {
    mockGet.mockResolvedValue({ data: CONTRACT })

    await expect(getReadiness()).resolves.toEqual(CONTRACT)

    expect(mockGet.mock.calls[0]?.[0]).toBe('/staff/readiness')
  })

  it('accepts an id it has never heard of (the UI is payload-driven)', async () => {
    mockGet.mockResolvedValue({ data: CONTRACT })
    const data = await getReadiness()
    expect(data.warnings[0]?.id).toBe('some-future-check')
  })

  it('rejects a body that is not an object', async () => {
    for (const data of [null, 'ready', 42, []]) {
      mockGet.mockResolvedValueOnce({ data })
      await expect(getReadiness()).rejects.toBeInstanceOf(ReadinessError)
    }
  })

  it.each(['blocking', 'warnings'] as const)('rejects a body with %s missing', async key => {
    const body: Record<string, unknown> = { ...CONTRACT }
    delete body[key]
    mockGet.mockResolvedValue({ data: body })
    await expect(getReadiness()).rejects.toBeInstanceOf(ReadinessError)
  })

  it.each(['blocking', 'warnings'] as const)('rejects a non-array %s', async key => {
    mockGet.mockResolvedValue({ data: { ...CONTRACT, [key]: { id: 'x' } } })
    await expect(getReadiness()).rejects.toBeInstanceOf(ReadinessError)
  })

  it('rejects an unknown status value', async () => {
    const bad = { ...CONTRACT, blocking: [{ id: 'x', label: 'X', status: 'done', detail: null }] }
    mockGet.mockResolvedValue({ data: bad })
    await expect(getReadiness()).rejects.toBeInstanceOf(ReadinessError)
  })

  it('rejects an item with a missing field', () => {
    expect(
      isExerciseReadiness({ ...CONTRACT, blocking: [{ id: 'x', status: 'ok', detail: null }] }),
    ).toBe(false)
    expect(
      isExerciseReadiness({ ...CONTRACT, blocking: [{ id: 'x', label: 'X', status: 'ok' }] }),
    ).toBe(false)
    expect(isExerciseReadiness({ ...CONTRACT, ready: 'yes' })).toBe(false)
    expect(isExerciseReadiness({ ...CONTRACT, lifecycleState: undefined })).toBe(false)
  })

  it.each([401, 403])('translates a %s into a ReadinessError carrying the status', async status => {
    mockGet.mockRejectedValue(axiosErrorWith(status))
    await expect(getReadiness()).rejects.toMatchObject({ name: 'ReadinessError', status })
  })

  it('translates a network failure into a ReadinessError with no status', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'))
    const error = await getReadiness().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ReadinessError)
    expect((error as ReadinessError).status).toBeUndefined()
  })
})
