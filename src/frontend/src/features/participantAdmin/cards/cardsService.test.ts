/**
 * features/participantAdmin/cards/cardsService.test.ts
 * ---------------------------------------------------------------------------
 * The data seam: the request is a POST with a JSON body (`{ participantIds }` or
 * `{ all: true }`, EL-20) and never an `id=` query parameter or an exercise id, chunking at
 * 500, typed errors that carry no secrets, the runtime guards, and the shipped mock adapter
 * including the 400 rules it enforces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, CanceledError, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import {
  CARDS_ENDPOINT,
  MAX_CARDS_PER_REQUEST,
  RosterCardsError,
  chunkIds,
  fetchRosterCards,
} from './cardsService'
import {
  MOCK_DEFAULT_CARD_COUNT,
  MOCK_EXERCISE_NAME,
  buildMockCards,
  mockCardsAdapter,
  resetMockCards,
  setMockCardsScenario,
} from './cardsMocks'
import { captureCardsWire, okResponse, spyOnCardsEndpoint } from './cardsTestUtils'
import type { RosterCardDto, RosterCardsDto } from './types'

function idList(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p-${String(i).padStart(5, '0')}`)
}

/** What the server would send for these ids: one card each, no skips. */
function bodyFor(ids: readonly string[], exerciseName = 'Exercise A'): RosterCardsDto {
  return { exerciseName, cards: buildMockCards(ids.length, ids), skipped: [] }
}

function httpError(status: number, data: unknown = { detail: 'https://x/join/SECRET' }): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, {
    data,
    status,
    statusText: '',
    headers: {},
    config,
  })
}

/** A minimal valid card for ordering tests. */
function namedCard(id: string, name: string): RosterCardDto {
  return {
    participantId: id,
    name,
    signInName: id,
    joinUrl: `https://h.example/join/${id}`,
    qrSvgDataUri: 'data:image/svg+xml;base64,QQ==',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  resetMockCards()
})

