/**
 * features/login/services/participantSignInService.test.ts
 * ---------------------------------------------------------------------------
 * Story 02 (participant sign-in) + easy-login story 09 ("Today's word") —
 * boundary-mocked coverage for the participant sign-in data seam.
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `staffAssignmentsService.test.ts`) so these tests exercise
 * `signInWithPassword`/`signInWithSharedCode`/`signInWithDayWord`'s own request
 * shape / validation / error-translation logic directly, with no async request
 * ever reaching a real sink (the repo's own worker-teardown footgun).
 * `@/core/config/mockData` is pinned to `false` so `signInWithDayWord` takes
 * its LIVE path here (a plain two-argument `api.post`, no adapter); its mock
 * adapter has its own file, `participantSignInService.mock.test.ts`.
 *
 * `axios` itself is NOT mocked — the error-translation tests construct real
 * `AxiosError`s so `axios.isAxiosError` (used inside the service) recognizes
 * them, exactly as a live 401 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  ParticipantSignInError,
  isRateLimitedSignInError,
  isUnauthorizedSignInError,
  signInWithDayWord,
  signInWithPassword,
  signInWithSharedCode,
} from './participantSignInService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
}))

const mockPost = vi.mocked(api.post)

/** Builds a real AxiosError carrying a response (so `axios.isAxiosError` is true). */
function axiosErrorWith(status: number, data: unknown = ''): AxiosError {
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
  mockPost.mockReset()
})

describe('signInWithPassword — request shape', () => {
  it('POSTs /auth/login with the given username + password', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123' },
    } as Awaited<ReturnType<typeof api.post>>)

    await signInWithPassword({ username: 'dreyes', password: 'correct-password' })

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/login')
    expect(body).toEqual({ username: 'dreyes', password: 'correct-password' })
  })
})

describe('signInWithPassword — response parsing', () => {
  it('returns the parsed envelope on success', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456' },
    } as Awaited<ReturnType<typeof api.post>>)

    const result = await signInWithPassword({ username: 'dreyes', password: 'correct-password' })

    expect(result).toEqual({ token: 'tok-123', refreshToken: 'ref-456' })
  })

  it('accepts an envelope with no refreshToken (a shared/read-only session shape)', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123' },
    } as Awaited<ReturnType<typeof api.post>>)

    await expect(
      signInWithPassword({ username: 'dreyes', password: 'correct-password' }),
    ).resolves.toEqual({ token: 'tok-123' })
  })

  it('fails closed (throws) on a malformed/empty response body', async () => {
    mockPost.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof api.post>>)

    await expect(
      signInWithPassword({ username: 'dreyes', password: 'x' }),
    ).rejects.toBeInstanceOf(ParticipantSignInError)
  })
})

describe('signInWithPassword — transport error translation', () => {
  it('translates a 401 into a ParticipantSignInError carrying status 401', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    const caught = await signInWithPassword({ username: 'dreyes', password: 'wrong' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBe(401)
    expect(isUnauthorizedSignInError(caught)).toBe(true)
  })

  it('translates a network failure (no response) into an error with no status', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await signInWithPassword({ username: 'dreyes', password: 'x' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBeUndefined()
    expect(isUnauthorizedSignInError(caught)).toBe(false)
  })
})

describe('signInWithSharedCode — request shape', () => {
  it('POSTs /auth/shared with only the shared password', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-999' },
    } as Awaited<ReturnType<typeof api.post>>)

    await signInWithSharedCode({ password: 'shared-code-123' })

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/shared')
    expect(body).toEqual({ password: 'shared-code-123' })
  })
})

describe('signInWithSharedCode — response parsing', () => {
  it('returns the parsed envelope on success', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-999', refreshToken: 'ref-999' },
    } as Awaited<ReturnType<typeof api.post>>)

    const result = await signInWithSharedCode({ password: 'shared-code-123' })

    expect(result).toEqual({ token: 'tok-999', refreshToken: 'ref-999' })
  })

  it('fails closed (throws) on a malformed/empty response body', async () => {
    mockPost.mockResolvedValue(
      { data: { oops: true } } as unknown as Awaited<ReturnType<typeof api.post>>,
    )

    await expect(signInWithSharedCode({ password: 'x' })).rejects.toBeInstanceOf(
      ParticipantSignInError,
    )
  })
})

