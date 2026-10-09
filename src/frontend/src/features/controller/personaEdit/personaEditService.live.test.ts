/**
 * features/controller/personaEdit/personaEditService.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE persona-edit call (`USE_MOCK_DATA` forced false; demo-polish story 21
 * / PE-FE). In its own file for the usual `vi.mock` hoisting reason: the
 * mock/live flip is a module-level constant.
 *
 * Pins, against PE-BE's shipped contract:
 *   - the request: `PATCH /staff/personas/{id}`, `Content-Type:
 *     application/merge-patch+json`, the body is exactly the patch passed in (only
 *     changed fields, `null` kept, `{}` valid), a request timeout, NO adapter
 *     override and NO exercise id anywhere (COR-001);
 *   - the 200 body is read as the updated staff persona, rebuilt from the contract
 *     keys (a stray key or `null` optional never reaches the console) and fails
 *     closed on a participant-shaped body or another persona's id;
 *   - every failure rejects (nothing swallowed) with staff copy: 400 -> the
 *     server's own sentence VERBATIM; 401 / 403 / 404 / 415 / 5xx / network each
 *     get their own message; a malformed 2xx says the edit may have been saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const patchMock = vi.hoisted(() => vi.fn())

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { patch: patchMock },
}))

import {
  MERGE_PATCH_CONTENT_TYPE,
  PERSONA_EDIT_ERROR_TEXT,
  PERSONA_EDIT_TIMEOUT_MS,
  PersonaEditError,
  parseStaffPersonaResponse,
  patchPersona,
} from './personaEditService'

const ID = '7f1c0c0e-0000-4000-8000-0000000000aa'

/**
 * A body shaped EXACTLY like the server's `StaffPersonaResponseDto.FromPersona` for a
 * persona WITHOUT a template — which is every persona `PersonaCastSeeder` creates, i.e.
 * the whole demo cast (Gate-1 H-1):
 *   - `templateId` is the EMPTY STRING (`PersonaTemplateId?.ToString() ?? string.Empty`);
 *   - `bio`, `avatarUrl`, `bannerUrl`, `location` are OMITTED when null
 *     (`JsonIgnoreCondition.WhenWritingNull`), never sent as `null`;
 *   - `avatarColor` is a palette hex derived from the handle, `initials` come from the
 *     display name, `joinedAt` is `yyyy-MM-ddTHH:mm:ss.fffZ`, and the three counts are
 *     ints (`followingCount` is 0 with no follow edges).
 */
function wireBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  }
}

function httpError(status: number, data?: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  })
}

function lastCall(): { url: string; body: unknown; config: Record<string, unknown> } {
  const call = patchMock.mock.calls.at(-1)
  if (call === undefined) throw new Error('api.patch was not called')
  return { url: call[0] as string, body: call[1], config: call[2] as Record<string, unknown> }
}

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({ data: wireBody() })
})

describe('patchPersona (live) — the request', () => {
  it('PATCHes /staff/personas/{id} as merge-patch+json with exactly the patch as the body', async () => {
    await patchPersona(ID, { displayName: 'Fairhaven Water', bio: null })

    const { url, body, config } = lastCall()
    expect(url).toBe(`/staff/personas/${ID}`)
    expect(body).toEqual({ displayName: 'Fairhaven Water', bio: null })
    expect(config.headers).toEqual({ 'Content-Type': 'application/merge-patch+json' })
    expect(MERGE_PATCH_CONTENT_TYPE).toBe('application/merge-patch+json')
    expect(config.timeout).toBe(PERSONA_EDIT_TIMEOUT_MS)
    // The LIVE path must not smuggle in the mock adapter.
    expect(config).not.toHaveProperty('adapter')
  })

  it('{} is a valid body', async () => {
    await patchPersona(ID, {})
    expect(lastCall().body).toEqual({})
  })

  it('sends no exercise scope anywhere (COR-001) and encodes the id', async () => {
    await patchPersona(ID, { verified: false })
    const { url, body, config } = lastCall()
    expect(JSON.stringify([url, body, config])).not.toMatch(/exercise/i)

    await patchPersona('a/b c', {}).catch(() => undefined)
    expect(lastCall().url).toBe('/staff/personas/a%2Fb%20c')
  })
})

