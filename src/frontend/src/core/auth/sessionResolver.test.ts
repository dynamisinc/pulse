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
import { SessionExpiredError } from './sessionExpiredError'
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
      personId: null,
      world: 'participant',
      scope: 'exercise',
      isLead: false,
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
      personId: null,
      world: 'participant',
      scope: 'exercise',
      isLead: false,
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

  it('accepts main\'s pre-A1 SessionDto (7 keys) with defaults', async () => {
    mockGet.mockResolvedValue({
      data: {
        exerciseId: 'ex-0042',
        accountId: 'acct-123',
        role: 'controller',
        personaId: 'persona-x',
        actingHumanId: 'human-1',
        isReadOnly: false,
        expiresAt: FUTURE,
      },
    } as Awaited<ReturnType<typeof api.get>>)
    const s = await resolveSession()
    expect(s).toMatchObject({
      scope: 'exercise', exerciseId: 'ex-0042', role: 'controller',
      world: 'staff', isLead: false, personId: null,
    })
  })

  it('derives participant world from a participant role when world is absent', async () => {
    mockGet.mockResolvedValue(validBody({ world: undefined, scope: undefined, isLead: undefined, personId: undefined }))
    const s = await resolveSession()
    expect(s).toMatchObject({ world: 'participant', scope: 'exercise', isLead: false, personId: null })
  })

  it('still requires a string exerciseId when scope is absent', async () => {
    mockGet.mockResolvedValue(validBody({ scope: undefined, exerciseId: null }))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('rejects present-but-wrong-typed new fields', async () => {
    for (const o of [{ isLead: 'yes' }, { personId: 7 }, { world: 'other' }, { scope: 'galaxy' }]) {
      mockGet.mockResolvedValue(validBody(o))
      await expect(resolveSession()).rejects.toThrow()
    }
  })

  it('rejects a present world that contradicts the role (S-1)', async () => {
    mockGet.mockResolvedValue(validBody({ world: 'staff', role: 'participant' }))
    await expect(resolveSession()).rejects.toThrow()
    mockGet.mockResolvedValue(validBody({ world: 'participant', role: 'controller' }))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('fails closed when the role is outside the known vocabulary', async () => {
    mockGet.mockResolvedValue(validBody({ role: 'superuser' }))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('resolves an org-scope orgAdmin session with a null exerciseId and a person', async () => {
    mockGet.mockResolvedValue(validBody({
      exerciseId: null, scope: 'org', role: 'orgAdmin', world: 'staff', personId: 'person-9',
      personaId: undefined,
    }))
    const session = await resolveSession()
    expect(session.scope).toBe('org')
    expect(session.exerciseId).toBeNull()
    expect(session.role).toBe('orgAdmin')
    expect(session.personId).toBe('person-9')
    expect(session.world).toBe('staff')
  })

  it('resolves a staff exercise session carrying isLead and personId', async () => {
    mockGet.mockResolvedValue(validBody({
      role: 'controller', world: 'staff', personId: 'person-3', isLead: true,
    }))
    const session = await resolveSession()
    expect(session).toMatchObject({
      scope: 'exercise', role: 'controller', world: 'staff', personId: 'person-3', isLead: true,
    })
  })

  it.each([
    ['orgAdmin role on exercise scope', { role: 'orgAdmin' }],
    ['exercise role on org scope', { scope: 'org', exerciseId: null, role: 'controller' }],
    ['org scope still bound to an exercise', { scope: 'org', role: 'orgAdmin' }],
    ['exercise scope with a null exercise', { exerciseId: null }],
    ['unknown scope', { scope: 'global' }],
    ['unknown world', { world: 'admin' }],
    ['non-boolean isLead', { isLead: 'yes' }],
  ])('fails closed on an invalid combination: %s', async (_name, overrides) => {
    mockGet.mockResolvedValue(validBody(overrides))
    await expect(resolveSession()).rejects.toThrow()
  })

  it('fails closed when the resolved session is already expired (forces re-auth)', async () => {
    mockGet.mockResolvedValue(validBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    await expect(resolveSession()).rejects.toThrow(/expired/)
  })

  it('throws the TYPED SessionExpiredError for an expired session (W2-2), and only for that', async () => {
    mockGet.mockResolvedValue(validBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    const expired = await resolveSession().catch((e: unknown) => e)
    expect(expired).toBeInstanceOf(SessionExpiredError)
    expect(expired).toBeInstanceOf(Error)
    expect((expired as Error).name).toBe('SessionExpiredError')
    // Fixed, secret-free message.
    expect((expired as Error).message).toBe(
      'resolveSession: resolved session is already expired; re-auth required',
    )

    // A malformed body proves nothing about the sign-in: a plain Error, NOT the typed one.
    const malformed = [
      { data: null },
      { data: '<html><body>Sign in to the venue Wi-Fi</body></html>' },
      { data: {} },
      validBody({ role: 'superuser' }),
      validBody({ expiresAt: 'not-a-date' }),
    ]
    for (const response of malformed) {
      mockGet.mockResolvedValue(response as Awaited<ReturnType<typeof api.get>>)
      const error = await resolveSession().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(SessionExpiredError)
    }

    // And a failed request is passed through untouched.
    mockGet.mockRejectedValue(new Error('network down'))
    expect(await resolveSession().catch((e: unknown) => e)).not.toBeInstanceOf(SessionExpiredError)
  })

  it('propagates request failures rather than falling back to a default session', async () => {
    mockGet.mockRejectedValue(new Error('network down'))
    await expect(resolveSession()).rejects.toThrow('network down')
  })
})

describe('isSessionExpired', () => {
  const base: Session = {
    exerciseId: 'ex-1',
    scope: 'exercise',
    personId: null,
    world: 'participant',
    isLead: false,
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
