/**
 * features/controller/runSheet/injectService.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE inject-queue service against story 06's frozen wire contract
 * (inject-queue story 07; implementation.md § Demo slice -> Wire contract):
 *  - every call goes to the right VERB + ROUTE (relative to the shared client's /api base);
 *  - NO request, query string or body carries an `exerciseId` (COR-001: the server
 *    scopes), nor an acting-human id (the server reads it from the staff session);
 *  - edit sends `version` in the body; delete sends `?version=n`; reorder sends the FULL order;
 *  - a 409 becomes a typed `InjectConflictError` with the server's `detail` and the
 *    current item; a 400 a typed validation error; a 404 a typed not-found;
 *  - a 2xx whose body is not the contract REJECTS (fail closed) instead of rendering garbage;
 *  - `getInjectService()` is the one USE_MOCK_DATA flip point (mock <-> live).
 *
 * `api` is mocked (`vi.mock('@/core/services/api')`) so no network call is made; the
 * errors are REAL `AxiosError`s so the translation is exercised as in production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { InjectConflictError, InjectNotFoundError, InjectValidationError } from './injectErrors'
import { makeItem } from './runSheetTestHarness'
import type { InjectItemWrite } from './types'

const getMock = vi.fn()
const postMock = vi.fn()
const putMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}))

const mockFlag = vi.hoisted(() => ({ value: true }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockFlag.value
  },
}))

import { createLiveInjectService, getInjectService } from './injectService'
import { injectMock } from './injectMock'

const service = createLiveInjectService()
const item = makeItem({ id: 'inj/9' })
const write: InjectItemWrite = {
  kind: 'post',
  title: 'Boil-water advisory',
  assigneeId: 'human-controller-01',
  posts: [{ personaId: 'persona-a', text: 'Hello' }],
}

function axiosError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as InternalAxiosRequestConfig,
    data,
  })
}

beforeEach(() => {
  getMock.mockReset()
  postMock.mockReset()
  putMock.mockReset()
  deleteMock.mockReset()
  mockFlag.value = true
})

/** Every argument of every call, flattened to one string, to scan for forbidden keys. */
function allRequestText(): string {
  return JSON.stringify([
    getMock.mock.calls,
    postMock.mock.calls,
    putMock.mock.calls,
    deleteMock.mock.calls,
  ])
}

describe('live service — routes and verbs', () => {
  it('GET /injects returns the queue', async () => {
    getMock.mockResolvedValue({ data: { items: [item], pauseTier: 'running' } })
    const queue = await service.list()
    expect(getMock).toHaveBeenCalledWith('/injects')
    expect(queue.items).toHaveLength(1)
    expect(queue.pauseTier).toBe('running')
  })

  it('GET /injects/assignees returns me + the assignees', async () => {
    const dto = { me: 'human-controller-01', assignees: [{ id: 'a', displayName: 'A', role: 'controller' }] }
    getMock.mockResolvedValue({ data: dto })
    expect(await service.assignees()).toEqual(dto)
    expect(getMock).toHaveBeenCalledWith('/injects/assignees')
  })

  it('POST /injects creates with the write body unchanged', async () => {
    postMock.mockResolvedValue({ data: item })
    await service.create(write)
    expect(postMock).toHaveBeenCalledWith('/injects', write)
  })

  it('PUT /injects/{id} sends the write plus the version the form was opened at', async () => {
    putMock.mockResolvedValue({ data: item })
    await service.update('inj-1', write, 4)
    expect(putMock).toHaveBeenCalledWith('/injects/inj-1', { ...write, version: 4 })
  })

  it('DELETE /injects/{id}?version=n', async () => {
    deleteMock.mockResolvedValue({ data: undefined })
    await service.remove('inj-1', 7)
    expect(deleteMock).toHaveBeenCalledWith('/injects/inj-1', { params: { version: 7 } })
  })

  it('POST /injects/reorder sends the full new order', async () => {
    postMock.mockResolvedValue({ data: { items: [item], pauseTier: 'running' } })
    await service.reorder(['b', 'a'])
    expect(postMock).toHaveBeenCalledWith('/injects/reorder', { ids: ['b', 'a'] })
  })

  it.each(['fire', 'hold', 'release', 'skip', 'unskip', 'retry'] as const)(
    'POST /injects/{id}/%s takes no body',
    async action => {
      postMock.mockResolvedValue({ data: item })
      await service[action]('inj-1')
      expect(postMock).toHaveBeenCalledWith(`/injects/inj-1/${action}`)
    },
  )

  it('encodes the id into the path', async () => {
    postMock.mockResolvedValue({ data: item })
    await service.fire('inj/9 ?x')
    expect(postMock).toHaveBeenCalledWith('/injects/inj%2F9%20%3Fx/fire')
  })
})

