/**
 * core/auth/sessionResolver.test.ts
 * ---------------------------------------------------------------------------
 * Boundary-mocked coverage for the mock session resolver (COR-012): the shared
 * axios client is mocked at the module boundary so these tests exercise
 * `resolveSession`'s own validation / fail-closed logic directly (a malformed,
 * empty, wrong-role, or already-expired body must reject, never resolve to a
 * default/expired session). The un-mocked shipped path is covered separately in
 * `sessionResolver.default.test.ts` (Wave-0 precedent 19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveSession, isSessionExpired, type Session } from './sessionResolver'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

const mockGet = vi.mocked(api.get)

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      exerciseId: 'ex-0042',
      accountId: 'acct-123',
      role: 'pio',
      personaId: 'persona-x',
      actingHumanId: 'human-1',
      isReadOnly: false,
      expiresAt: FUTURE,
      ...overrides,
    },
  } as Awaited<ReturnType<typeof api.get>>
}

describe('resolveSession', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('resolves a single well-formed session bound to one exercise + account', async () => {
    mockGet.mockResolvedValue(validBody())

    const session = await resolveSession()

    expect(session).toEqual({
      exerciseId: 'ex-0042',
      accountId: 'acct-123',
      role: 'pio',
      personaId: 'persona-x',
      actingHumanId: 'human-1',
      isReadOnly: false,
      expiresAt: FUTURE,
    })
  })

  it('fails closed when the response body is empty', async () => {
    mockGet.mockResolvedValue({ data: null } as Awaited<ReturnType<typeof api.get>>)
    await expect(resolveSession()).rejects.toThrow()
  })

  it('fails closed when a required field is missing', async () => {
    mockGet.mockResolvedValue(validBody({ actingHumanId: undefined }))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('fails closed when the role is outside the known vocabulary', async () => {
    mockGet.mockResolvedValue(validBody({ role: 'superuser' }))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('fails closed when the resolved session is already expired (forces re-auth)', async () => {
    mockGet.mockResolvedValue(validBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    await expect(resolveSession()).rejects.toThrow(/expired/)
  })

  it('propagates request failures rather than falling back to a default session', async () => {
    mockGet.mockRejectedValue(new Error('network down'))
    await expect(resolveSession()).rejects.toThrow('network down')
  })
})

describe('isSessionExpired', () => {
  const base: Session = {
    exerciseId: 'ex-1',
    accountId: 'acct-1',
    role: 'participant',
    actingHumanId: 'human-1',
    isReadOnly: false,
    expiresAt: FUTURE,
  }

  it('is false for a session whose expiry is in the future', () => {
    expect(isSessionExpired(base, new Date())).toBe(false)
  })

  it('is true for a session whose expiry is in the past', () => {
    const expired = { ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }
    expect(isSessionExpired(expired, new Date())).toBe(true)
  })

  it('treats an unparseable expiry as expired (fail-closed)', () => {
    const bad = { ...base, expiresAt: 'not-a-date' }
    expect(isSessionExpired(bad, new Date())).toBe(true)
  })
})