describe('chunkIds', () => {
  it('splits at the size and keeps order', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('defaults to the server cap of 500', () => {
    expect(MAX_CARDS_PER_REQUEST).toBe(500)
    expect(chunkIds(idList(501)).map(chunk => chunk.length)).toEqual([500, 1])
  })

  it('gives no chunks for no ids', () => {
    expect(chunkIds([])).toEqual([])
  })
})

/** The `participantIds` of a recorded call. */
function sentIds(call: { body: unknown }): string[] {
  return (call.body as { participantIds: string[] }).participantIds
}

describe('fetchRosterCards - the request is a POST with a JSON body (EL-20)', () => {
  it('posts exactly { all: true } for an empty selection (never an empty array)', async () => {
    const { requests } = captureCardsWire()
    await fetchRosterCards([])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('post')
    expect(requests[0]?.rawBody).toBe('{"all":true}')
    expect(requests[0]?.body).toEqual({ all: true })
  })

  it('posts { participantIds } for a selection, and nothing else in the body', async () => {
    const { requests } = captureCardsWire()
    await fetchRosterCards(['a', 'b'])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('post')
    expect(requests[0]?.rawBody).toBe('{"participantIds":["a","b"]}')
    expect(Object.keys(requests[0]?.body as object)).toEqual(['participantIds'])
  })

  it('goes to /api/staff/roster/cards as JSON, with no query string at all', async () => {
    const { requests } = captureCardsWire()
    await fetchRosterCards(['a'])
    await fetchRosterCards([])
    expect(requests.map(request => request.url)).toEqual([
      '/api/staff/roster/cards',
      '/api/staff/roster/cards',
    ])
    for (const request of requests) expect(request.contentType).toContain('application/json')
  })

  it('never puts an id in the URL: no id= and no id[]= for one id, many, everyone or chunks', async () => {
    const { requests } = captureCardsWire()
    await fetchRosterCards(['a'])
    await fetchRosterCards(idList(40))
    await fetchRosterCards([])
    await fetchRosterCards(idList(1201)) // three chunks
    expect(requests).toHaveLength(6)
    for (const { url } of requests) {
      expect(url).not.toContain('?')
      expect(url).not.toMatch(/[?&]ids?(\[\])?=/)
    }
  })

  it('never sends an exercise id', async () => {
    const { requests } = captureCardsWire()
    await fetchRosterCards(['a'])
    await fetchRosterCards([])
    for (const request of requests) {
      expect(request.rawBody.toLowerCase()).not.toContain('exercise')
      expect(request.url.toLowerCase()).not.toContain('exercise')
    }
  })

  it('never sends an empty participantIds array, whatever the input', async () => {
    const { requests } = captureCardsWire()
    for (const input of [[], ['a'], idList(501)]) await fetchRosterCards(input)
    for (const input of [[''], ['', ' ']]) {
      await expect(fetchRosterCards(input)).rejects.toMatchObject({ kind: 'badRequest' })
    }
    expect(requests).toHaveLength(4) // everyone, one id, and two chunks; none for the blanks
    for (const { body } of requests) {
      const ids = (body as { participantIds?: string[] }).participantIds
      if (ids !== undefined) expect(ids.length).toBeGreaterThan(0)
    }
  })

  it('sends one request for exactly 500 ids', async () => {
    const ids = idList(500)
    const { requests } = captureCardsWire()
    await fetchRosterCards(ids)
    expect(requests).toHaveLength(1)
    expect((requests[0]?.body as { participantIds: string[] }).participantIds).toEqual(ids)
  })

  it('chunks more than 500 ids into requests of at most 500, in order, and merges', async () => {
    const ids = idList(1201)
    const { calls } = spyOnCardsEndpoint(({ ids: chunk }) => ({
      exerciseName: 'Exercise A',
      cards: buildMockCards(chunk.length, chunk),
      skipped: [{ participantId: `skip-after-${chunk[0] ?? ''}`, reason: 'disabled' }],
    }))

    const result = await fetchRosterCards(ids)

    expect(calls).toHaveLength(3)
    const sent = calls.map(sentIds)
    expect(sent.map(chunk => chunk.length)).toEqual([500, 500, 201])
    expect(sent.flat()).toEqual(ids)
    for (const call of calls) expect(call.all).toBe(false)
    // Every person is on the merged sheet exactly once.
    expect(result.cards).toHaveLength(1201)
    expect(new Set(result.cards.map(card => card.participantId))).toEqual(new Set(ids))
    // Skipped entries are concatenated in request order.
    expect(result.skipped.map(entry => entry.participantId)).toEqual([
      'skip-after-p-00000',
      'skip-after-p-00500',
      'skip-after-p-01000',
    ])
    expect(result.exerciseName).toBe('Exercise A')
  })

  it('re-sorts the merged cards by name (case- and accent-insensitive) after more than one chunk', async () => {
    let call = 0
    spyOnCardsEndpoint(() => {
      call += 1
      return {
        exerciseName: 'X',
        cards: call === 1
          ? [namedCard('z', 'Zoe Young'), namedCard('m', 'Mary Smith')]
          : [namedCard('a', 'adam Abel'), namedCard('l', '\u00C1lvaro Diaz')],
        skipped: [],
      }
    })
    const result = await fetchRosterCards(idList(501)) // two requests: 500 + 1
    expect(result.cards.map(card => card.name)).toEqual([
      'adam Abel',
      '\u00C1lvaro Diaz',
      'Mary Smith',
      'Zoe Young',
    ])
  })

  it('keeps ties in request order (a stable merge)', async () => {
    let call = 0
    spyOnCardsEndpoint(() => {
      call += 1
      return { exerciseName: 'X', cards: [namedCard(`same-${call}`, 'Pat Lee')], skipped: [] }
    })
    const result = await fetchRosterCards(idList(501))
    expect(result.cards.map(card => card.participantId)).toEqual(['same-1', 'same-2'])
  })

  it('leaves a single response in the server\'s order (no client re-sort)', async () => {
    spyOnCardsEndpoint(() => ({
      exerciseName: 'X',
      cards: [namedCard('z', 'Zoe Young'), namedCard('a', 'Adam Abel')],
      skipped: [],
    }))
    const result = await fetchRosterCards(['z', 'a'])
    expect(result.cards.map(card => card.name)).toEqual(['Zoe Young', 'Adam Abel'])
  })

  it('de-duplicates ids and drops blanks before chunking', async () => {
    const { calls } = spyOnCardsEndpoint(() => bodyFor(['a', 'b']))
    await fetchRosterCards(['a', 'b', 'a', '', '  ', 'b'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual({ participantIds: ['a', 'b'] })
  })

  it('fails the whole sheet when any chunk fails', async () => {
    let calls = 0
    spyOnCardsEndpoint(() => {
      calls += 1
      return calls === 2 ? Promise.reject(httpError(500)) : bodyFor(['x'])
    })
    await expect(fetchRosterCards(idList(600))).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('fetchRosterCards - only an EMPTY input means everyone', () => {
  it.each([
    [['']],
    [['', '  ']],
    [['\t', '\n']],
  ])('refuses the non-empty but unusable input %j as badRequest and sends NOTHING', async input => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(okResponse(bodyFor([])))
    await expect(fetchRosterCards(input)).rejects.toMatchObject({ kind: 'badRequest' })
    expect(post).not.toHaveBeenCalled()
  })

  it('still asks for everyone, with the explicit { all: true }, for a truly empty input', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(okResponse(bodyFor([])))
    await fetchRosterCards([])
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[1]).toEqual({ all: true })
  })
})

describe('fetchRosterCards - cancellation (React Query\'s AbortSignal)', () => {
  it('passes the signal to every request', async () => {
    const controller = new AbortController()
    const post = vi.spyOn(api, 'post').mockImplementation(async () => okResponse(bodyFor(['x'])))
    await fetchRosterCards(idList(501), controller.signal)
    expect(post).toHaveBeenCalledTimes(2)
    for (const [, , config] of post.mock.calls) expect(config?.signal).toBe(controller.signal)
  })

  it('passes the signal on the no-id request too', async () => {
    const controller = new AbortController()
    const post = vi.spyOn(api, 'post').mockResolvedValue(okResponse(bodyFor([])))
    await fetchRosterCards([], controller.signal)
    expect(post.mock.calls[0]?.[2]?.signal).toBe(controller.signal)
  })

  it('makes no request at all when the signal has already fired', async () => {
    const controller = new AbortController()
    controller.abort()
    const post = vi.spyOn(api, 'post').mockResolvedValue(okResponse(bodyFor([])))
    await expect(fetchRosterCards(['a'], controller.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('stops after the chunk in flight when the signal fires, requesting no more', async () => {
    const controller = new AbortController()
    let calls = 0
    vi.spyOn(api, 'post').mockImplementation(async () => {
      calls += 1
      if (calls === 1) controller.abort() // the preview closed while chunk 1 was loading
      return okResponse(bodyFor(['x']))
    })
    await expect(fetchRosterCards(idList(1201), controller.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(calls).toBe(1)
  })

  it('maps an axios cancellation to the cancelled kind', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new CanceledError('canceled'))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('still completes normally with a signal that never fires', async () => {
    const controller = new AbortController()
    vi.spyOn(api, 'post').mockResolvedValue(okResponse(bodyFor(['a'])))
    const result = await fetchRosterCards(['a'], controller.signal)
    expect(result.cards).toHaveLength(1)
  })
})

describe('fetchRosterCards - errors', () => {
  it.each([
    [409, 'notConfigured'],
    [403, 'forbidden'],
    [401, 'unauthorized'],
    [400, 'badRequest'],
    [413, 'badRequest'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %i to the %s kind', async (status, kind) => {
    vi.spyOn(api, 'post').mockRejectedValue(httpError(status))
    const error = await fetchRosterCards([]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RosterCardsError)
    expect(error).toMatchObject({ kind, status })
  })

  it('maps a network failure (no response) to unavailable', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Network Error'))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('carries no response body, no request config and no cause (no secrets)', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(httpError(409))
    const error = await fetchRosterCards([]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RosterCardsError)
    const typed = error as RosterCardsError
    expect(typed.cause).toBeUndefined()
    expect(typed.message).not.toContain('SECRET')
    expect(JSON.stringify(typed)).not.toContain('SECRET')
    expect(Object.keys(typed).sort()).toEqual(['kind', 'name', 'status'])
  })
})

describe('fetchRosterCards - runtime guards', () => {
  const good = bodyFor(['a'])

  it.each([
    ['a non-object body', 'oops'],
    ['an empty body', undefined],
    ['a missing exerciseName', { cards: [], skipped: [] }],
    ['cards that are not an array', { ...good, cards: {} }],
    ['a card missing its joinUrl', { ...good, cards: [{ ...good.cards[0], joinUrl: undefined }] }],
    ['a card with an empty joinUrl', { ...good, cards: [{ ...good.cards[0], joinUrl: '' }] }],
    ['a card with a non-string qrSvgDataUri', { ...good, cards: [{ ...good.cards[0], qrSvgDataUri: 7 }] }],
    ['a skipped entry with an unknown reason', { ...good, skipped: [{ participantId: 'z', reason: 'nope' }] }],
    ['a skipped entry without an id', { ...good, skipped: [{ reason: 'disabled' }] }],
  ])('fails closed on %s', async (_label, body) => {
    vi.spyOn(api, 'post').mockResolvedValue(okResponse(body))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('copies only the known fields and drops a null optional', async () => {
    const card = { ...good.cards[0], agency: null, role: 'Chief', extra: 'ignored' }
    vi.spyOn(api, 'post').mockResolvedValue(okResponse({ ...good, cards: [card], extraTop: 1 }))
    const result = await fetchRosterCards([])
    expect(result.cards[0]).not.toHaveProperty('agency')
    expect(result.cards[0]).not.toHaveProperty('extra')
    expect(result.cards[0]).toMatchObject({ role: 'Chief' })
    expect(result).not.toHaveProperty('extraTop')
  })
})

describe('the shipped mock adapter (USE_MOCK_DATA)', () => {
  it('serves a realistic full set for an empty selection, with one skip per reason', async () => {
    const result = await fetchRosterCards([])
    expect(result.exerciseName).toBe(MOCK_EXERCISE_NAME)
    expect(result.cards).toHaveLength(MOCK_DEFAULT_CARD_COUNT)
    expect(result.skipped.map(entry => entry.reason).sort()).toEqual([
      'disabled',
      'noActiveLink',
      'notFound',
      'tokenUnrecoverable',
    ])
    // Some have agency/role, some one of them, some neither.
    expect(result.cards.some(card => card.agency && card.role)).toBe(true)
    expect(result.cards.some(card => !card.agency && !card.role)).toBe(true)
    // Every QR is the server's wire form.
    for (const card of result.cards) {
      expect(card.qrSvgDataUri).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/)
      expect(card.joinUrl).toMatch(/^https:\/\/pulse-uat\.cobrasoftware\.com\/join\/.{22}$/)
    }
  })

  it('serves as many cards as ids requested, keyed to those ids, with no skips', async () => {
    const result = await fetchRosterCards(['id-1', 'id-2', 'id-3'])
    expect(result.cards.map(card => card.participantId)).toEqual(['id-1', 'id-2', 'id-3'])
    expect(result.skipped).toEqual([])
  })

  it('chunks a large selection through the mock without tripping its 500-id cap', async () => {
    const result = await fetchRosterCards(idList(1100))
    expect(result.cards).toHaveLength(1100)
  })

  it.each([
    ['notConfigured', 'notConfigured', 409],
    ['forbidden', 'forbidden', 403],
    ['unauthorized', 'unauthorized', 401],
    ['serverError', 'unavailable', 500],
  ] as const)('the %s scenario rejects as a %s error', async (scenario, kind, status) => {
    setMockCardsScenario(scenario)
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind, status })
  })
})

describe('the shipped mock adapter enforces the server\'s 400 rules (EL-20)', () => {
  /** POSTs `data` through the REAL axios pipeline into the mock adapter. */
  function postToMock(data: unknown) {
    return api.post(CARDS_ENDPOINT, data, { adapter: mockCardsAdapter })
  }

  it.each([
    ['both participantIds and all', { participantIds: ['a'], all: true }],
    ['neither participantIds nor all', {}],
    ['no body at all', undefined],
    ['an empty participantIds array', { participantIds: [] }],
    ['more than 500 ids', { participantIds: idList(501) }],
    ['an unknown property beside participantIds', { participantIds: ['a'], includeDisabled: true }],
    ['an unknown property beside all', { all: true, extra: 1 }],
    ['the old spelling ids', { ids: ['a'] }],
    ['all: false', { all: false }],
    ['all as a string', { all: 'true' }],
    ['participantIds as a string', { participantIds: 'a' }],
    ['participantIds holding a non-string', { participantIds: ['a', 1] }],
    ['a JSON array body', ['a']],
    ['a JSON null body', null],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 to %s', async (_label, data) => {
    const error = await postToMock(data).catch((e: unknown) => e)
    expect(error).toMatchObject({ response: { status: 400 } })
    const detail = (error as AxiosError<{ detail?: string }>).response?.data?.detail
    expect(typeof detail === 'string' && detail.length > 0).toBe(true)
  })

  it('accepts exactly 500 ids, a repeated id (de-duplicated) and { all: true }', async () => {
    const full = await postToMock({ participantIds: idList(500) })
    expect((full.data as RosterCardsDto).cards).toHaveLength(500)

    const repeated = await postToMock({ participantIds: ['a', 'a', 'b'] })
    expect((repeated.data as RosterCardsDto).cards.map(card => card.participantId)).toEqual(['a', 'b'])

    const everyone = await postToMock({ all: true })
    expect((everyone.data as RosterCardsDto).cards).toHaveLength(MOCK_DEFAULT_CARD_COUNT)
  })

  it('serves the same everyone set whether reached through the service or directly', async () => {
    const direct = (await postToMock({ all: true })).data as RosterCardsDto
    const viaService = await fetchRosterCards([])
    expect(viaService.cards.map(card => card.participantId))
      .toEqual(direct.cards.map(card => card.participantId))
    expect(viaService.skipped).toEqual(direct.skipped)
  })

  it('the service itself never trips those rules (it would surface as a thrown error)', async () => {
    await expect(fetchRosterCards([])).resolves.toBeDefined()
    await expect(fetchRosterCards(['a'])).resolves.toBeDefined()
    await expect(fetchRosterCards(idList(1100))).resolves.toBeDefined()
  })
})
