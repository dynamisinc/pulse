/**
 * features/controller/engine/services/liveEngineUsageActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE AI-generation usage read (feature: engine-telemetry-tuning,
 * story 03c; story 03a's `GET /api/engine/usage` contract):
 *  - `getUsage()` GETs `/engine/usage` and parses the frozen `EngineUsageDto`;
 *  - the default window is requested by OMITTING `windowMinutes` entirely —
 *    never sending an explicit-but-empty value (the hard-won contract fact:
 *    an empty `windowMinutes` is a `400`, not a fall-through to the default);
 *  - a non-default window is sent as an explicit `windowMinutes` query param;
 *  - a malformed 2xx body throws rather than returning a blindly-cast value —
 *    including when a nullable cost field or `unparseableEvents` is missing;
 *  - `describeUsageError()` surfaces a 400 body VERBATIM, names an unresolved
 *    401 session, distinguishes the cross-exercise 403 from story 05/07's
 *    controller-role 403, and falls back to one generic message otherwise.
 *
 * `api.get` is mocked (`vi.mock('@/core/services/api')`) so no real network
 * call is made.
 */
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import {
  describeUsageError,
  getUsage,
  MalformedEngineUsageResponseError,
  type EngineUsageDto,
} from './liveEngineUsageActions'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const error = new AxiosError('Request failed', String(status))
  error.response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
  return error
}

const VALID_DTO: EngineUsageDto = {
  window: {
    clock: 'wall-clock',
    fromWallClock: '2033-09-04T13:00:00.000Z',
    toWallClock: '2033-09-04T14:00:00.000Z',
    windowMinutes: 60,
    bucketMinutes: 1,
    bucketCount: 60,
  },
  totals: {
    calls: 2,
    inputTokens: 2000,
    outputTokens: 400,
    cacheReadInputTokens: 60,
    cacheCreationInputTokens: 8,
    latency: { totalMs: 6000, averageMs: 3000, maxMs: 4000 },
  },
  buckets: [{ startWallClock: '2033-09-04T13:59:00.000Z', calls: 2 }],
  byModel: [
    {
      provider: 'AzureOpenAI',
      model: 'gpt-5.4',
      totals: {
        calls: 2,
        inputTokens: 2000,
        outputTokens: 400,
        cacheReadInputTokens: 60,
        cacheCreationInputTokens: 8,
        latency: { totalMs: 6000, averageMs: 3000, maxMs: 4000 },
      },
      guardResults: [{ result: 'pass', calls: 1 }, { result: 're-roll', calls: 1 }],
      buckets: [{ startWallClock: '2033-09-04T13:59:00.000Z', calls: 2 }],
    },
  ],
  guardResults: [{ result: 'pass', calls: 1 }, { result: 're-roll', calls: 1 }],
  cost: {
    currency: 'USD',
    pricedTotalCost: 0,
    anyUnpriced: true,
    byModel: [
      {
        provider: 'AzureOpenAI',
        model: 'gpt-5.4',
        priced: false,
        inputCost: null,
        outputCost: null,
        cacheReadCost: null,
        cacheCreationCost: null,
        totalCost: null,
        rates: null,
      },
    ],
  },
  unparseableEvents: 0,
}

beforeEach(() => {
  getMock.mockReset()
})

describe('getUsage', () => {
  it('GETs /engine/usage with NO query params when windowMinutes is omitted (the default)', async () => {
    getMock.mockResolvedValue({ data: VALID_DTO })

    await expect(getUsage()).resolves.toEqual(VALID_DTO)
    expect(getMock).toHaveBeenCalledWith('/engine/usage', undefined)
  })

  it('sends an explicit windowMinutes query param for a non-default window', async () => {
    getMock.mockResolvedValue({ data: VALID_DTO })

    await getUsage(240)

    expect(getMock).toHaveBeenCalledWith('/engine/usage', { params: { windowMinutes: 240 } })
  })

  it('never sends an empty windowMinutes value — omission is the only way to request the default', async () => {
    getMock.mockResolvedValue({ data: VALID_DTO })

    await getUsage(undefined)

    const [, config] = getMock.mock.calls[0] as [string, unknown]
    expect(config).toBeUndefined()
  })

  it('throws MalformedEngineUsageResponseError on a malformed body', async () => {
    getMock.mockResolvedValue({ data: { nonsense: true } })

    await expect(getUsage()).rejects.toThrow(MalformedEngineUsageResponseError)
  })

  it('throws when unparseableEvents is missing — every declared field is validated, not a spot-checked subset', async () => {
    const { unparseableEvents: _omit, ...withoutUnparseableEvents } = VALID_DTO
    getMock.mockResolvedValue({ data: withoutUnparseableEvents })

    await expect(getUsage()).rejects.toThrow(MalformedEngineUsageResponseError)
  })

  it('accepts an explicit-null cost field on an unpriced model row (never confused with a missing field)', async () => {
    getMock.mockResolvedValue({ data: VALID_DTO })

    const result = await getUsage()

    expect(result.cost.byModel[0]?.priced).toBe(false)
    expect(result.cost.byModel[0]?.inputCost).toBeNull()
    expect(result.cost.byModel[0]?.rates).toBeNull()
  })

  it('accepts an empty provider/model on a byModel row (a thin/partly-null stored payload)', async () => {
    getMock.mockResolvedValue({
      data: {
        ...VALID_DTO,
        byModel: [{ ...VALID_DTO.byModel[0], provider: '', model: '' }],
      },
    })

    const result = await getUsage()

    expect(result.byModel[0]?.provider).toBe('')
    expect(result.byModel[0]?.model).toBe('')
  })
})

describe('describeUsageError', () => {
  it('surfaces a 400 string body VERBATIM (it names the windowMinutes bounds)', () => {
    const message = 'windowMinutes must be between 1 and 1440.'
    const described = describeUsageError(axiosErrorWith(400, message))

    expect(described.status).toBe(400)
    expect(described.message).toBe(message)
  })

  it('distinguishes the cross-exercise 403 from a controller-role 403', () => {
    const described = describeUsageError(axiosErrorWith(403, 'Forbidden'))

    expect(described.status).toBe(403)
    expect(described.message).toMatch(/different exercise/i)
    expect(described.message).not.toMatch(/controller-role/i)
  })

  it('names an unresolved 401 session', () => {
    const described = describeUsageError(axiosErrorWith(401, ''))

    expect(described.status).toBe(401)
    expect(described.message).toMatch(/session/i)
  })

  it('falls back to one generic message for a network failure', () => {
    const described = describeUsageError(new Error('network down'))

    expect(described.status).toBeNull()
    expect(described.message).toMatch(/could not be loaded/i)
  })

  it('surfaces the malformed-response message distinctly', () => {
    const described = describeUsageError(new MalformedEngineUsageResponseError())

    expect(described.status).toBeNull()
    expect(described.message).toMatch(/malformed/i)
  })
})
