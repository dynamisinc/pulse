/**
 * features/participantAdmin/dayWord/dayWordService.live.test.ts
 * ---------------------------------------------------------------------------
 * The OTHER side of the mock flip point (easy-login story 11): with
 * `USE_MOCK_DATA` off - a production build that does not opt in - the service
 * must NOT attach the mock adapter, so it hits the real API and fails closed
 * rather than serving a canned word (COR-001).
 *
 * `core/config/mockData` is mocked to `false` for this file; the sibling
 * `dayWordService.test.ts` covers the mock-on shape. (Mirrors the "both sides of
 * a mock-backed seam" precedent, WAVE0-REVIEW 19.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import { deleteDayWord, getDayWordStatus, putDayWord } from './dayWordService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPut = vi.mocked(api.put)
const mockDelete = vi.mocked(api.delete)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('dayWordService with USE_MOCK_DATA off', () => {
  it('GET sends no mock adapter', async () => {
    mockGet.mockResolvedValue({
      data: {
        timeZone: 'America/New_York',
        today: '2026-10-13',
        todayEndsAt: '2026-10-14T04:00:00Z',
        todaySet: false,
        replacedCount: 0,
        upcoming: [],
      },
    } as AxiosResponse)

    await getDayWordStatus()

    expect(mockGet.mock.calls[0]?.[1]).not.toHaveProperty('adapter')
  })

  it('PUT sends no mock adapter', async () => {
    mockPut.mockResolvedValue({
      data: {
        date: '2026-10-13',
        word: 'harbor-cedar-47',
        generated: true,
        replaced: false,
        setAt: '2026-10-13T13:00:00Z',
        validUntil: '2026-10-14T04:00:00Z',
      },
    } as AxiosResponse)

    await putDayWord({ date: '2026-10-13' })

    expect(mockPut.mock.calls[0]?.[2]).not.toHaveProperty('adapter')
  })

  it('DELETE sends no mock adapter', async () => {
    mockDelete.mockResolvedValue({ status: 204 } as AxiosResponse)

    await deleteDayWord('2026-10-15')

    expect(mockDelete.mock.calls[0]?.[1]).not.toHaveProperty('adapter')
  })
})
