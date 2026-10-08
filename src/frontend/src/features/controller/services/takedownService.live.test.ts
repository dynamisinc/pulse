/**
 * features/controller/services/takedownService.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE takedown call (demo-polish C5, story 22; B6's contract, implementation.md §1.5.5), with
 * `USE_MOCK_DATA` false and the shared axios client mocked at the boundary:
 *  - `DELETE /staff/posts/{id}` with `category` as a QUERY param (never a body), the id URL-encoded
 *    into the path, a bounded timeout, and NO client `exerciseId` anywhere (COR-001);
 *  - each of the four categories goes out exactly as the server matches it (lower case, ordinal);
 *    an absent category is `other`; an unknown one rejects BEFORE any request;
 *  - a 2xx records the id in `removedPosts`; a failure records nothing;
 *  - failures become a `TakedownError` with PLAIN-TEXT, controller-readable messages: the server's
 *    own 400 message verbatim, a plain sentence for 404 (unknown / cross-exercise are identical),
 *    401, 403, 5xx and a network failure; it never leaks a stack, a URL or a token.
 */
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removedPosts } from '@/features/social/services/removedPosts'
import {
  DEFAULT_TAKEDOWN_CATEGORY,
  REQUEST_TIMEOUT_MS,
  TAKEDOWN_CATEGORIES,
  TakedownError,
  isPostRemoved,
  takeDownPost,
  type TakedownCategory,
} from './takedownService'

const deleteMock = vi.fn()

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { delete: (...args: unknown[]) => deleteMock(...args) },
}))

const POST_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

/** An axios rejection shaped like the real thing for `status`/`data` (or a network failure). */
function axiosFailure(status: number | undefined, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  if (status === undefined) return new AxiosError('Network Error', 'ERR_NETWORK', config)
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  })
}

async function failureOf(promise: Promise<unknown>): Promise<TakedownError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TakedownError) return error
    throw error
  }
  throw new Error('expected the takedown to fail')
}

beforeEach(() => {
  deleteMock.mockReset()
  deleteMock.mockResolvedValue({ status: 204, data: '' })
})

afterEach(() => {
  removedPosts.resetForTests()
})

