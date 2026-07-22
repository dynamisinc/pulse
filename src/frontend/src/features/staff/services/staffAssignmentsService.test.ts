/**
 * features/staff/services/staffAssignmentsService.test.ts
 * ---------------------------------------------------------------------------
 * Story 05 (staff cross-exercise switcher) — boundary-mocked coverage for the
 * staff assignment data seam.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `getStaffAssignments`/`setActiveExercise`'s own request shape /
 * validation / error-translation logic directly (mirrors
 * `accountImportService.test.ts` / `exerciseContextResolver.test.ts`).
 * Mocking the axios client also honours the repo footgun: no async
 * GET/POST ever reaches a real sink, so a rejection can never crash Vitest
 * worker teardown.
 *
 * `axios` itself is NOT mocked — the error-translation tests construct real
 * `AxiosError`s so `axios.isAxiosError` (used inside the service) recognizes
 * them, exactly as a live 401/403/400 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  StaffAssignmentError,
  getStaffAssignments,
  setActiveExercise,
} from './staffAssignmentsService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)

const VALID_LIST_BODY = [
  { exerciseId: 'ex-0001', exerciseName: 'Coastal Surge', role: 'controller' },
  { exerciseId: 'ex-0002', exerciseName: 'Ridgeline Wildfire', role: 'evaluator' },
]

/** Builds a real AxiosError carrying a response (so `axios.isAxiosError` is true). */
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: {},
  } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
})

describe('getStaffAssignments — request shape', () => {
  it('GETs /staff/assignments', async () => {
    mockGet.mockResolvedValue({ data: VALID_LIST_BODY } as Awaited<ReturnType<typeof api.get>>)

    await getStaffAssignments()

    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls[0]?.[0]).toBe('/staff/assignments')
  })
})

describe('getStaffAssignments — response parsing', () => {
  it('returns the parsed assignment list, spanning multiple exercises', async () => {
    mockGet.mockResolvedValue({ data: VALID_LIST_BODY } as Awaited<ReturnType<typeof api.get>>)

    const result = await getStaffAssignments()

    expect(result).toEqual([
      { exerciseId: 'ex-0001', exerciseName: 'Coastal Surge', role: 'controller' },
      { exerciseId: 'ex-0002', exerciseName: 'Ridgeline Wildfire', role: 'evaluator' },
    ])
  })

  it('returns an empty list rather than throwing when the caller has no assignments', async () => {
    mockGet.mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof api.get>>)

    await expect(getStaffAssignments()).resolves.toEqual([])
  })

  it('fails closed (throws) on a malformed/non-array response body', async () => {
    mockGet.mockResolvedValue(
      { data: { oops: true } } as unknown as Awaited<ReturnType<typeof api.get>>,
    )

    await expect(getStaffAssignments()).rejects.toBeInstanceOf(StaffAssignmentError)
  })

  it('fails closed when a row is missing a required field', async () => {
    mockGet.mockResolvedValue({
      data: [{ exerciseId: 'ex-0001', role: 'controller' }],
    } as unknown as Awaited<ReturnType<typeof api.get>>)

    await expect(getStaffAssignments()).rejects.toBeInstanceOf(StaffAssignmentError)
  })

  it('fails closed on an out-of-vocabulary role rather than casting it blindly', async () => {
    mockGet.mockResolvedValue({
      data: [{ exerciseId: 'ex-0001', exerciseName: 'Coastal Surge', role: 'not-a-real-role' }],
    } as unknown as Awaited<ReturnType<typeof api.get>>)

    await expect(getStaffAssignments()).rejects.toBeInstanceOf(StaffAssignmentError)
  })
})

describe('getStaffAssignments — transport error translation', () => {
  it('translates a 401 into a StaffAssignmentError carrying status 401 (no staff session)', async () => {
    mockGet.mockRejectedValue(axiosErrorWith(401, ''))

    const caught = await getStaffAssignments().catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBe(401)
  })

  it('translates a network failure (no response) into a StaffAssignmentError with no status', async () => {
    mockGet.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await getStaffAssignments().catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBeUndefined()
  })
})

describe('setActiveExercise — request shape', () => {
  it('POSTs /staff/active-exercise with the chosen exerciseId', async () => {
    mockPost.mockResolvedValue({
      data: { exerciseId: 'ex-0002', exerciseName: 'Ridgeline Wildfire', role: 'evaluator' },
    } as Awaited<ReturnType<typeof api.post>>)

    await setActiveExercise('ex-0002')

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/staff/active-exercise')
    expect(body).toEqual({ exerciseId: 'ex-0002' })
  })
})

describe('setActiveExercise — response parsing', () => {
  it('returns the newly-active assignment', async () => {
    mockPost.mockResolvedValue({
      data: { exerciseId: 'ex-0002', exerciseName: 'Ridgeline Wildfire', role: 'evaluator' },
    } as Awaited<ReturnType<typeof api.post>>)

    const result = await setActiveExercise('ex-0002')

    expect(result).toEqual({ exerciseId: 'ex-0002', exerciseName: 'Ridgeline Wildfire', role: 'evaluator' })
  })

  it('fails closed (throws) on a malformed/empty response body', async () => {
    mockPost.mockResolvedValue({ data: { exerciseId: 'ex-0002' } } as unknown as Awaited<ReturnType<typeof api.post>>)

    await expect(setActiveExercise('ex-0002')).rejects.toBeInstanceOf(StaffAssignmentError)
  })
})

describe('setActiveExercise — transport error translation', () => {
  it('translates a 403 into status 403 (caller not assigned to that exercise)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(403, ''))

    const caught = await setActiveExercise('ex-9999').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBe(403)
  })

  it('translates a 400 into status 400 + the server reason string', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(400, 'exerciseId must be a GUID.'))

    const caught = await setActiveExercise('not-a-guid').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBe(400)
    expect((caught as StaffAssignmentError).serverMessage).toBe('exerciseId must be a GUID.')
  })

  it('translates a 401 into status 401 (no staff session)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, ''))

    const caught = await setActiveExercise('ex-0002').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBe(401)
  })

  it('translates a network failure (no response) into a StaffAssignmentError with no status', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await setActiveExercise('ex-0002').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffAssignmentError)
    expect((caught as StaffAssignmentError).status).toBeUndefined()
  })
})