describe('signInWithSharedCode — transport error translation', () => {
  it('translates a 401 into a ParticipantSignInError carrying status 401', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    const caught = await signInWithSharedCode({ password: 'wrong-code' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBe(401)
    expect(isUnauthorizedSignInError(caught)).toBe(true)
  })
})

describe('isUnauthorizedSignInError — never distinguishes reason (NFR-009)', () => {
  it('is true for a 401 regardless of any server-supplied reason text', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, { message: 'no such handle' }))
    const caught = await signInWithPassword({ username: 'nobody', password: 'x' }).catch(
      (error: unknown) => error,
    )
    expect(isUnauthorizedSignInError(caught)).toBe(true)
  })

  it('is false for a non-401 error (e.g. a 500 or network failure)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(500, { message: 'server exploded' }))
    const caught = await signInWithPassword({ username: 'dreyes', password: 'x' }).catch(
      (error: unknown) => error,
    )
    expect(isUnauthorizedSignInError(caught)).toBe(false)
  })

  it('is false for a plain non-ParticipantSignInError value', () => {
    expect(isUnauthorizedSignInError(new Error('boom'))).toBe(false)
    expect(isUnauthorizedSignInError('not an error')).toBe(false)
  })
})

describe('signInWithDayWord — request shape (easy-login 09-AC3)', () => {
  it('POSTs /auth/word with exactly { signInName, word } and no mock adapter on the live path', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-word' },
    } as Awaited<ReturnType<typeof api.post>>)

    await signInWithDayWord({ signInName: 'dreyes', word: 'bluebird' })

    expect(mockPost).toHaveBeenCalledTimes(1)
    const call = mockPost.mock.calls[0] ?? []
    expect(call).toHaveLength(2)
    const [url, body] = call
    expect(url).toBe('/auth/word')
    expect(body).toEqual({ signInName: 'dreyes', word: 'bluebird' })
    expect(Object.keys(body as object).sort()).toEqual(['signInName', 'word'])
  })

  it('sends the values exactly as given - no trimming, case-folding or stripping (EL-9: the server normalises)', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-word' },
    } as Awaited<ReturnType<typeof api.post>>)

    await signInWithDayWord({ signInName: ' D.Reyes ', word: ' Café-7 ' })

    const [, body] = mockPost.mock.calls[0] ?? []
    expect(body).toEqual({ signInName: ' D.Reyes ', word: ' Café-7 ' })
  })

  it('puts neither the name nor the word in the URL', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-word' },
    } as Awaited<ReturnType<typeof api.post>>)

    await signInWithDayWord({ signInName: 'dreyes', word: 'bluebird' })

    const [url] = mockPost.mock.calls[0] ?? []
    expect(String(url)).not.toContain('dreyes')
    expect(String(url)).not.toContain('bluebird')
  })
})

describe('signInWithDayWord — response parsing', () => {
  it('returns the parsed envelope on success', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-word', refreshToken: 'ref-word' },
    } as Awaited<ReturnType<typeof api.post>>)

    await expect(
      signInWithDayWord({ signInName: 'dreyes', word: 'bluebird' }),
    ).resolves.toEqual({ token: 'tok-word', refreshToken: 'ref-word' })
  })

  it('accepts an envelope with no refreshToken', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-word' },
    } as Awaited<ReturnType<typeof api.post>>)

    await expect(
      signInWithDayWord({ signInName: 'dreyes', word: 'bluebird' }),
    ).resolves.toEqual({ token: 'tok-word' })
  })

  it.each([
    ['an empty object', {}],
    ['an empty token', { token: '' }],
    ['a non-string token', { token: 42 }],
    ['a non-string refreshToken', { token: 'tok', refreshToken: 7 }],
    ['null', null],
    ['a string', 'ok'],
  ])('fails closed (throws) on %s', async (_label, data) => {
    mockPost.mockResolvedValue({ data } as unknown as Awaited<ReturnType<typeof api.post>>)

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'x' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBeUndefined()
  })
})

