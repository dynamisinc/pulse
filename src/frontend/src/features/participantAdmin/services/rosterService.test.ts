/**
 * features/participantAdmin/services/rosterService.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the roster data seam, with the shared axios client
 * mocked at the module boundary (so no request reaches a real sink and a
 * rejection can never crash worker teardown). Pins: paths, bodies, params, the
 * multipart upload, runtime guards (fail closed), error mapping, and that no
 * request ever carries an exercise id or leaks a join URL.
 *
 * `axios` itself is NOT mocked: the error tests build real `AxiosError`s so
 * `axios.isAxiosError` recognises them, exactly as a live 403/409 arrives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  MAX_ROSTER_IMPORT_BYTES,
  RosterError,
  addParticipant,
  disableParticipant,
  enableParticipant,
  getRoster,
  importRoster,
  isRosterAccessDenied,
  reissueLink,
  revokeLink,
  runRosterAction,
} from './rosterService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)

const SECRET_URL = 'https://pulse.example.test/join/FAKE-SECRET-TOKEN'

function ok(data: unknown) {
  return { data } as Awaited<ReturnType<typeof api.get>>
}

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const response = { status, data, statusText: '', headers: {}, config: {} } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

const ENTRY = {
  id: 'acct-1',
  name: 'Jane Smith',
  agency: 'Fulco EM',
  role: 'EOC Liaison',
  email: 'jane@example.test',
  signInName: 'jsmith',
  exerciseRole: 'participant',
  persona: { id: 'p1', handle: 'jane_smith', displayName: 'Jane Smith', kind: 'human', autoCreated: true },
  link: {
    status: 'active',
    issuedAt: '2026-10-13T12:30:00.000Z',
    lastUsedAt: '2026-10-13T13:00:00.000Z',
    useCount: 2,
    joinUrl: SECRET_URL,
  },
  access: 'enabled',
  liveSessions: 1,
  lastSignInAt: '2026-10-13T13:00:00.000Z',
  createdAt: '2026-10-13T12:30:00.000Z',
}

const LIST = {
  participants: [ENTRY],
  joinLinksAvailable: true,
  capabilities: { emailLinks: false },
}

const ACTION_RESULT = {
  participantId: 'acct-1',
  link: { status: 'active', useCount: 0, joinUrl: SECRET_URL },
  access: 'enabled',
  sessionsEnded: 2,
}

const IMPORT_RESULT = {
  dryRun: true,
  totalRows: 2,
  createdCount: 1,
  updatedCount: 0,
  unchangedCount: 0,
  failedCount: 1,
  rows: [
    { rowNumber: 1, name: 'Jane Smith', signInName: 'jsmith', status: 'created', personaHandle: 'jane_smith', personaCreated: true },
    { rowNumber: 2, name: 'Bad Row', status: 'failed', personaCreated: false, message: 'name is required.' },
  ],
}

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
})

describe('getRoster', () => {
  it('GETs /staff/roster with no params and no exercise id', async () => {
    mockGet.mockResolvedValue(ok(LIST))
    await getRoster()

    expect(mockGet).toHaveBeenCalledTimes(1)
    const [url, config] = mockGet.mock.calls[0] ?? []
    expect(url).toBe('/staff/roster')
    expect(JSON.stringify(config?.params ?? {})).not.toMatch(/exercise/i)
  })

  it('parses the list, keeping the join URL in the data', async () => {
    mockGet.mockResolvedValue(ok(LIST))
    const list = await getRoster()

    expect(list.joinLinksAvailable).toBe(true)
    expect(list.capabilities).toEqual({ emailLinks: false })
    expect(list.participants).toHaveLength(1)
    expect(list.participants[0]).toMatchObject({
      id: 'acct-1',
      name: 'Jane Smith',
      signInName: 'jsmith',
      persona: { handle: 'jane_smith', autoCreated: true },
      link: { status: 'active', joinUrl: SECRET_URL, useCount: 2 },
      access: 'enabled',
      liveSessions: 1,
    })
  })

  it('treats an optional field sent as null as absent (omitted, never null)', async () => {
    mockGet.mockResolvedValue(ok({
      ...LIST,
      participants: [{
        ...ENTRY,
        agency: null,
        role: null,
        email: null,
        persona: null,
        lastSignInAt: null,
        link: { status: 'none', useCount: 0, issuedAt: null, joinUrl: null, needsReissue: null },
      }],
    }))
    const [entry] = (await getRoster()).participants
    expect(entry).not.toHaveProperty('agency')
    expect(entry).not.toHaveProperty('persona')
    expect(entry).not.toHaveProperty('lastSignInAt')
    expect(entry?.link).toEqual({ status: 'none', useCount: 0 })
  })

  it('parses a needsReissue link', async () => {
    mockGet.mockResolvedValue(ok({
      ...LIST,
      participants: [{ ...ENTRY, link: { status: 'active', useCount: 0, needsReissue: true } }],
    }))
    const [entry] = (await getRoster()).participants
    expect(entry?.link.needsReissue).toBe(true)
    expect(entry?.link).not.toHaveProperty('joinUrl')
  })

  it.each([
    ['not an object', 'nope'],
    ['no participants array', { joinLinksAvailable: true, capabilities: { emailLinks: false } }],
    ['no joinLinksAvailable', { participants: [], capabilities: { emailLinks: false } }],
    ['no capabilities', { participants: [], joinLinksAvailable: true }],
    ['an unknown link status', { ...LIST, participants: [{ ...ENTRY, link: { status: 'sparkly', useCount: 0 } }] }],
    ['an unknown access value', { ...LIST, participants: [{ ...ENTRY, access: 'maybe' }] }],
    ['an unknown exerciseRole', { ...LIST, participants: [{ ...ENTRY, exerciseRole: 'admin' }] }],
    ['a persona of the wrong shape', { ...LIST, participants: [{ ...ENTRY, persona: { handle: 3 } }] }],
    ['a non-string signInName', { ...LIST, participants: [{ ...ENTRY, signInName: 7 }] }],
  ])('fails closed on %s', async (_label, body) => {
    mockGet.mockResolvedValue(ok(body))
    await expect(getRoster()).rejects.toBeInstanceOf(RosterError)
  })

  it('never puts a join URL in an error message', async () => {
    mockGet.mockResolvedValue(ok({
      ...LIST,
      participants: [{ ...ENTRY, access: 'bogus' }],
    }))
    const error = await getRoster().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RosterError)
    expect(String((error as RosterError).message)).not.toContain('FAKE-SECRET-TOKEN')
    expect(String((error as RosterError).serverMessage ?? '')).not.toContain('FAKE-SECRET-TOKEN')
  })

  it('maps 403 and 401 to access-denied errors', async () => {
    mockGet.mockRejectedValue(axiosErrorWith(403, ''))
    const forbidden = await getRoster().catch((e: unknown) => e)
    expect(forbidden).toBeInstanceOf(RosterError)
    expect((forbidden as RosterError).status).toBe(403)
    expect(isRosterAccessDenied(forbidden)).toBe(true)

    mockGet.mockRejectedValue(axiosErrorWith(401, ''))
    const unauthorized = await getRoster().catch((e: unknown) => e)
    expect(isRosterAccessDenied(unauthorized)).toBe(true)
  })

  it('does not treat a 500 or a network failure as access-denied', async () => {
    mockGet.mockRejectedValue(axiosErrorWith(500, 'Boom'))
    const server = await getRoster().catch((e: unknown) => e)
    expect(isRosterAccessDenied(server)).toBe(false)
    expect((server as RosterError).serverMessage).toBe('Boom')

    mockGet.mockRejectedValue(new AxiosError('Network Error'))
    const network = await getRoster().catch((e: unknown) => e)
    expect((network as RosterError).status).toBeUndefined()
    expect(isRosterAccessDenied(network)).toBe(false)
    expect(isRosterAccessDenied(new Error('x'))).toBe(false)
  })
})

describe('addParticipant', () => {
  it('POSTs /staff/roster with the trimmed row, dropping blank optionals', async () => {
    mockPost.mockResolvedValue(ok(ENTRY))
    const created = await addParticipant({
      name: '  Jane Smith ',
      agency: ' Fulco EM ',
      role: '',
      email: '   ',
      personaHandle: undefined,
      signInName: 'jsmith',
    })

    expect(created.id).toBe('acct-1')
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/staff/roster')
    expect(body).toEqual({ name: 'Jane Smith', agency: 'Fulco EM', signInName: 'jsmith' })
    expect(JSON.stringify(body)).not.toMatch(/exercise/i)
  })

  it('surfaces the 409 "already on the roster" text', async () => {
    mockPost.mockRejectedValue(
      axiosErrorWith(409, { title: 'Conflict', detail: 'jsmith is already on the roster.' }),
    )
    const error = await addParticipant({ name: 'Jane Smith' }).catch((e: unknown) => e)
    expect((error as RosterError).status).toBe(409)
    expect((error as RosterError).serverMessage).toBe('jsmith is already on the roster.')
  })

  it('surfaces a 400 from ValidationProblemDetails (errors map) as the reason', async () => {
    mockPost.mockRejectedValue(
      axiosErrorWith(400, { title: 'One or more validation errors occurred.', errors: { Email: ['Email is not valid.'] } }),
    )
    const error = await addParticipant({ name: 'Jane Smith' }).catch((e: unknown) => e)
    expect((error as RosterError).status).toBe(400)
    expect((error as RosterError).serverMessage).toBe('Email is not valid.')
  })

  it('prefers ProblemDetails `detail` over `title`', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(400, { title: 'Bad Request', detail: 'name is required.' }))
    const error = await addParticipant({ name: ' ' }).catch((e: unknown) => e)
    expect((error as RosterError).serverMessage).toBe('name is required.')
  })

  it('fails closed on a malformed 201 body', async () => {
    mockPost.mockResolvedValue(ok({ id: 'x' }))
    await expect(addParticipant({ name: 'Jane' })).rejects.toBeInstanceOf(RosterError)
  })
})

describe('importRoster', () => {
  const file = new File(['name\nJane Smith'], 'roster.csv', { type: 'text/csv' })

  it('POSTs multipart with the single `file` part and dryRun=true', async () => {
    mockPost.mockResolvedValue(ok(IMPORT_RESULT))
    await importRoster(file, { dryRun: true })

    const [url, body, config] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/staff/roster/import')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBe(file)
    expect(config?.params).toEqual({ dryRun: true })
    expect(config?.headers).toMatchObject({ 'Content-Type': 'multipart/form-data' })
  })

  it('sends dryRun=false for a real import, and nothing about an exercise', async () => {
    mockPost.mockResolvedValue(ok({ ...IMPORT_RESULT, dryRun: false }))
    await importRoster(file, { dryRun: false })

    const config = mockPost.mock.calls[0]?.[2]
    expect(config?.params).toEqual({ dryRun: false })
    expect(JSON.stringify(config?.params)).not.toMatch(/exercise/i)
  })

  it('parses the counts and every row field', async () => {
    mockPost.mockResolvedValue(ok(IMPORT_RESULT))
    const result = await importRoster(file, { dryRun: true })

    expect(result).toMatchObject({
      dryRun: true,
      totalRows: 2,
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
    })
    expect(result.rows[0]).toEqual({
      rowNumber: 1,
      name: 'Jane Smith',
      signInName: 'jsmith',
      status: 'created',
      personaHandle: 'jane_smith',
      personaCreated: true,
    })
    expect(result.rows[1]).toEqual({
      rowNumber: 2,
      name: 'Bad Row',
      status: 'failed',
      personaCreated: false,
      message: 'name is required.',
    })
  })

  it('fails closed on an unknown row status or missing counts', async () => {
    mockPost.mockResolvedValue(ok({ ...IMPORT_RESULT, rows: [{ ...IMPORT_RESULT.rows[0], status: 'meh' }] }))
    await expect(importRoster(file, { dryRun: true })).rejects.toBeInstanceOf(RosterError)

    mockPost.mockResolvedValue(ok({ dryRun: true, rows: [] }))
    await expect(importRoster(file, { dryRun: true })).rejects.toBeInstanceOf(RosterError)
  })

  it('carries the server reason on a 400', async () => {
    mockPost.mockRejectedValue(
      axiosErrorWith(400, 'the CSV file exceeds the maximum size of 1048576 bytes.'),
    )
    const error = await importRoster(file, { dryRun: false }).catch((e: unknown) => e)
    expect((error as RosterError).status).toBe(400)
    expect((error as RosterError).serverMessage).toBe('the CSV file exceeds the maximum size of 1048576 bytes.')
  })

  it('exposes the 1 MB limit the picker checks against', () => {
    expect(MAX_ROSTER_IMPORT_BYTES).toBe(1024 * 1024)
  })
})

describe('the four per-participant actions', () => {
  it.each([
    ['reissue', reissueLink, '/staff/roster/acct-1/link/reissue'],
    ['revoke', revokeLink, '/staff/roster/acct-1/link/revoke'],
    ['disable', disableParticipant, '/staff/roster/acct-1/disable'],
    ['enable', enableParticipant, '/staff/roster/acct-1/enable'],
  ] as const)('%s POSTs %s with no body', async (_kind, fn, path) => {
    mockPost.mockResolvedValue(ok(ACTION_RESULT))
    await fn('acct-1')

    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe(path)
    expect(body).toBeUndefined()
  })

  it('runRosterAction dispatches the same paths', async () => {
    mockPost.mockResolvedValue(ok(ACTION_RESULT))
    await runRosterAction('revoke', 'acct-1')
    expect(mockPost.mock.calls[0]?.[0]).toBe('/staff/roster/acct-1/link/revoke')
  })

  it('URL-encodes the participant id', async () => {
    mockPost.mockResolvedValue(ok(ACTION_RESULT))
    await disableParticipant('a/b c')
    expect(mockPost.mock.calls[0]?.[0]).toBe('/staff/roster/a%2Fb%20c/disable')
  })

  it('returns sessionsEnded, the access state and the link', async () => {
    mockPost.mockResolvedValue(ok(ACTION_RESULT))
    const result = await reissueLink('acct-1')
    expect(result.sessionsEnded).toBe(2)
    expect(result.access).toBe('enabled')
    expect(result.link.status).toBe('active')
    expect(result.participantId).toBe('acct-1')
  })

  it('maps a 404 (unknown or cross-exercise id, indistinguishable) to a RosterError', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(404, { title: 'Not Found', detail: 'No such participant.' }))
    const error = await enableParticipant('nope').catch((e: unknown) => e)
    expect((error as RosterError).status).toBe(404)
    expect((error as RosterError).serverMessage).toBe('No such participant.')
  })

  it('fails closed on a malformed result', async () => {
    mockPost.mockResolvedValue(ok({ participantId: 'acct-1' }))
    await expect(reissueLink('acct-1')).rejects.toBeInstanceOf(RosterError)
  })
})
