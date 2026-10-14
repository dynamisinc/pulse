/**
 * features/controller/personaEdit/personaEditService.wire.test.ts
 * ---------------------------------------------------------------------------
 * WHAT ACTUALLY GOES ON THE WIRE (demo-polish story 21 / PE-FE, Gate-1 L-8).
 *
 * `personaEditService.live.test.ts` replaces the shared `api` wholesale, so it proves
 * the arguments handed to `api.patch`, not what axios then sends: the shared instance
 * defaults to `Content-Type: application/json`, and axios's `transformRequest` could
 * in principle rewrite the header or the body. This test keeps the REAL `api` (real
 * interceptors, real `transformRequest`, real header merging) and swaps only its
 * transport for a capturing adapter — the layer just above the XHR — then asserts the
 * request the server would receive:
 *
 *   PATCH {baseURL}/staff/personas/{id}
 *   Content-Type: application/merge-patch+json        (the server answers 415 otherwise)
 *   body: the JSON text of exactly the patch          (null kept, {} valid, no scope)
 *
 * and that a real axios 400 reaches the controller with the server's sentence intact.
 * `USE_MOCK_DATA` is forced false so the service takes the live path (no per-request
 * mock adapter), exactly as a production build does.
 */
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { api } from '@/core/services/api'
import { patchPersona, PersonaEditError } from './personaEditService'

const ID = '7f1c0c0e-0000-4000-8000-0000000000aa'

const OK_BODY = {
  id: ID,
  exerciseId: '3d2c0c0e-0000-4000-8000-0000000000bb',
  templateId: '',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#4C6EF5',
  initials: 'FW',
  audienceBand: 'nano',
  followerCount: 0,
  audienceMagnitude: 0,
  followingCount: 0,
  joinedAt: '2033-08-01T00:00:00.000Z',
}

let captured: InternalAxiosRequestConfig[] = []
let respond: (config: InternalAxiosRequestConfig) => ReturnType<AxiosAdapter> = config =>
  Promise.resolve({ data: OK_BODY, status: 200, statusText: 'OK', headers: {}, config })
const realAdapter = api.defaults.adapter

beforeEach(() => {
  captured = []
  respond = config =>
    Promise.resolve({ data: OK_BODY, status: 200, statusText: 'OK', headers: {}, config })
  api.defaults.adapter = config => {
    captured.push(config)
    return respond(config)
  }
})

afterEach(() => {
  api.defaults.adapter = realAdapter
})

function lastRequest(): InternalAxiosRequestConfig {
  const request = captured.at(-1)
  if (request === undefined) throw new Error('no request reached the transport')
  return request
}

describe('patchPersona on the real axios client', () => {
  it('sends PATCH with Content-Type application/merge-patch+json and the JSON of the patch', async () => {
    await patchPersona(ID, { displayName: 'Fairhaven Water', bio: null, verified: false })

    const request = lastRequest()
    expect(request.method).toBe('patch')
    expect(request.url).toBe(`/staff/personas/${ID}`)
    expect(request.baseURL).toBeTruthy()
    // Not the client's JSON default, and not rewritten by transformRequest.
    expect(String(request.headers.get('Content-Type'))).toBe('application/merge-patch+json')
    // A serialized JSON object — not "[object Object]", not form data.
    expect(typeof request.data).toBe('string')
    expect(JSON.parse(request.data as string)).toEqual({
      displayName: 'Fairhaven Water',
      bio: null,
      verified: false,
    })
    // `null` is on the wire as null (a clear), never as "".
    expect(request.data).toContain('"bio":null')
    expect(request.data).not.toContain('""')
  })

  it('an empty patch is the JSON object {}', async () => {
    await patchPersona(ID, {})
    expect(lastRequest().data).toBe('{}')
    expect(String(lastRequest().headers.get('Content-Type'))).toBe('application/merge-patch+json')
  })

  it('carries no exercise scope in the URL, query, headers or body (COR-001)', async () => {
    await patchPersona(ID, { location: 'Fairhaven' })
    const request = lastRequest()
    expect(request.params).toBeUndefined()
    expect(JSON.stringify(request.data)).not.toMatch(/exercise/i)
    expect(request.url).not.toMatch(/exercise/i)
    expect(JSON.stringify(request.headers.toJSON())).not.toMatch(/exercise/i)
  })

  it('does not install a per-request adapter on the live path (the shared transport is used)', async () => {
    await patchPersona(ID, {})
    expect(captured).toHaveLength(1)
  })

  it('a 400 from the real axios stack reaches the caller as the server\'s sentence, verbatim', async () => {
    respond = config =>
      Promise.reject(
        new AxiosError('Request failed with status code 400', AxiosError.ERR_BAD_REQUEST, config, null, {
          data: 'bio must be at most 512 characters.',
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config,
        }),
      )
    const failure = await patchPersona(ID, { bio: 'x' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PersonaEditError)
    expect(failure).toMatchObject({
      kind: 'rejected',
      status: 400,
      message: 'bio must be at most 512 characters.',
    })
  })
})