describe('signInWithDayWord — status mapping', () => {
  it('translates a 401 into a ParticipantSignInError carrying status 401', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'wrong' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBe(401)
    expect(isUnauthorizedSignInError(caught)).toBe(true)
    expect(isRateLimitedSignInError(caught)).toBe(false)
  })

  it('translates a 429 into status 429 (rate limited), not "unauthorized"', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(429))

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'x' }).catch(
      (error: unknown) => error,
    )

    expect((caught as ParticipantSignInError).status).toBe(429)
    expect(isRateLimitedSignInError(caught)).toBe(true)
    expect(isUnauthorizedSignInError(caught)).toBe(false)
  })

  it.each([400, 500, 503])('keeps status %i as neither unauthorized nor rate-limited', async status => {
    mockPost.mockRejectedValue(axiosErrorWith(status))

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'x' }).catch(
      (error: unknown) => error,
    )

    expect((caught as ParticipantSignInError).status).toBe(status)
    expect(isUnauthorizedSignInError(caught)).toBe(false)
    expect(isRateLimitedSignInError(caught)).toBe(false)
  })

  it('translates a network failure (no response) into an error with no status', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'x' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBeUndefined()
    expect(isUnauthorizedSignInError(caught)).toBe(false)
    expect(isRateLimitedSignInError(caught)).toBe(false)
  })

  it('translates a non-axios throw into an error with no status', async () => {
    mockPost.mockRejectedValue(new TypeError('boom'))

    const caught = await signInWithDayWord({ signInName: 'dreyes', word: 'x' }).catch(
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(ParticipantSignInError)
    expect((caught as ParticipantSignInError).status).toBeUndefined()
  })
})

describe('signInWithDayWord - status only, never the word (NFR-004 / NFR-009)', () => {
  const SECRET_WORD = 'zq-secret-word-7'
  const NAME = 'quentin.test'

  /** An axios error shaped like a real one: its `config.data` holds the request body. */
  function axiosErrorEchoing(status: number): AxiosError {
    const response = {
      status,
      data: { message: `bad word ${SECRET_WORD} for ${NAME}`, detail: SECRET_WORD },
      statusText: '',
      headers: {},
      config: {},
    } as unknown as AxiosResponse
    const config = {
      data: JSON.stringify({ signInName: NAME, word: SECRET_WORD }),
    } as unknown as AxiosError['config']
    return new AxiosError(`Request failed with ${SECRET_WORD}`, undefined, config, undefined, response)
  }

  it.each([401, 429, 500])(
    'a %i carries only its status: no server text, no cause, nothing containing the word',
    async status => {
      mockPost.mockRejectedValue(axiosErrorEchoing(status))

      const caught = await signInWithDayWord({ signInName: NAME, word: SECRET_WORD }).catch(
        (error: unknown) => error,
      )

      expect(caught).toBeInstanceOf(ParticipantSignInError)
      const error = caught as ParticipantSignInError
      expect(error.status).toBe(status)
      expect(error).not.toHaveProperty('serverMessage')
      expect(error.cause).toBeUndefined()
      expect(error.message).not.toContain(SECRET_WORD)
      expect(error.message).not.toContain(NAME)
      // ...and serialising or printing the error cannot leak it either.
      expect(String(error)).not.toContain(SECRET_WORD)
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(SECRET_WORD)
    },
  )

  it('a malformed-response error does not contain the word either', async () => {
    mockPost.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof api.post>>)

    const caught = await signInWithDayWord({ signInName: NAME, word: SECRET_WORD }).catch(
      (error: unknown) => error,
    )

    expect((caught as ParticipantSignInError).message).not.toContain(SECRET_WORD)
  })

  it('writes nothing to the console on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )

    mockPost.mockResolvedValueOnce({
      data: { token: 'tok-word' },
    } as Awaited<ReturnType<typeof api.post>>)
    await signInWithDayWord({ signInName: NAME, word: SECRET_WORD })
    mockPost.mockRejectedValueOnce(axiosErrorEchoing(401))
    await signInWithDayWord({ signInName: NAME, word: SECRET_WORD }).catch(() => undefined)

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})