describe('takeDownPost (live) - the request', () => {
  it('DELETEs /staff/posts/{id} with the category as a QUERY param and a bounded timeout', async () => {
    await takeDownPost(POST_ID, 'pii')

    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledWith(`/staff/posts/${POST_ID}`, {
      params: { category: 'pii' },
      timeout: REQUEST_TIMEOUT_MS,
    })
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('sends NO body and NO exerciseId, however the request is built (COR-001)', async () => {
    await takeDownPost(POST_ID, 'other')

    const [, config] = deleteMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(config).not.toHaveProperty('data')
    expect(JSON.stringify(deleteMock.mock.calls[0])).not.toMatch(/exerciseId/i)
  })

  it.each(TAKEDOWN_CATEGORIES.map(option => option.value))(
    'sends %s exactly as the server matches it (lower case, ordinal)',
    async category => {
      await takeDownPost(POST_ID, category)
      const [, config] = deleteMock.mock.calls[0] as [string, { params: { category: string } }]
      expect(config.params.category).toBe(category)
      expect(config.params.category).toBe(config.params.category.toLowerCase())
    },
  )

  it('offers exactly the four server categories, with `other` as the default', () => {
    expect(TAKEDOWN_CATEGORIES.map(option => option.value)).toEqual([
      'inappropriate',
      'pii',
      'real-world-reference',
      'other',
    ])
    expect(DEFAULT_TAKEDOWN_CATEGORY).toBe('other')
  })

  it('defaults an omitted category to `other`, matching the server', async () => {
    await takeDownPost(POST_ID)
    const [, config] = deleteMock.mock.calls[0] as [string, { params: { category: string } }]
    expect(config.params.category).toBe('other')
  })

  it('URL-encodes the id into the path (defence in depth against a corrupted route)', async () => {
    await takeDownPost('a/b?c#d', 'other')
    expect(deleteMock.mock.calls[0]?.[0]).toBe('/staff/posts/a%2Fb%3Fc%23d')
  })

  it('rejects an unknown category BEFORE any request is made (the server would answer 400)', async () => {
    const error = await failureOf(takeDownPost(POST_ID, 'Inappropriate' as unknown as TakedownCategory))

    expect(deleteMock).not.toHaveBeenCalled()
    expect(error.message).toBe(
      'category must be one of: inappropriate, pii, real-world-reference, other.',
    )
    expect(error.status).toBe(400)
    expect(isPostRemoved(POST_ID)).toBe(false)
  })

  it('rejects an empty id without a request', async () => {
    const error = await failureOf(takeDownPost('', 'other'))
    expect(deleteMock).not.toHaveBeenCalled()
    expect(error.status).toBe(404)
  })
})

describe('takeDownPost (live) - success', () => {
  it('records the id in the removed-post store on a 204', async () => {
    expect(isPostRemoved(POST_ID)).toBe(false)

    await takeDownPost(POST_ID, 'inappropriate')

    expect(isPostRemoved(POST_ID)).toBe(true)
    expect(removedPosts.has(POST_ID)).toBe(true)
  })

  it('a repeat is harmless: the server answers 204 again and the store stays one id', async () => {
    await takeDownPost(POST_ID, 'other')
    await takeDownPost(POST_ID, 'other')

    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(removedPosts.getAll().size).toBe(1)
  })
})

describe('takeDownPost (live) - failures are plain text and record nothing', () => {
  it('surfaces the server\'s own 400 message verbatim (a JSON string body)', async () => {
    deleteMock.mockRejectedValue(axiosFailure(400, 'category must be one of: inappropriate, pii.'))

    const error = await failureOf(takeDownPost(POST_ID, 'other'))

    expect(error.message).toBe('category must be one of: inappropriate, pii.')
    expect(error.status).toBe(400)
    expect(isPostRemoved(POST_ID)).toBe(false)
  })

  it('reads a message / detail / title off an object body', async () => {
    deleteMock.mockRejectedValue(axiosFailure(400, { detail: 'The id is not valid.' }))
    expect((await failureOf(takeDownPost(POST_ID, 'other'))).message).toBe('The id is not valid.')
  })

  it('says a 404 plainly - one sentence for unknown AND cross-exercise (they are identical)', async () => {
    deleteMock.mockRejectedValue(axiosFailure(404, ''))

    const error = await failureOf(takeDownPost(POST_ID, 'other'))

    expect(error.message).toBe('That post no longer exists in this exercise.')
    expect(error.status).toBe(404)
    expect(isPostRemoved(POST_ID)).toBe(false)
  })

  it.each([
    [401, /session has expired/i],
    [403, /controller assigned to this exercise/i],
    [503, /busy/i],
    [429, /busy/i],
    [500, /server answered 500/i],
  ])('gives status %i a plain sentence', async (status, pattern) => {
    deleteMock.mockRejectedValue(axiosFailure(status))
    const error = await failureOf(takeDownPost(POST_ID, 'other'))
    expect(error.message).toMatch(pattern)
    expect(error.status).toBe(status)
  })

  it('says a network failure plainly, with no status', async () => {
    deleteMock.mockRejectedValue(axiosFailure(undefined))

    const error = await failureOf(takeDownPost(POST_ID, 'other'))

    expect(error.message).toMatch(/could not be reached/i)
    expect(error.status).toBeUndefined()
    expect(isPostRemoved(POST_ID)).toBe(false)
  })

  it('wraps a non-axios failure without leaking its message', async () => {
    deleteMock.mockRejectedValue(new Error('secret internal detail at https://internal/x?token=abc'))

    const error = await failureOf(takeDownPost(POST_ID, 'other'))

    expect(error.message).toBe('The post was not taken down. Try again.')
    expect(error.message).not.toMatch(/token|internal/)
  })

  it('never puts a URL, a stack or the request config in the message', async () => {
    deleteMock.mockRejectedValue(axiosFailure(500, undefined))
    const error = await failureOf(takeDownPost(POST_ID, 'other'))
    expect(error.message).not.toMatch(/https?:|\/staff\/|at .*\(.*:\d+:\d+\)/)
  })
})