describe('live service — no exerciseId, no acting human, in any request (COR-001, COR-018)', () => {
  it('none of the calls carries an exerciseId or an acting-human id', async () => {
    getMock.mockResolvedValue({ data: { items: [item], pauseTier: 'running' } })
    postMock.mockResolvedValue({ data: item })
    putMock.mockResolvedValue({ data: item })
    deleteMock.mockResolvedValue({ data: undefined })

    await service.list()
    await service.assignees().catch(() => undefined)
    await service.create(write)
    await service.update('inj-1', write, 1)
    await service.remove('inj-1', 1)
    await service.reorder(['inj-1']).catch(() => undefined)
    for (const action of ['fire', 'hold', 'release', 'skip', 'unskip', 'retry'] as const) {
      await service[action]('inj-1')
    }

    const text = allRequestText()
    expect(text).not.toMatch(/exerciseId/i)
    expect(text).not.toMatch(/actingHumanId/i)
  })
})

describe('live service — errors', () => {
  it('a 409 becomes a typed conflict carrying the detail and the current item', async () => {
    const current = makeItem({ status: 'fired', firedByHumanId: 'human-controller-02', version: 3 })
    postMock.mockRejectedValue(
      axiosError(409, { detail: 'Already fired', extensions: { item: current } }),
    )
    const error = await service.fire('inj-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InjectConflictError)
    expect((error as InjectConflictError).detail).toBe('Already fired')
    expect((error as InjectConflictError).item?.firedByHumanId).toBe('human-controller-02')
  })

  it('a stale edit is a conflict too (PUT)', async () => {
    putMock.mockRejectedValue(axiosError(409, { detail: 'Stale version', extensions: { item } }))
    await expect(service.update('inj-1', write, 1)).rejects.toBeInstanceOf(InjectConflictError)
  })

  it('a 400 becomes a typed validation error with field errors', async () => {
    postMock.mockRejectedValue(axiosError(400, { errors: { Title: ['Title is required'] } }))
    const error = (await service.create(write).catch((e: unknown) => e)) as InjectValidationError
    expect(error).toBeInstanceOf(InjectValidationError)
    expect(error.fieldErrors.title).toBe('Title is required')
  })

  it('a 404 becomes a typed not-found', async () => {
    postMock.mockRejectedValue(axiosError(404, {}))
    await expect(service.hold('nope')).rejects.toBeInstanceOf(InjectNotFoundError)
  })

  it('401/403/500 propagate as the original axios error', async () => {
    const forbidden = axiosError(403, {})
    postMock.mockRejectedValue(forbidden)
    await expect(service.fire('inj-1')).rejects.toBe(forbidden)
  })

  it('a 2xx that is not the contract rejects instead of rendering garbage', async () => {
    getMock.mockResolvedValue({ data: '<html>SPA fallback</html>' })
    await expect(service.list()).rejects.toThrow(/Unrecognised inject queue/)
    getMock.mockResolvedValue({ data: { items: [{ id: 'x', status: 'exploded' }], pauseTier: 'running' } })
    await expect(service.list()).rejects.toThrow(/Unrecognised inject queue/)
    getMock.mockResolvedValue({ data: { items: [], pauseTier: 'melted' } })
    await expect(service.list()).rejects.toThrow(/Unrecognised inject queue/)
    postMock.mockResolvedValue({ data: { nope: true } })
    await expect(service.fire('inj-1')).rejects.toThrow(/Unrecognised inject item/)
  })
})

describe('getInjectService — the mock/live flip point', () => {
  it('serves the in-memory mock under USE_MOCK_DATA and the live service otherwise', () => {
    mockFlag.value = true
    expect(getInjectService()).toBe(injectMock)
    mockFlag.value = false
    expect(getInjectService()).not.toBe(injectMock)
  })

  it('the live branch makes real requests (never the mock) when mock data is off', async () => {
    mockFlag.value = false
    getMock.mockResolvedValue({ data: { items: [], pauseTier: 'freeze' } })
    const queue = await getInjectService().list()
    expect(getMock).toHaveBeenCalledWith('/injects')
    expect(queue.pauseTier).toBe('freeze')
  })
})
