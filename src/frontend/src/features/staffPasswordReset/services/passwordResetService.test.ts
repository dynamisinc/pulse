/** passwordResetService (#576, #575b): 204 vs invite landing, shape validation, errors. */
import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { PasswordResetError, resetPassword } from './passwordResetService'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn() } }))
const mockPost = vi.mocked(api.post)
const REQUEST = { token: 't', newPassword: 'correct horse battery' }

beforeEach(() => {
  mockPost.mockReset()
})

describe('resetPassword', () => {
  it('resolves undefined on 204 (reset token)', async () => {
    mockPost.mockResolvedValue({ status: 204, data: '' })
    await expect(resetPassword(REQUEST)).resolves.toBeUndefined()
  })

  it('returns the parsed invite landing on 200', async () => {
    const landing = { next: 'sign-in', orgSlug: 'acme', email: 'a@b.org' }
    mockPost.mockResolvedValue({ status: 200, data: landing })
    await expect(resetPassword(REQUEST)).resolves.toEqual(landing)
  })

  it.each([
    { next: 'elsewhere', orgSlug: 'acme', email: 'a@b.org' },
    { next: 'sign-in', email: 'a@b.org' },
    { next: 'awaiting-assignment', orgSlug: 'acme' },
    'oops',
  ])('treats a malformed 200 body as no landing (%j)', async body => {
    mockPost.mockResolvedValue({ status: 200, data: body })
    await expect(resetPassword(REQUEST)).resolves.toBeUndefined()
  })

  it('throws PasswordResetError with status and code', async () => {
    const response = { status: 400, data: { error: 'invalid-token' } } as AxiosResponse
    mockPost.mockRejectedValue(
      new AxiosError('x', undefined, undefined, undefined, response),
    )
    let caught: unknown
    try {
      await resetPassword(REQUEST)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PasswordResetError)
    expect((caught as PasswordResetError).status).toBe(400)
    expect((caught as PasswordResetError).code).toBe('invalid-token')
  })
})
