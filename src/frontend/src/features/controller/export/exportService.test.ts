/**
 * features/controller/export/exportService.test.ts
 * ---------------------------------------------------------------------------
 * Story 09 AC3, the download itself:
 *   - GET /staff/exports/posts.xlsx as a BLOB, saved under the server's Content-Disposition name
 *     (quoted, bare and RFC 5987 forms; a fallback when there is none; path characters stripped);
 *   - the session's bearer token rides on the request (the shared client's interceptor);
 *   - a 429 is retried ONCE after about a second; a second 429 shows the server's reason, read out
 *     of the Blob error body;
 *   - other failures are sentences (413 detail, 403, no response).
 */
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import {
  downloadPostsExport,
  EXPORT_PATH,
  EXPORT_RETRY_DELAY_MS,
  FALLBACK_EXPORT_FILE_NAME,
  fileNameFromContentDisposition,
  type ExportDependencies,
} from './exportService'
import { MOCK_EXPORT_FILE_NAME } from './exportMock'

const SERVER_NAME = 'pulse-posts-kestrel-20261020-1432.xlsx'

function fileResponse(disposition?: string): AxiosResponse<Blob> {
  const headers = new AxiosHeaders()
  if (disposition !== undefined) headers.set('Content-Disposition', disposition)
  return {
    data: new Blob(['PK-fake-xlsx']),
    status: 200,
    statusText: 'OK',
    headers,
    config: { headers: new AxiosHeaders() },
  }
}

function problem(status: number, detail?: string): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  const body = detail === undefined ? new Blob([]) : new Blob([JSON.stringify({ status, detail })])
  return new AxiosError(`status ${status}`, 'ERR_BAD_REQUEST', config, null, {
    data: body,
    status,
    statusText: String(status),
    headers: new AxiosHeaders(),
    config,
  })
}

function deps() {
  return {
    wait: vi.fn<ExportDependencies['wait']>(() => Promise.resolve()),
    save: vi.fn<ExportDependencies['save']>(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  clearTokens()
})

describe('downloadPostsExport', () => {
  it('fetches the export as a blob and saves it under the server file name', async () => {
    const response = fileResponse(`attachment; filename="${SERVER_NAME}"`)
    const get = vi.spyOn(api, 'get').mockResolvedValue(response)
    const d = deps()

    await expect(downloadPostsExport(d)).resolves.toBe(SERVER_NAME)

    expect(get).toHaveBeenCalledWith(EXPORT_PATH, expect.objectContaining({ responseType: 'blob' }))
    expect(d.save).toHaveBeenCalledWith(response.data, SERVER_NAME)
    expect(d.wait).not.toHaveBeenCalled()
  })

  it('falls back to a fixed name when the server sends none', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(fileResponse())
    const d = deps()
    await expect(downloadPostsExport(d)).resolves.toBe(FALLBACK_EXPORT_FILE_NAME)
  })

  it("sends the session's bearer token", async () => {
    setTokens({ token: 'staff-access-token' })
    let seen: unknown
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation((url, config) =>
      realGet(url, {
        ...config,
        adapter: request => {
          seen = request.headers.Authorization
          return Promise.resolve({ ...fileResponse(`attachment; filename="${SERVER_NAME}"`), config: request })
        },
      }),
    )
    await downloadPostsExport(deps())
    expect(seen).toBe('Bearer staff-access-token')
  })

  it('retries a 429 once after about a second', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(problem(429, 'Another post export is being built right now.'))
      .mockResolvedValueOnce(fileResponse(`attachment; filename="${SERVER_NAME}"`))
    const d = deps()

    await expect(downloadPostsExport(d)).resolves.toBe(SERVER_NAME)
    expect(d.wait).toHaveBeenCalledWith(EXPORT_RETRY_DELAY_MS)
    expect(EXPORT_RETRY_DELAY_MS).toBe(1000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(d.save).toHaveBeenCalledTimes(1)
  })

  it("shows the server's reason when the retry is refused too", async () => {
    const reason = 'Another post export is being built right now. Try again in a few seconds.'
    const get = vi.spyOn(api, 'get').mockRejectedValue(problem(429, reason))
    const d = deps()

    await expect(downloadPostsExport(d)).rejects.toThrow(reason)
    expect(get).toHaveBeenCalledTimes(2)
    expect(d.wait).toHaveBeenCalledTimes(1)
    expect(d.save).not.toHaveBeenCalled()
  })

  it('shows the 413 reason and does not retry it', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(problem(413, 'This exercise has 60,000 posts.'))
    await expect(downloadPostsExport(deps())).rejects.toThrow('This exercise has 60,000 posts.')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('gives a sentence for a 403 with no body and for no response at all', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(problem(403))
    await expect(downloadPostsExport(deps())).rejects.toThrow(
      'Only staff assigned to this exercise can export its posts.',
    )
    vi.spyOn(api, 'get').mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
    await expect(downloadPostsExport(deps())).rejects.toThrow(/could not be reached/)
  })

  it('uses the mock adapter under mock data and saves under its name', async () => {
    const d = deps()
    await expect(downloadPostsExport(d)).resolves.toBe(MOCK_EXPORT_FILE_NAME)
    const blob = d.save.mock.calls[0]?.[0]
    expect(await blob?.text()).toMatch(/^Scenario time,Wall clock \(UTC\),Author handle/)
  })
})

describe('fileNameFromContentDisposition', () => {
  it.each([
    [`attachment; filename="${SERVER_NAME}"`, SERVER_NAME],
    [`attachment; filename=${SERVER_NAME}`, SERVER_NAME],
    [
      "attachment; filename=\"fallback.xlsx\"; filename*=UTF-8''r%C3%A9sum%C3%A9.xlsx",
      'résumé.xlsx',
    ],
    ['attachment; filename="../../etc/passwd"', '....etcpasswd'],
    ['attachment', undefined],
    ['attachment; filename=""', undefined],
  ])('%s -> %s', (header, expected) => {
    expect(fileNameFromContentDisposition(header)).toBe(expected)
  })

  it('ignores a missing header', () => {
    expect(fileNameFromContentDisposition(undefined)).toBeUndefined()
  })
})
