/**
 * features/controller/runSheet/injectService.ts
 * ---------------------------------------------------------------------------
 * The SERVICE SEAM of the console run sheet (inject-queue story 07; the server
 * side is story 06). STAFF world, no UI. Three things live here:
 *
 *   1. `InjectService` — the one interface the hooks program against.
 *   2. `createLiveInjectService()` — the axios implementation of story 06's FROZEN
 *      wire contract (`implementation.md` § Demo slice), through the shared client
 *      `@/core/services/api` (base URL `VITE_API_URL` or `/api`, so the paths below
 *      are relative to it — `GET /injects` IS `GET /api/injects`).
 *   3. `getInjectService()` — the mock/live flip point. It delegates to the ONE
 *      flag, `USE_MOCK_DATA` (`@/core/config/mockData`), read at CALL time (the
 *      repo's precedent for controller services, so a test can flip it), and
 *      returns the in-memory mock (`injectMock.ts`) or the live service.
 *
 * ROUTES (all staff-only; mutations also need the `controller` role — the server
 * enforces both, the console only reflects them):
 *
 *   GET    /injects                       -> InjectQueueDto
 *   GET    /injects/assignees             -> InjectAssigneesDto
 *   POST   /injects                       -> 201 InjectItemDto
 *   PUT    /injects/{id}                  -> InjectItemDto     (body: write + version)
 *   DELETE /injects/{id}?version=n        -> 204
 *   POST   /injects/reorder               -> InjectQueueDto    (body: { ids })
 *   POST   /injects/{id}/fire             -> InjectItemDto
 *   POST   /injects/{id}/hold|release|skip|unskip|retry -> InjectItemDto
 *
 * NO `exerciseId` in any request, query string or body (COR-001): the server
 * resolves the exercise from the session, and a cross-exercise id is
 * indistinguishable from an unknown one. The acting human is never sent either —
 * the server reads it from the staff session (COR-018).
 *
 * NO TELEMETRY (IQ-8). The server emits exactly one `inject_action` event per queue
 * action; the console emits nothing for them, so there is no double count.
 *
 * ERRORS. 409/400/404 are translated into typed errors (`injectErrors.ts`);
 * everything else propagates as the original error. A 2xx whose body is not the
 * contract rejects (fail closed, `injectGuards.ts`) instead of rendering garbage.
 */

import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { translateInjectError } from './injectErrors'
import { isInjectAssigneesDto, isInjectItemDto, isInjectQueueDto } from './injectGuards'
import { injectMock } from './injectMock'
import type {
  InjectAssigneesDto,
  InjectItemDto,
  InjectItemWrite,
  InjectQueueDto,
} from './types'

/** The single-item transitions that take only an id (all answer 200 + the item). */
export type InjectTransition = 'fire' | 'hold' | 'release' | 'skip' | 'unskip' | 'retry'

export interface InjectService {
  /** `GET /injects` — every item in `order`, plus the pause tier. */
  list(): Promise<InjectQueueDto>
  /** `GET /injects/assignees` — the staff assigned to this exercise, plus the caller's own id. */
  assignees(): Promise<InjectAssigneesDto>
  /** `POST /injects`. */
  create(body: InjectItemWrite): Promise<InjectItemDto>
  /** `PUT /injects/{id}` with the version the form was opened at (stale -> 409). */
  update(id: string, body: InjectItemWrite, version: number): Promise<InjectItemDto>
  /** `DELETE /injects/{id}?version=n` (soft delete; 409 when fired/firing or stale). */
  remove(id: string, version: number): Promise<void>
  /** `POST /injects/reorder` with the FULL new order. */
  reorder(ids: string[]): Promise<InjectQueueDto>
  fire(id: string): Promise<InjectItemDto>
  hold(id: string): Promise<InjectItemDto>
  release(id: string): Promise<InjectItemDto>
  skip(id: string): Promise<InjectItemDto>
  unskip(id: string): Promise<InjectItemDto>
  retry(id: string): Promise<InjectItemDto>
}

const INJECTS_PATH = '/injects'

const itemPath = (id: string): string => `${INJECTS_PATH}/${encodeURIComponent(id)}`

/** Runs a request, translating 400/404/409 into typed errors. */
async function call<T>(request: () => Promise<{ data: T }>): Promise<T> {
  try {
    const response = await request()
    return response.data
  } catch (error) {
    throw translateInjectError(error)
  }
}

function expectItem(data: unknown, route: string): InjectItemDto {
  if (!isInjectItemDto(data)) throw new Error(`Unrecognised inject item from ${route}`)
  return data
}

function expectQueue(data: unknown, route: string): InjectQueueDto {
  if (!isInjectQueueDto(data)) throw new Error(`Unrecognised inject queue from ${route}`)
  return data
}

/** The live implementation. Stateless; safe to create more than once. */
export function createLiveInjectService(): InjectService {
  const transition = async (id: string, action: InjectTransition): Promise<InjectItemDto> => {
    const route = `${itemPath(id)}/${action}`
    const data = await call(() => api.post<unknown>(route))
    return expectItem(data, `POST /api${route}`)
  }

  return {
    async list() {
      const data = await call(() => api.get<unknown>(INJECTS_PATH))
      return expectQueue(data, `GET /api${INJECTS_PATH}`)
    },

    async assignees() {
      const route = `${INJECTS_PATH}/assignees`
      const data = await call(() => api.get<unknown>(route))
      if (!isInjectAssigneesDto(data)) throw new Error(`Unrecognised assignees from GET /api${route}`)
      return data
    },

    async create(body) {
      const data = await call(() => api.post<unknown>(INJECTS_PATH, body))
      return expectItem(data, `POST /api${INJECTS_PATH}`)
    },

    async update(id, body, version) {
      const data = await call(() => api.put<unknown>(itemPath(id), { ...body, version }))
      return expectItem(data, `PUT /api${itemPath(id)}`)
    },

    async remove(id, version) {
      await call(() => api.delete<unknown>(itemPath(id), { params: { version } }))
    },

    async reorder(ids) {
      const route = `${INJECTS_PATH}/reorder`
      const data = await call(() => api.post<unknown>(route, { ids }))
      return expectQueue(data, `POST /api${route}`)
    },

    fire: id => transition(id, 'fire'),
    hold: id => transition(id, 'hold'),
    release: id => transition(id, 'release'),
    skip: id => transition(id, 'skip'),
    unskip: id => transition(id, 'unskip'),
    retry: id => transition(id, 'retry'),
  }
}

const liveInjectService = createLiveInjectService()

/**
 * The mock/live flip point. Read at CALL time so a test (or HMR) can flip
 * `USE_MOCK_DATA`; under `npm run dev` and the test runner it is the in-memory
 * mock, in a deploy without `VITE_USE_MOCK_DATA` it is the live service
 * (fail closed — absence of the flag never serves canned data, COR-001).
 */
export function getInjectService(): InjectService {
  return USE_MOCK_DATA ? injectMock : liveInjectService
}
