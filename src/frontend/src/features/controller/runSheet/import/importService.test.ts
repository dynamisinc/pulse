/**
 * features/controller/runSheet/import/importService.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE import service against story 03's frozen route and DTO:
 *  - `POST /injects/import` (the shared client's `/api` base) with multipart `file` and an
 *    EXPLICIT `dryRun` param, true or false (a missing flag is a server 400);
 *  - no `exerciseId` anywhere (the server scopes from the session, COR-001);
 *  - 400 -> 'refused' with the server's `detail`; 409 -> 'conflict'; 403 -> 'forbidden';
 *  - a 2xx that is not the contract, or that answers for the other `dryRun`, rejects (fail closed);
 *  - `getInjectImportService()` is the run sheet's USE_MOCK_DATA flip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const postMock = vi.fn()
vi.mock('@/core/services/api', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}))

const mockFlag = vi.hoisted(() => ({ value: true }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockFlag.value
  },
}))

import { createLiveInjectImportService, getInjectImportService, IMPORT_PATH } from './importService'
import { InjectImportError } from './importErrors'
import { injectImportMock } from './importMock'
import { parseImportResult, type InjectImportResultDto } from './importTypes'

const service = createLiveInjectImportService()
const file = new File(['Inject #,Title\n1,Hello'], 'kestrel-msel.csv', { type: 'text/csv' })

const report = (dryRun: boolean): InjectImportResultDto => ({
  dryRun,
  totalRows: 2,
  socialRows: 1,
  createdCount: 1,
  updatedCount: 0,
  unchangedCount: 0,
  skippedCount: 1,
  failedCount: 0,
  rows: [
    { rowNumber: 2, injectNumber: '1', title: 'Hello', personaHandle: 'FairhavenWater', plannedMinute: 0, status: 'created' },
    { rowNumber: 3, injectNumber: '2', title: 'Call', status: 'skipped', message: 'not a social-media inject (Delivery Method: Phone)' },
  ],
})

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig
  return new AxiosError('failed', String(status), config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  })
}

beforeEach(() => {
  postMock.mockReset()
  mockFlag.value = true
})

describe('createLiveInjectImportService', () => {
  it.each([true, false])('posts the file as multipart with dryRun=%s sent explicitly', async dryRun => {
    postMock.mockResolvedValue({ data: report(dryRun) })
    const result = await service.importFile(file, { dryRun })
    expect(result.dryRun).toBe(dryRun)
    expect(postMock).toHaveBeenCalledTimes(1)
    type Call = [string, FormData, Record<string, unknown>]
    const [path, body, config] = postMock.mock.calls[0] as Call
    expect(path).toBe(IMPORT_PATH)
    expect(path).toBe('/injects/import')
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file')).toBe(file)
    expect(config.params).toEqual({ dryRun })
    expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    // No exercise id anywhere (COR-001).
    expect(JSON.stringify([path, config])).not.toMatch(/exercise/i)
    expect([...body.keys()]).toEqual(['file'])
  })

  it('a 400 is "refused" with the server\'s readable reason', async () => {
    postMock.mockRejectedValue(axiosError(400, { detail: 'the file is empty.' }))
    await expect(service.importFile(file, { dryRun: true })).rejects.toMatchObject({
      name: 'InjectImportError',
      kind: 'refused',
      detail: 'the file is empty.',
    })
  })

  it('409 -> conflict, 403 -> forbidden, 500 / network -> unavailable', async () => {
    postMock.mockRejectedValueOnce(axiosError(409, { detail: 'The run sheet changed while importing. Run the import again.' }))
    await expect(service.importFile(file, { dryRun: false })).rejects.toMatchObject({ kind: 'conflict' })
    postMock.mockRejectedValueOnce(axiosError(403, {}))
    await expect(service.importFile(file, { dryRun: false })).rejects.toMatchObject({ kind: 'forbidden' })
    postMock.mockRejectedValueOnce(axiosError(500, {}))
    await expect(service.importFile(file, { dryRun: false })).rejects.toMatchObject({ kind: 'unavailable' })
    postMock.mockRejectedValueOnce(new Error('Network Error'))
    await expect(service.importFile(file, { dryRun: false }))
      .rejects.toBeInstanceOf(InjectImportError)
  })

  it('fails closed on a body that is not the contract', async () => {
    postMock.mockResolvedValue({ data: { dryRun: true, rows: 'nope' } })
    await expect(service.importFile(file, { dryRun: true })).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('fails closed when the server answers for the other dryRun', async () => {
    postMock.mockResolvedValue({ data: report(true) })
    await expect(service.importFile(file, { dryRun: false })).rejects.toMatchObject({ kind: 'malformed' })
  })
})

describe('parseImportResult', () => {
  it('accepts the frozen shape (omitted optional members stay omitted)', () => {
    const parsed = parseImportResult(report(true))
    expect(parsed).toEqual(report(true))
    expect(parsed?.rows[1]).not.toHaveProperty('plannedMinute')
  })

  it('rejects an unknown status, a missing count or a malformed row', () => {
    const bad = report(true)
    expect(parseImportResult({ ...bad, rows: [{ rowNumber: 2, status: 'deleted' }] })).toBeUndefined()
    expect(parseImportResult({ ...bad, failedCount: undefined })).toBeUndefined()
    expect(parseImportResult({ ...bad, rows: [{ status: 'created' }] })).toBeUndefined()
    expect(parseImportResult(null)).toBeUndefined()
  })
})

describe('getInjectImportService', () => {
  it('is the mock under USE_MOCK_DATA and the live service otherwise', async () => {
    mockFlag.value = true
    expect(getInjectImportService()).toBe(injectImportMock)
    mockFlag.value = false
    expect(getInjectImportService()).not.toBe(injectImportMock)
    postMock.mockResolvedValue({ data: report(true) })
    await getInjectImportService().importFile(file, { dryRun: true })
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})
