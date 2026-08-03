/**
 * features/exerciseLifecycleAdmin/services/orgExercisesService.test.ts
 * ---------------------------------------------------------------------------
 * The WIRE CONTRACT and the error/validation branches, with
 * `@/core/services/api` mocked so the responses (and failures) can be dictated.
 * The sibling `.default.test.ts` covers the shipped mock-adapter path.
 *
 * The point of mocking the client here is the REQUEST half: these cases pin the
 * URL, the method and the body shape the live `/api/org/*` endpoints will
 * receive, which the mock adapter (short-circuiting inside axios) cannot prove
 * on its own. Getting that wrong is the mock/live divergence that only shows up
 * the day the flag flips off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxiosError } from 'axios'
import { api } from '@/core/services/api'
import { OrgExerciseError, createOrgExercise, getOrgExercises } from './orgExercisesService'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)
const mockedPost = vi.mocked(api.post)

/** Builds an axios-shaped rejection with a given status + body. */
function httpError(status: number, data: unknown): AxiosError {
  const error = new AxiosError(`Request failed with status code ${status}`)
  error.response = {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: {} } as never,
  }
  // `axios.isAxiosError` checks this flag.
  error.isAxiosError = true
  return error
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getOrgExercises — the wire contract', () => {
  it('GETs /org/exercises with NO id, query or organization parameter', async () => {
    mockedGet.mockResolvedValue({ data: [] })

    await getOrgExercises()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    const [url] = mockedGet.mock.calls[0] ?? []
    // There is no by-id route on the org tier, deliberately — no IDOR surface
    // on the org axis. A path with an id in it would be a contract break, not a
    // convenience.
    expect(url).toBe('/org/exercises')
  })

  it('projects null hostname/createdAt to undefined rather than a fabricated value', async () => {
    mockedGet.mockResolvedValue({
      data: [{ exerciseId: 'e1', name: 'Old Run', status: 'archived', hostname: null, createdAt: null }],
    })

    const [row] = await getOrgExercises()

    expect(row?.hostname).toBeUndefined()
    expect(row?.createdAt).toBeUndefined()
  })

  it('carries an UNRECOGNISED status through instead of rejecting the whole response', async () => {
    // The narrowing is deliberately deferred to the row that renders it: one odd
    // literal must not blank the organization's entire portfolio on a
    // backend-ahead deploy.
    mockedGet.mockResolvedValue({
      data: [
        { exerciseId: 'e1', name: 'Known', status: 'build' },
        { exerciseId: 'e2', name: 'Odd', status: 'quantum-superposition' },
      ],
    })

    const rows = await getOrgExercises()

    expect(rows).toHaveLength(2)
    expect(rows[1]?.status).toBe('quantum-superposition')
  })

  it('fails closed on a malformed body rather than serving a partial list', async () => {
    mockedGet.mockResolvedValue({ data: [{ exerciseId: 'e1' }] })

    const caught = await getOrgExercises().catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(OrgExerciseError)
  })

  it('surfaces the transport status so the surface can distinguish 401/403 from a network drop', async () => {
    mockedGet.mockRejectedValue(httpError(403, { message: 'Forbidden.' }))

    const caught = await getOrgExercises().catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(OrgExerciseError)
    expect((caught as OrgExerciseError).status).toBe(403)
    expect((caught as OrgExerciseError).serverMessage).toBe('Forbidden.')
  })
})

describe('createOrgExercise — the wire contract', () => {
  const CREATED = {
    data: {
      exercise: { exerciseId: 'e9', name: 'New Run', status: 'build', hostname: 'new-run' },
      assignedRole: 'planner',
    },
  }

  it('POSTs to /org/exercises with the trimmed name and NOTHING else it does not own', async () => {
    mockedPost.mockResolvedValue(CREATED)

    await createOrgExercise({ name: '  New Run  ' })

    const [url, body] = mockedPost.mock.calls[0] ?? []
    expect(url).toBe('/org/exercises')
    // No organizationId, no status, no exerciseId: the tenant is the caller's
    // own (server-resolved), the status is always `build`, the id is generated.
    // If a field ever appears here that the client decided, this fails.
    expect(body).toEqual({ name: 'New Run' })
  })

  it('OMITS a blank hostname so the server takes its allocate-one path', async () => {
    mockedPost.mockResolvedValue(CREATED)

    await createOrgExercise({ name: 'New Run', hostname: '   ' })

    const [, body] = mockedPost.mock.calls[0] ?? []
    // Sending `hostname: ""` would be a proposal of an invalid host, i.e. a 400,
    // instead of "you pick one".
    expect(body).toEqual({ name: 'New Run' })
    expect(Object.keys(body as object)).not.toContain('hostname')
  })

  it('sends a proposed hostname when there is one', async () => {
    mockedPost.mockResolvedValue(CREATED)

    await createOrgExercise({ name: 'New Run', hostname: ' new-run ' })

    expect(mockedPost.mock.calls[0]?.[1]).toEqual({ name: 'New Run', hostname: 'new-run' })
  })

  it('maps a 409 to a status the form can recognise as the recoverable one', async () => {
    mockedPost.mockRejectedValue(httpError(409, { message: 'Hostname already in use.' }))

    const caught = await createOrgExercise({ name: 'X', hostname: 'taken' })
      .catch((error: unknown) => error)

    expect((caught as OrgExerciseError).status).toBe(409)
    expect((caught as OrgExerciseError).serverMessage).toBe('Hostname already in use.')
  })

  it('fails closed on a 201 whose body is not the documented shape', async () => {
    mockedPost.mockResolvedValue({ data: { assignedRole: 'planner' } })

    const caught = await createOrgExercise({ name: 'X' }).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(OrgExerciseError)
  })
})
