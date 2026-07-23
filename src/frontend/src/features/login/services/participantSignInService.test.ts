/**
 * features/login/services/participantSignInService.test.ts
 * ---------------------------------------------------------------------------
 * Story 02 (participant sign-in) — boundary-mocked coverage for the
 * participant sign-in data seam.
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `staffAssignmentsService.test.ts`) so these tests exercise
 * `signInWithPassword`/`signInWithSharedCode`'s own request shape /
 * validation / error-translation logic directly, with no async request ever
 * reaching a real sink (the repo's own worker-teardown footgun).
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
  isUnauthorizedSignInError,
  signInWithPassword,
  signInWithSharedCode,
} from './participantSignInService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
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
