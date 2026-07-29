/**
 * features/controller/engine/services/engineSettingsActions.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE engine settings actions (feature: autonomy-safety, story 06;
 * story 05's API contract):
 *  - `getSettings()` GETs `/engine/settings` and parses the shared DTO;
 *  - `setAutonomyDefault()`/`setTierPolicyMode()` POST the right path + body
 *    (no client `exerciseId`, COR-001) and parse the SAME DTO shape back;
 *  - a malformed 2xx body throws rather than returning a blindly-cast value;
 *  - `describeSettingsError()` surfaces a 400 body VERBATIM, rewords 403 as
 *    the read-only/role explanation, names an unresolved 401 session, and
 *    falls back to one generic message for anything else (network error,
 *    malformed response).
 *
 * `api.get`/`api.post` are mocked (`vi.mock('@/core/services/api')`) so no
 * real network call is made.
 */
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeSettingsError,
  getSettings,
  MalformedEngineSettingsResponseError,
  setAutonomyDefault,
  setTierPolicyMode,
  type EngineSettingsDto,
} from './engineSettingsActions'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))

const CTX = { actingHumanId: 'human-controller-01', timeZone: 'America/New_York' }

const VALID_DTO: EngineSettingsDto = {
  provider: 'Fake',
  tiers: [{ tier: 'Ambient', model: 'fake-ambient', deployment: 'ambient', zdrCapable: false }],
  autonomy: {
    swampedMode: false,
    generationStopped: false,
    safetyClampActive: false,
    degradedReason: null,
    exerciseDefaultLevel: 'suggest',
    effectiveLevel: 'suggest',
  },
  tierPolicyMode: 'auto',
  inMemoryState: true,
  inMemoryStateNote: 'reset on restart',
}

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

beforeEach(() => {
  getMock.mockReset()
  postMock.mockReset()
})

describe('getSettings', () => {
  it('GETs /engine/settings and returns the parsed DTO', async () => {
    getMock.mockResolvedValue({ data: VALID_DTO })

    await expect(getSettings()).resolves.toEqual(VALID_DTO)
    expect(getMock).toHaveBeenCalledWith('/engine/settings')
  })

  it('throws MalformedEngineSettingsResponseError on a malformed body', async () => {
    getMock.mockResolvedValue({ data: { nonsense: true } })

    await expect(getSettings()).rejects.toThrow(MalformedEngineSettingsResponseError)
  })
})

describe('setAutonomyDefault', () => {
  it('POSTs the autonomy-default path with actingHumanId + level + timeZone, no exerciseId', async () => {
    postMock.mockResolvedValue({ data: VALID_DTO })

    await setAutonomyDefault('delayed-auto', CTX)

    expect(postMock).toHaveBeenCalledWith('/engine/settings/autonomy-default', {
      actingHumanId: 'human-controller-01',
      level: 'delayed-auto',
      timeZone: 'America/New_York',
    })
  })

  it('resolves with the parsed DTO', async () => {
    postMock.mockResolvedValue({ data: VALID_DTO })

    await expect(setAutonomyDefault('suggest', CTX)).resolves.toEqual(VALID_DTO)
  })
})

describe('setTierPolicyMode', () => {
  it('POSTs the tier-policy path with actingHumanId + mode + timeZone, no exerciseId', async () => {
    postMock.mockResolvedValue({ data: VALID_DTO })

    await setTierPolicyMode('ambient', CTX)

    expect(postMock).toHaveBeenCalledWith('/engine/settings/tier-policy', {
      actingHumanId: 'human-controller-01',
      mode: 'ambient',
      timeZone: 'America/New_York',
    })
  })
})

describe('describeSettingsError', () => {
  it('surfaces a 400 string body VERBATIM (it names the missing config key)', () => {
    const message =
      "tier 'Ambient' has no deployment configured for this environment " +
      '(set Generation:Tiers:Ambient:Deployment). Choose a bound tier or \'auto\'.'
    const described = describeSettingsError(axiosErrorWith(400, message))

    expect(described.status).toBe(400)
    expect(described.message).toBe(message)
  })

  it('rewords a 403 as the read-only/controller-role explanation, never a bare "Forbidden"', () => {
    const described = describeSettingsError(axiosErrorWith(403, 'Forbidden'))

    expect(described.status).toBe(403)
    expect(described.message).toMatch(/controller-role staff/i)
    expect(described.message).not.toBe('Forbidden')
  })

  it('names an unresolved 401 session', () => {
    const described = describeSettingsError(axiosErrorWith(401, ''))

    expect(described.status).toBe(401)
    expect(described.message).toMatch(/session/i)
  })

  it('falls back to one generic message for a network failure', () => {
    const described = describeSettingsError(new Error('network down'))

    expect(described.status).toBeNull()
    expect(described.message).toMatch(/could not be applied/i)
  })

  it('surfaces the malformed-response message distinctly', () => {
    const described = describeSettingsError(new MalformedEngineSettingsResponseError())

    expect(described.status).toBeNull()
    expect(described.message).toMatch(/malformed/i)
  })
})
