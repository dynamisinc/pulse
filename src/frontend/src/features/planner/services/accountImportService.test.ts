/**
 * features/planner/services/accountImportService.test.ts
 * ---------------------------------------------------------------------------
 * Story 02 (named participant accounts) — boundary-mocked coverage for the
 * bulk account-import data seam.
 *
 * `@/core/services/api` is mocked at the module boundary so these tests
 * exercise `importAccounts`'s own request shape + validation + error
 * translation directly (mirrors `chromeConfig.test.tsx` /
 * `brandTokens.test.tsx`). Mocking the axios client also honours the repo
 * footgun: no async POST ever reaches a real sink, so a rejection can never
 * crash Vitest worker teardown.
 *
 * `axios` itself is NOT mocked — the error-translation tests construct real
 * `AxiosError`s so `axios.isAxiosError` (used inside the service) recognises
 * them, exactly as a live 401/400 would arrive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { api } from '@/core/services/api'
import {
  AccountImportError,
  IMPORT_FILE_PART,
  importAccounts,
} from './accountImportService'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

const mockPost = vi.mocked(api.post)

/** A minimal, valid CSV upload (content is irrelevant — the seam sends bytes). */
function csvFile(): File {
  return new File(
    ['username,displayName,role\na.rivera,A Rivera,pio'],
    'accounts.csv',
    { type: 'text/csv' },
  )
}

/** A representative valid response body (a mix of created + failed rows). */
const VALID_BODY = {
  totalRows: 3,
  createdCount: 2,
  failedCount: 1,
  rows: [
    { rowNumber: 1, username: 'a.rivera', status: 'created' },
    { rowNumber: 2, username: 'l.okonkwo', status: 'created' },
    { rowNumber: 3, username: 'a.rivera', status: 'failed', message: 'duplicate username' },
  ],
}

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

describe('importAccounts — request shape', () => {
  it('posts the file as multipart/form-data with the single `file` part the contract requires', async () => {
    mockPost.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.post>>)
    const file = csvFile()

    await importAccounts(file)

    expect(mockPost).toHaveBeenCalledTimes(1)
    const call = mockPost.mock.calls[0]
    if (!call) throw new Error('importAccounts did not call api.post')

    const [url, body, config] = call
    expect(url).toBe('/staff/accounts/import')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get(IMPORT_FILE_PART)).toBe(file)
    expect(config).toMatchObject({ headers: { 'Content-Type': 'multipart/form-data' } })
  })
})

describe('importAccounts — response parsing', () => {
  it('returns the parsed per-row summary (created + failed rows, with the failure message)', async () => {
    mockPost.mockResolvedValue({ data: VALID_BODY } as Awaited<ReturnType<typeof api.post>>)

    const result = await importAccounts(csvFile())

    expect(result.totalRows).toBe(3)
    expect(result.createdCount).toBe(2)
    expect(result.failedCount).toBe(1)
    expect(result.rows).toHaveLength(3)

    const failed = result.rows.find(row => row.status === 'failed')
    expect(failed?.username).toBe('a.rivera')
    expect(failed?.message).toBe('duplicate username')
  })

  it('fails closed (throws) on a malformed/empty response body rather than casting garbage', async () => {
    mockPost.mockResolvedValue(
      { data: { totalRows: 2 } } as unknown as Awaited<ReturnType<typeof api.post>>,
    )

    await expect(importAccounts(csvFile())).rejects.toBeInstanceOf(AccountImportError)
  })
})

describe('importAccounts — transport error translation', () => {
  it('translates a 401 into an AccountImportError carrying status 401 (no staff session)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, ''))

    const caught = await importAccounts(csvFile()).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(AccountImportError)
    expect((caught as AccountImportError).status).toBe(401)
  })

  it('translates a 400 into status 400 + the server reason string', async () => {
    mockPost.mockRejectedValue(
      axiosErrorWith(400, 'the CSV file exceeds the maximum size of 1048576 bytes.'),
    )

    const caught = await importAccounts(csvFile()).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(AccountImportError)
    expect((caught as AccountImportError).status).toBe(400)
    expect((caught as AccountImportError).serverMessage).toBe(
      'the CSV file exceeds the maximum size of 1048576 bytes.',
    )
  })

  it('translates a network failure (no response) into an AccountImportError with no status', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))

    const caught = await importAccounts(csvFile()).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(AccountImportError)
    expect((caught as AccountImportError).status).toBeUndefined()
  })
})
