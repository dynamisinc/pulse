/**
 * features/login/services/joinService.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08 (the join page) — LIVE-path coverage of the personal-link
 * exchange seam, `signInWithLink` + `classifyJoinFailure`.
 *
 * `@/core/services/api` is mocked at the module boundary (the repo's usual
 * pattern, and the worker-teardown footgun rule: no request ever reaches a real
 * sink) and `@/core/config/mockData` is pinned to `false`, because Vitest is a
 * Vite DEV build and would otherwise take the mock path. The mock path has its
 * own file, `joinService.mock.test.ts`. `axios` itself is NOT mocked, so the
 * failure cases build real `AxiosError`s and `axios.isAxiosError` recognises them
 * exactly as a live 401 / 429 / network error would arrive.
 *
 * What is pinned here:
 *   - REQUEST SHAPE: `POST /auth/join` with `{ token }` in the BODY, and the token
 *     in no URL, no query and no header (EL-7);
 *   - STATUS MAPPING: 401 and 400 -> `link-invalid`, 429 -> `rate-limited`, no
 *     response / 5xx / anything else -> `unreachable`;
 *   - FAIL CLOSED on a body that is not a `LoginEnvelope`;
 *   - THE TOKEN NEVER LEAKS: not into any error message, `cause`, serialised form
 *     or console call, even when the transport error itself is full of it, and no
 *     server reason text survives either (anti-enumeration, NFR-009).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { ParticipantSignInError } from './participantSignInService'
import { classifyJoinFailure, signInWithLink } from './joinService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

const mockPost = vi.mocked(api.post)

const TOKEN = 'tok_7f3a9c1e-SECRET-join-link'

const ENVELOPE = { token: 'access-1', refreshToken: 'refresh-1' }

function ok(data: unknown): Awaited<ReturnType<typeof api.post>> {
  return { data } as Awaited<ReturnType<typeof api.post>>
}

/**
 * A real AxiosError the way a live failure arrives, INCLUDING the request echo
 * (`config.data` is the JSON body, token and all) and a hostile message that
 * itself contains the token: the service must not let either through.
 */
function axiosErrorWith(status: number | undefined, body: unknown = ''): AxiosError {
  const config = {
    url: '/auth/join',
    method: 'post',
    data: JSON.stringify({ token: TOKEN }),
    headers: {},
  } as unknown as InternalAxiosRequestConfig
  const response = status === undefined
    ? undefined
    : ({ status, data: body, statusText: '', headers: {}, config } as unknown as AxiosResponse)
  return new AxiosError(`Request to /auth/join with ${TOKEN} failed`, undefined, config, undefined, response)
}

async function failureOf(): Promise<unknown> {
  try {
    await signInWithLink(TOKEN)
  } catch (error) {
    return error
  }
  throw new Error('expected signInWithLink to reject')
}

