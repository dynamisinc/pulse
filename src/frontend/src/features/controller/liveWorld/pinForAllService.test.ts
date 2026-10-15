/**
 * features/controller/liveWorld/pinForAllService.test.ts
 * ---------------------------------------------------------------------------
 * Story 08: the LIVE pin-for-everyone call (`USE_MOCK_DATA` false, the shared axios
 * client mocked at the boundary):
 *  - pin is `PUT /staff/posts/{id}/pin`, unpin is `DELETE` on the same path, the id
 *    URL-encoded, a bounded timeout, and no `exerciseId` anywhere (COR-001);
 *  - failures become a `PinForAllError` with a plain-text, controller-readable message
 *    (404 / 403 / 5xx / network), and an HTML body never reaches the console.
 */
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PIN_REQUEST_TIMEOUT_MS, PinForAllError, setPinnedForAll } from './pinForAllService'

const putMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: {
    put: (...args: unknown[]) => putMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}))

const POST_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

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

async function failureOf(promise: Promise<unknown>): Promise<PinForAllError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PinForAllError) return error
    throw error
  }
  throw new Error('expected the pin call to fail')
}

beforeEach(() => {
  putMock.mockReset()
  deleteMock.mockReset()
  putMock.mockResolvedValue({ status: 204, data: '' })
  deleteMock.mockResolvedValue({ status: 204, data: '' })
})

describe('setPinnedForAll (live) - the request', () => {
  it('pins with PUT /staff/posts/{id}/pin, no body, a bounded timeout', async () => {
    await setPinnedForAll(POST_ID, true)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledWith(`/staff/posts/${POST_ID}/pin`, undefined, {
      timeout: PIN_REQUEST_TIMEOUT_MS,
    })
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('unpins with DELETE on the same path', async () => {
    await setPinnedForAll(POST_ID, false)
    expect(deleteMock).toHaveBeenCalledWith(`/staff/posts/${POST_ID}/pin`, {
      timeout: PIN_REQUEST_TIMEOUT_MS,
    })
    expect(putMock).not.toHaveBeenCalled()
  })

  it('URL-encodes the id and never sends an exerciseId', async () => {
    await setPinnedForAll('a/b?c', true)
    const [url, body, config] = putMock.mock.calls[0] ?? []
    expect(url).toBe('/staff/posts/a%2Fb%3Fc/pin')
    expect(JSON.stringify([url, body, config])).not.toMatch(/exercise/i)
  })

  it('rejects an empty id before any request', async () => {
    const error = await failureOf(setPinnedForAll('', true))
    expect(error.status).toBe(404)
    expect(putMock).not.toHaveBeenCalled()
  })
})

describe('setPinnedForAll (live) - failures are plain text', () => {
  it.each([
    [404, /no longer exists|taken down/],
    [403, /Only a controller/],
    [401, /session has expired/],
    [503, /busy/],
    [500, /not pinned \(the server answered 500\)/],
  ])('maps %i to a readable sentence', async (status, pattern) => {
    putMock.mockRejectedValue(axiosFailure(status))
    const error = await failureOf(setPinnedForAll(POST_ID, true))
    expect(error.status).toBe(status)
    expect(error.message).toMatch(pattern)
  })

  it('says "unpinned" for a failed unpin', async () => {
    deleteMock.mockRejectedValue(axiosFailure(500))
    expect((await failureOf(setPinnedForAll(POST_ID, false))).message).toMatch(/not unpinned/)
  })

  it('maps a network failure to a reachability sentence', async () => {
    putMock.mockRejectedValue(axiosFailure(undefined))
    const error = await failureOf(setPinnedForAll(POST_ID, true))
    expect(error.status).toBeUndefined()
    expect(error.message).toMatch(/could not be reached/)
  })

  it('shows a short 400 message verbatim but never an HTML page', async () => {
    putMock.mockRejectedValueOnce(axiosFailure(400, { message: 'Post is a reply.' }))
    expect((await failureOf(setPinnedForAll(POST_ID, true))).message).toBe('Post is a reply.')
    putMock.mockRejectedValueOnce(axiosFailure(400, '<html><body>Bad</body></html>'))
    expect((await failureOf(setPinnedForAll(POST_ID, true))).message).not.toMatch(/</)
  })

  it('wraps a non-axios failure', async () => {
    putMock.mockRejectedValue(new Error('boom'))
    const error = await failureOf(setPinnedForAll(POST_ID, true))
    expect(error.message).toMatch(/not pinned/)
  })
})