describe('patchPersona (live) — the 200 body', () => {
  it('H-1: a TEMPLATE-LESS persona (templateId "", no optional keys) parses — the whole seeded cast', async () => {
    const body = wireBody()
    for (const absent of ['bio', 'avatarUrl', 'bannerUrl', 'location']) {
      expect(body).not.toHaveProperty(absent)
    }
    patchMock.mockResolvedValue({ data: body })

    const updated = await patchPersona(ID, { displayName: 'Fairhaven Water' })

    expect(updated).toEqual({
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
    })
    for (const absent of ['bio', 'avatarUrl', 'bannerUrl', 'location']) {
      expect(updated).not.toHaveProperty(absent)
    }
  })

  it('resolves with the staff persona rebuilt from the contract keys (everything set)', async () => {
    patchMock.mockResolvedValue({
      data: wireBody({
        templateId: '9a1c0c0e-0000-4000-8000-0000000000cc',
        bio: 'Hello',
        location: 'Fairhaven',
        avatarUrl: 'https://blob/a?sig=1',
        bannerUrl: 'https://blob/b?sig=2',
        followerCount: 4200,
        audienceMagnitude: 4200,
        followingCount: 3,
        stray: 'x',
      }),
    })
    const updated = await patchPersona(ID, { bio: 'Hello' })
    expect(updated).toMatchObject({
      templateId: '9a1c0c0e-0000-4000-8000-0000000000cc',
      bio: 'Hello',
      location: 'Fairhaven',
      avatarUrl: 'https://blob/a?sig=1',
      bannerUrl: 'https://blob/b?sig=2',
      followerCount: 4200,
      followingCount: 3,
    })
    expect(updated).not.toHaveProperty('stray')
  })

  it('accepts the other legitimately-empty or loose members the server can send', () => {
    // initials: "an empty string if none could be derived" (PersonaDerivedPresentation).
    expect(parseStaffPersonaResponse(wireBody({ initials: '' }), ID)).toMatchObject({ initials: '' })
    // The list read does not vocabulary-check audienceBand either.
    expect(parseStaffPersonaResponse(wireBody({ audienceBand: 'regional' }), ID)).toBeDefined()
    // templateId: "" today; absent or null would mean the same, never "malformed".
    const noTemplate = wireBody()
    delete noTemplate.templateId
    expect(parseStaffPersonaResponse(noTemplate, ID)).toMatchObject({ templateId: '' })
    expect(parseStaffPersonaResponse(wireBody({ templateId: null }), ID))
      .toMatchObject({ templateId: '' })
    // followingCount / audienceMagnitude are optional numbers.
    const lean = wireBody()
    delete lean.followingCount
    delete lean.audienceMagnitude
    expect(parseStaffPersonaResponse(lean, ID)).toBeDefined()
  })

  it('treats a null optional as absent', () => {
    const parsed = parseStaffPersonaResponse(
      wireBody({ bio: null, location: null, avatarUrl: null, bannerUrl: null }),
      ID,
    )
    expect(parsed).toBeDefined()
    for (const key of ['bio', 'location', 'avatarUrl', 'bannerUrl']) {
      expect(parsed).not.toHaveProperty(key)
    }
  })

  it('fails closed (malformed, may have saved) on a participant-shaped body, another id, or junk', async () => {
    const bodies: unknown[] = [
      wireBody({ personaType: undefined }), // participant projection: no archetype
      wireBody({ personaType: 'wizard' }),
      wireBody({ id: 'someone-else' }),
      wireBody({ verified: 'yes' }),
      wireBody({ kind: 'robot' }),
      wireBody({ displayName: '' }),
      wireBody({ handle: '' }),
      wireBody({ followerCount: 'many' }),
      wireBody({ followerCount: undefined }),
      'ok',
      [],
      null,
    ]
    for (const data of bodies) {
      patchMock.mockResolvedValue({ data })
      const failure = await patchPersona(ID, { verified: true }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(PersonaEditError)
      expect(failure).toMatchObject({
        kind: 'malformed',
        mayHaveSaved: true,
        message: PERSONA_EDIT_ERROR_TEXT.malformed,
      })
    }
  })
})

describe('patchPersona (live) — failures reject with staff copy', () => {
  async function failureOf(error: unknown): Promise<PersonaEditError> {
    patchMock.mockRejectedValue(error)
    const failure = await patchPersona(ID, { displayName: 'x' }).catch((caught: unknown) => caught)
    expect(failure).toBeInstanceOf(PersonaEditError)
    return failure as PersonaEditError
  }

  it('400: the server\'s own sentence, VERBATIM (a JSON string body)', async () => {
    const failure = await failureOf(httpError(400, 'displayName must be 1 to 100 characters.'))
    expect(failure.kind).toBe('rejected')
    expect(failure.status).toBe(400)
    expect(failure.message).toBe('displayName must be 1 to 100 characters.')
    expect(failure.mayHaveSaved).toBe(false)
  })

  it('400: every shipped text passes through untouched', async () => {
    for (const sentence of [
      'handle cannot be changed.',
      "Unknown field 'x'. Editable fields: displayName, bio, location, verified, avatarMediaId, bannerMediaId.",
      'avatarMediaId must name an image in this exercise, or be null to clear it.',
      'The request body must be a JSON object naming the fields to change (JSON merge-patch).',
      'The request body must be at most 16384 bytes.',
    ]) {
      expect((await failureOf(httpError(400, `  ${sentence}\n`))).message).toBe(sentence)
    }
  })

  it('400 with a ProblemDetails-ish object falls back to its message / detail / title', async () => {
    expect((await failureOf(httpError(400, { detail: 'bad things' }))).message).toBe('bad things')
    expect((await failureOf(httpError(400, { title: 'Bad Request' }))).message).toBe('Bad Request')
  })

  it('400 with no usable body still says something', async () => {
    expect((await failureOf(httpError(400, ''))).message).toBe(PERSONA_EDIT_ERROR_TEXT.rejectedFallback)
    expect((await failureOf(httpError(400, undefined))).message)
      .toBe(PERSONA_EDIT_ERROR_TEXT.rejectedFallback)
  })

  it('401 / 403 / 404 / 415 each get their own clear staff copy (and never echo a server body)', async () => {
    const unauthenticated = await failureOf(httpError(401, 'server text we must not show'))
    expect(unauthenticated).toMatchObject({ kind: 'unauthenticated', status: 401 })
    expect(unauthenticated.message).toBe(PERSONA_EDIT_ERROR_TEXT.unauthenticated)

    const forbidden = await failureOf(httpError(403, 'server text we must not show'))
    expect(forbidden).toMatchObject({ kind: 'forbidden', status: 403 })
    expect(forbidden.message).toBe(PERSONA_EDIT_ERROR_TEXT.forbidden)

    const notFound = await failureOf(httpError(404, ''))
    expect(notFound).toMatchObject({ kind: 'notFound', status: 404 })
    expect(notFound.message).toBe(PERSONA_EDIT_ERROR_TEXT.notFound)

    const unsupported = await failureOf(httpError(415, ''))
    expect(unsupported.status).toBe(415)
    expect(unsupported.message).toBe(PERSONA_EDIT_ERROR_TEXT.unsupportedMediaType)

    const messages = [unauthenticated, forbidden, notFound, unsupported].map(f => f.message)
    expect(new Set(messages).size).toBe(4)
    for (const message of messages) expect(message).not.toMatch(/server text we must not show/)
  })

  it('5xx: names the status', async () => {
    const failure = await failureOf(httpError(503, ''))
    expect(failure).toMatchObject({ kind: 'server', status: 503 })
    expect(failure.message).toBe(PERSONA_EDIT_ERROR_TEXT.server(503))
    expect(failure.message).toMatch(/503/)
  })

  it('no response at all (network / timeout): says the edit may not have been saved, safe to retry', async () => {
    const failure = await failureOf(Object.assign(new Error('Network Error'), { isAxiosError: true }))
    expect(failure.kind).toBe('network')
    expect(failure.status).toBeUndefined()
    expect(failure.message).toBe(PERSONA_EDIT_ERROR_TEXT.network)
    expect(failure.message).toMatch(/may not have been saved/)
    // A non-axios throw is not swallowed either.
    expect((await failureOf(new Error('boom'))).message).toBe('boom')
  })
})
