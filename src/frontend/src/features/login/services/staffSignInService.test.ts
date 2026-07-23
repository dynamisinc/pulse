/**
 * features/login/services/staffSignInService.test.ts
 * ---------------------------------------------------------------------------
 * Story 03 (staff sign-in) — boundary-mocked coverage for the staff sign-in
 * data seam.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `staffSignIn`'s own request shape / validation / error-
 * translation logic directly (mirrors `staffAssignmentsService.test.ts`).
 * Mocking the axios client also honours the repo footgun: no async POST
 * ever reaches a real sink, so a rejection can never crash Vitest worker
 * teardown.
 *
 * `axios` itself is NOT mocked — the error-translation tests construct real
 * `AxiosError`s so `axios.isAxiosError` (used inside the service) recognizes
 * them, exactly as a live 401/403/400 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import { StaffSignInError, staffSignIn } from './staffSignInService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

const mockPost = vi.mocked(api.post)

const CREDENTIALS = { username: 'planner1', secret: 'correct-secret', exerciseId: 'ex-mock-0001' }

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
  mockPost.mockReset()
})

describe('staffSignIn — request shape', () => {
  it('POSTs /auth/staff/login with username, secret, and exerciseId', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', session: {} },
    } as Awaited<ReturnType<typeof api.post>>)

    await staffSignIn(CREDENTIALS)

    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/staff/login')
    expect(body).toEqual(CREDENTIALS)
  })
})

describe('staffSignIn — response parsing', () => {
  it('returns the parsed envelope (token + refreshToken + session)', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456', session: { role: 'controller' } },
    } as Awaited<ReturnType<typeof api.post>>)

    const result = await staffSignIn(CREDENTIALS)

    expect(result).toEqual({
      token: 'tok-123',
      refreshToken: 'ref-456',
      session: { role: 'controller' },
    })
  })

  it('accepts an envelope with no refreshToken (shared/read-only session shape)', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', session: {} },
    } as Awaited<ReturnType<typeof api.post>>)

    await expect(staffSignIn(CREDENTIALS)).resolves.toEqual({ token: 'tok-123', session: {} })
  })

  it('fails closed (throws) on a malformed/empty response body', async () => {
    mockPost.mockResolvedValue(
      { data: { oops: true } } as unknown as Awaited<ReturnType<typeof api.post>>,
    )

    await expect(staffSignIn(CREDENTIALS)).rejects.toBeInstanceOf(StaffSignInError)
  })

  it('fails closed when token is missing', async () => {
    mockPost.mockResolvedValue(
      { data: { session: {} } } as unknown as Awaited<ReturnType<typeof api.post>>,
    )

    await expect(staffSignIn(CREDENTIALS)).rejects.toBeInstanceOf(StaffSignInError)
  })
})

describe('staffSignIn — transport error translation (AC4/AC5: 401 vs 403 must be distinguishable)', () => {
  it('translates a 401 into a StaffSignInError carrying status 401 (rejected credentials)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, ''))

    const caught = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffSignInError)
    expect((caught as StaffSignInError).status).toBe(401)
  })

  it('translates a 403 into a StaffSignInError carrying status 403 (not assigned to exercise)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(403, ''))

    const caught = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffSignInError)
    expect((caught as StaffSignInError).status).toBe(403)
  })

  it('401 and 403 produce DIFFERENT status values (never collapsed to the same outcome)', async () => {
    mockPost.mockRejectedValueOnce(axiosErrorWith(401, ''))
    const unauthorized = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    mockPost.mockRejectedValueOnce(axiosErrorWith(403, ''))
    const forbidden = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    const unauthorizedStatus = (unauthorized as StaffSignInError).status
    const forbiddenStatus = (forbidden as StaffSignInError).status
    expect(unauthorizedStatus).not.toBe(forbiddenStatus)
  })

  it('translates a 400 into status 400 + the server reason string', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(400, 'exerciseId must be a GUID.'))

    const caught = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffSignInError)
    expect((caught as StaffSignInError).status).toBe(400)
    expect((caught as StaffSignInError).serverMessage).toBe('exerciseId must be a GUID.')
  })

  it('translates a network failure (no response) into a StaffSignInError with no status', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(StaffSignInError)
    expect((caught as StaffSignInError).status).toBeUndefined()
  })
})

describe('staffSignIn — never logs the secret', () => {
  it('does not include the secret in a thrown error message on failure', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, ''))

    const caught = await staffSignIn(CREDENTIALS).catch((error: unknown) => error)

    expect(String((caught as StaffSignInError).message)).not.toContain(CREDENTIALS.secret)
    expect(JSON.stringify(caught)).not.toContain(CREDENTIALS.secret)
  })
})