beforeEach(() => {
  mockPost.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('signInWithLink — request shape (EL-7)', () => {
  it('POSTs /auth/join with { token } in the body', async () => {
    mockPost.mockResolvedValue(ok(ENVELOPE))

    await signInWithLink(TOKEN)

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/join')
    expect(body).toEqual({ token: TOKEN })
  })

  it('puts the token in no URL, query string or header', async () => {
    mockPost.mockResolvedValue(ok(ENVELOPE))

    await signInWithLink(TOKEN)

    const [url, , config] = mockPost.mock.calls[0] ?? []
    expect(String(url)).not.toContain(TOKEN)
    expect(config).not.toHaveProperty('params')
    // The only header the call sets is the one that SUPPRESSES the stored Authorization.
    expect(config?.headers).toEqual({ Authorization: false })
    expect(JSON.stringify(config)).not.toContain(TOKEN)
  })

  it('uses the live endpoint with no mock adapter when mock data is off', async () => {
    mockPost.mockResolvedValue(ok(ENVELOPE))

    await signInWithLink(TOKEN)

    const [, , config] = mockPost.mock.calls[0] ?? []
    expect(config).not.toHaveProperty('adapter')
  })

  it('bounds the exchange with a 20 s timeout so a dead network ends in "couldn\'t reach"', async () => {
    mockPost.mockResolvedValue(ok(ENVELOPE))

    await signInWithLink(TOKEN)

    const [, , config] = mockPost.mock.calls[0] ?? []
    expect(config).toMatchObject({ timeout: 20_000 })
  })
})

describe('signInWithLink — response handling', () => {
  it('returns the LoginEnvelope on a 200', async () => {
    mockPost.mockResolvedValue(ok({ ...ENVELOPE, session: { exerciseId: 'ex-1' } }))

    await expect(signInWithLink(TOKEN)).resolves.toEqual({
      ...ENVELOPE,
      session: { exerciseId: 'ex-1' },
    })
  })

  it('accepts an envelope with no refreshToken', async () => {
    mockPost.mockResolvedValue(ok({ token: 'access-1' }))

    await expect(signInWithLink(TOKEN)).resolves.toEqual({ token: 'access-1' })
  })

  it.each([
    ['an empty body', undefined],
    ['null', null],
    ['a string', 'ok'],
    ['an empty object', {}],
    ['an empty token', { token: '' }],
    ['a non-string token', { token: 123 }],
    ['a non-string refreshToken', { token: 'a', refreshToken: 5 }],
  ])('rejects %s (fail closed, never a partial envelope)', async (_label, data) => {
    mockPost.mockResolvedValue(ok(data))

    const error = await failureOf()

    expect(error).toBeInstanceOf(ParticipantSignInError)
    expect(classifyJoinFailure(error)).toBe('unreachable')
  })
})

describe('signInWithLink — a participant link only yields a participant session (Gate-1 S-4)', () => {
  const withRole = (role: unknown) => ({ ...ENVELOPE, session: { role, exerciseId: 'ex-1' } })

  it.each(['participant', 'pio'])('accepts a %s session', async role => {
    mockPost.mockResolvedValue(ok(withRole(role)))

    await expect(signInWithLink(TOKEN)).resolves.toMatchObject({ token: 'access-1' })
  })

  it.each([
    ['no session at all', { ...ENVELOPE }],
    ['a null session', { ...ENVELOPE, session: null }],
    ['a session with no role', { ...ENVELOPE, session: { exerciseId: 'ex-1' } }],
  ])('accepts an envelope with %s (only a role it can SEE is judged)', async (_label, data) => {
    mockPost.mockResolvedValue(ok(data))

    await expect(signInWithLink(TOKEN)).resolves.toMatchObject({ token: 'access-1' })
  })

  it.each(['controller', 'evaluator', 'planner', 'orgAdmin', 'superuser', '', 7, null, {}])(
    'refuses session.role %j, as a 401-shaped refusal',
    async role => {
      mockPost.mockResolvedValue(ok(withRole(role)))

      const error = await failureOf()

      expect(error).toBeInstanceOf(ParticipantSignInError)
      expect((error as ParticipantSignInError).status).toBe(401)
      expect(classifyJoinFailure(error)).toBe('link-invalid')
    },
  )

  it('echoes neither the role nor the tokens it refused, nor the join token', async () => {
    mockPost.mockResolvedValue(ok({
      token: 'staff-access',
      refreshToken: 'staff-refresh',
      session: { role: 'controller' },
    }))

    const error = (await failureOf()) as ParticipantSignInError

    const everything = `${error.message}${error.stack ?? ''}${JSON.stringify(error)}`
    expect(everything).not.toMatch(/controller|staff-access|staff-refresh/)
    expect(everything).not.toContain(TOKEN)
    expect(error.cause).toBeUndefined()
  })
})

describe('classifyJoinFailure — status mapping', () => {
  it.each([
    [401, 'link-invalid'],
    [400, 'link-invalid'],
    [429, 'rate-limited'],
    [500, 'unreachable'],
    [502, 'unreachable'],
    [503, 'unreachable'],
    [404, 'unreachable'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    mockPost.mockRejectedValue(axiosErrorWith(status))

    const error = await failureOf()

    expect(error).toBeInstanceOf(ParticipantSignInError)
    expect((error as ParticipantSignInError).status).toBe(status)
    expect(classifyJoinFailure(error)).toBe(expected)
  })

  it('maps a network error (no response) to unreachable, with no status', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(undefined))

    const error = await failureOf()

    expect((error as ParticipantSignInError).status).toBeUndefined()
    expect(classifyJoinFailure(error)).toBe('unreachable')
  })

  it('maps a non-axios failure to unreachable', async () => {
    mockPost.mockRejectedValue(new Error(`boom ${TOKEN}`))

    expect(classifyJoinFailure(await failureOf())).toBe('unreachable')
  })

  it('classifies anything that is not one of ours as unreachable', () => {
    expect(classifyJoinFailure(new Error('x'))).toBe('unreachable')
    expect(classifyJoinFailure(undefined)).toBe('unreachable')
    expect(classifyJoinFailure('401')).toBe('unreachable')
  })

  it('decides on status only: a 401 body that explains itself changes nothing', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, { message: 'link revoked by controller' }))

    const error = await failureOf()

    expect(classifyJoinFailure(error)).toBe('link-invalid')
    expect((error as ParticipantSignInError).serverMessage).toBeUndefined()
    expect((error as ParticipantSignInError).message).not.toMatch(/revoked|controller/i)
  })
})

describe('signInWithLink — the token never appears in an error or a log', () => {
  const failures: ReadonlyArray<readonly [string, () => unknown]> = [
    ['401', () => axiosErrorWith(401, `token ${TOKEN} unknown`)],
    ['429', () => axiosErrorWith(429)],
    ['500', () => axiosErrorWith(500, { detail: `failed for ${TOKEN}` })],
    ['network', () => axiosErrorWith(undefined)],
    ['plain Error', () => new Error(`boom ${TOKEN}`)],
  ]

  it.each(failures)('keeps it out of the %s error in every form', async (_label, make) => {
    mockPost.mockRejectedValue(make())

    const error = await failureOf()

    expect(error).toBeInstanceOf(ParticipantSignInError)
    const typed = error as ParticipantSignInError
    expect(typed.message).not.toContain(TOKEN)
    expect(String(typed)).not.toContain(TOKEN)
    expect(typed.stack ?? '').not.toContain(TOKEN)
    expect(JSON.stringify(typed)).not.toContain(TOKEN)
    // The axios error (and the request body it echoes) is NOT chained on.
    expect(typed.cause).toBeUndefined()
    expect(typed.serverMessage).toBeUndefined()
  })

  it('keeps it out of the malformed-body error too', async () => {
    mockPost.mockResolvedValue(ok({ unexpected: TOKEN }))

    const error = (await failureOf()) as ParticipantSignInError

    expect(`${error.message}${error.stack ?? ''}${JSON.stringify(error)}`).not.toContain(TOKEN)
  })

  it('writes nothing to the console, success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )

    mockPost.mockResolvedValueOnce(ok(ENVELOPE))
    await signInWithLink(TOKEN)
    mockPost.mockRejectedValueOnce(axiosErrorWith(401))
    await failureOf()
    mockPost.mockRejectedValueOnce(axiosErrorWith(undefined))
    await failureOf()

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