describe('signInWithPassword / signInWithSharedCode - status-only errors (Gate-2 S-4)', () => {
  const PASSWORD = 'correct-horse-battery-staple-9'
  const HANDLE = 'quentin.reyes'
  const CODE = 'view-only-code-7Q'

  /** A real AxiosError whose request config echoes the credentials, as a live failure does. */
  function axiosErrorEchoingBody(
    status: number | null,
    body: unknown,
    serverText: unknown,
  ): AxiosError {
    const config = {
      data: JSON.stringify(body),
      headers: { Authorization: 'Bearer some-other-token' },
    } as unknown as AxiosError['config']
    const response = status === null
      ? undefined
      : ({ status, data: serverText, statusText: '', headers: {}, config } as unknown as AxiosResponse)
    return new AxiosError(
      `Request failed for ${PASSWORD}`,
      'ERR_BAD_REQUEST',
      config,
      null,
      response,
    )
  }

  /** Everything reachable on an error: its string form, JSON, and every own property. */
  function everythingOn(error: unknown): string {
    const parts: string[] = [
      String(error),
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ]
    for (const key of Object.getOwnPropertyNames(error)) {
      const value = (error as Record<string, unknown>)[key]
      parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    }
    return parts.join('\n')
  }

  const paths = [
    [
      'signInWithPassword',
      () => signInWithPassword({ username: HANDLE, password: PASSWORD }),
      { username: HANDLE, password: PASSWORD },
      PASSWORD,
    ],
    [
      'signInWithSharedCode',
      () => signInWithSharedCode({ password: CODE }),
      { password: CODE },
      CODE,
    ],
  ] as const

  describe.each(paths)('%s', (_name, call, body, secret) => {
    it.each([401, 429, 500])('a %i carries only its status: no cause, no server text, no secret', async status => {
      mockPost.mockRejectedValue(
        axiosErrorEchoingBody(status, body, { message: `no such handle; you sent ${secret}`, detail: secret }),
      )

      const caught = await call().catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(ParticipantSignInError)
      const error = caught as ParticipantSignInError
      expect(error.status).toBe(status)
      expect(error.cause).toBeUndefined()
      expect(Object.getOwnPropertyNames(error)).not.toContain('cause')
      expect(error).not.toHaveProperty('serverMessage')
      expect(everythingOn(error)).not.toContain(secret)
      expect(everythingOn(error)).not.toContain(HANDLE)
      expect(everythingOn(error)).not.toContain('some-other-token')
    })

    it('no response at all: a status-less error, still without the secret or a cause', async () => {
      mockPost.mockRejectedValue(axiosErrorEchoingBody(null, body, undefined))

      const caught = await call().catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(ParticipantSignInError)
      expect((caught as ParticipantSignInError).status).toBeUndefined()
      expect((caught as ParticipantSignInError).cause).toBeUndefined()
      expect(everythingOn(caught)).not.toContain(secret)
    })

    it('a non-axios error is not chained on either', async () => {
      mockPost.mockRejectedValue(new TypeError(`odd ${secret}`))

      const caught = await call().catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(ParticipantSignInError)
      expect((caught as ParticipantSignInError).cause).toBeUndefined()
      expect(everythingOn(caught)).not.toContain(secret)
    })

    it('the page still decides on the status alone (401 -> unauthorized, 429 -> not)', async () => {
      mockPost.mockRejectedValue(axiosErrorEchoingBody(401, body, ''))
      expect(isUnauthorizedSignInError(await call().catch((error: unknown) => error))).toBe(true)

      mockPost.mockRejectedValue(axiosErrorEchoingBody(429, body, ''))
      expect(isUnauthorizedSignInError(await call().catch((error: unknown) => error))).toBe(false)
    })

    it('a malformed success body does not contain the secret', async () => {
      mockPost.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof api.post>>)

      const caught = await call().catch((error: unknown) => error)

      expect(everythingOn(caught)).not.toContain(secret)
    })
  })
})

describe('isRateLimitedSignInError', () => {
  it('is false for a plain non-ParticipantSignInError value', () => {
    expect(isRateLimitedSignInError(new Error('boom'))).toBe(false)
    expect(isRateLimitedSignInError('not an error')).toBe(false)
    expect(isRateLimitedSignInError(undefined)).toBe(false)
  })

  it('is true only for a ParticipantSignInError with status 429', () => {
    expect(isRateLimitedSignInError(new ParticipantSignInError('x', { status: 429 }))).toBe(true)
    expect(isRateLimitedSignInError(new ParticipantSignInError('x', { status: 401 }))).toBe(false)
  })
})
