/**
 * features/participantAdmin/cards/cardsService.test.ts
 * ---------------------------------------------------------------------------
 * The data seam: request shape (repeated plain `id`, no exercise id), chunking at 500,
 * typed errors that carry no secrets, the runtime guards, and the shipped mock adapter.
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
  resetMockCards,
  setMockCardsScenario,
} from './cardsMocks'
import { okResponse } from './cardsTestUtils'
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

describe('fetchRosterCards - request shape', () => {
  it('sends ONE request with no id (and no params at all) for an empty selection', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor([])))
    await fetchRosterCards([])
    expect(get).toHaveBeenCalledTimes(1)
    const [url, config] = get.mock.calls[0] ?? []
    expect(url).toBe(CARDS_ENDPOINT)
    expect(config?.params).toBeUndefined()
  })

  it('serializes ids as repeated plain `id=` params, not `id[]=`', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor(['a', 'b'])))
    await fetchRosterCards(['a', 'b'])
    const [url, config] = get.mock.calls[0] ?? []
    const wire = api.getUri({
      url,
      params: config?.params,
      paramsSerializer: config?.paramsSerializer,
    })
    expect(wire).toBe('/api/staff/roster/cards?id=a&id=b')
  })

  it('never sends an exercise id', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor(['a'])))
    await fetchRosterCards(['a'])
    const [url, config] = get.mock.calls[0] ?? []
    const wire = api.getUri({
      url,
      params: config?.params,
      paramsSerializer: config?.paramsSerializer,
    })
    expect(wire.toLowerCase()).not.toContain('exercise')
    expect(JSON.stringify(config?.params ?? {}).toLowerCase()).not.toContain('exercise')
  })

  it('sends one request for exactly 500 ids', async () => {
    const ids = idList(500)
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor(ids)))
    await fetchRosterCards(ids)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('chunks more than 500 ids into requests of at most 500, in order, and merges', async () => {
    const ids = idList(1201)
    const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
      const chunk = (config?.params as { id: string[] }).id
      return okResponse({
        exerciseName: 'Exercise A',
        cards: buildMockCards(chunk.length, chunk),
        skipped: [{ participantId: `skip-after-${chunk[0] ?? ''}`, reason: 'disabled' }],
      })
    })

    const result = await fetchRosterCards(ids)

    expect(get).toHaveBeenCalledTimes(3)
    const sent = get.mock.calls.map(([, config]) => (config?.params as { id: string[] }).id)
    expect(sent.map(chunk => chunk.length)).toEqual([500, 500, 201])
    expect(sent.flat()).toEqual(ids)
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
    const ids = idList(501) // two requests: 500 + 1
    let call = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1
      return okResponse({
        exerciseName: 'X',
        cards: call === 1
          ? [namedCard('z', 'Zoe Young'), namedCard('m', 'Mary Smith')]
          : [namedCard('a', 'adam Abel'), namedCard('l', '\u00C1lvaro Diaz')],
        skipped: [],
      })
    })
    const result = await fetchRosterCards(ids)
    expect(result.cards.map(card => card.name)).toEqual([
      'adam Abel',
      '\u00C1lvaro Diaz',
      'Mary Smith',
      'Zoe Young',
    ])
  })

  it('keeps ties in request order (a stable merge)', async () => {
    const ids = idList(501)
    let call = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1
      return okResponse({
        exerciseName: 'X',
        cards: [namedCard(`same-${call}`, 'Pat Lee')],
        skipped: [],
      })
    })
    const result = await fetchRosterCards(ids)
    expect(result.cards.map(card => card.participantId)).toEqual(['same-1', 'same-2'])
  })

  it('leaves a single response in the server\'s order (no client re-sort)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(okResponse({
      exerciseName: 'X',
      cards: [namedCard('z', 'Zoe Young'), namedCard('a', 'Adam Abel')],
      skipped: [],
    }))
    const result = await fetchRosterCards(['z', 'a'])
    expect(result.cards.map(card => card.name)).toEqual(['Zoe Young', 'Adam Abel'])
  })

  it('de-duplicates ids before chunking', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor(['a', 'b'])))
    await fetchRosterCards(['a', 'b', 'a', '', '  ', 'b'])
    const [, config] = get.mock.calls[0] ?? []
    expect((config?.params as { id: string[] }).id).toEqual(['a', 'b'])
  })

  it('fails the whole sheet when any chunk fails', async () => {
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
      calls += 1
      if (calls === 2) throw httpError(500)
      return okResponse(bodyFor(['x']))
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
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor([])))
    await expect(fetchRosterCards(input)).rejects.toMatchObject({ kind: 'badRequest' })
    expect(get).not.toHaveBeenCalled()
  })

  it('still sends the one no-id request for a truly empty input', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor([])))
    await fetchRosterCards([])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]?.[1]?.params).toBeUndefined()
  })
})

describe('fetchRosterCards - cancellation (React Query\'s AbortSignal)', () => {
  it('passes the signal to every request', async () => {
    const controller = new AbortController()
    const get = vi.spyOn(api, 'get').mockImplementation(async () => okResponse(bodyFor(['x'])))
    await fetchRosterCards(idList(501), controller.signal)
    expect(get).toHaveBeenCalledTimes(2)
    for (const [, config] of get.mock.calls) expect(config?.signal).toBe(controller.signal)
  })

  it('passes the signal on the no-id request too', async () => {
    const controller = new AbortController()
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor([])))
    await fetchRosterCards([], controller.signal)
    expect(get.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('makes no request at all when the signal has already fired', async () => {
    const controller = new AbortController()
    controller.abort()
    const get = vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor([])))
    await expect(fetchRosterCards(['a'], controller.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('stops after the chunk in flight when the signal fires, requesting no more', async () => {
    const controller = new AbortController()
    let calls = 0
    vi.spyOn(api, 'get').mockImplementation(async () => {
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
    vi.spyOn(api, 'get').mockRejectedValue(new CanceledError('canceled'))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('still completes normally with a signal that never fires', async () => {
    const controller = new AbortController()
    vi.spyOn(api, 'get').mockResolvedValue(okResponse(bodyFor(['a'])))
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
    [500, 'unavailable'],
  ] as const)('maps HTTP %i to the %s kind', async (status, kind) => {
    vi.spyOn(api, 'get').mockRejectedValue(httpError(status))
    const error = await fetchRosterCards([]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RosterCardsError)
    expect(error).toMatchObject({ kind, status })
  })

  it('maps a network failure (no response) to unavailable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network Error'))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('carries no response body, no request config and no cause (no secrets)', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(httpError(409))
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
    vi.spyOn(api, 'get').mockResolvedValue(okResponse(body))
    await expect(fetchRosterCards([])).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('copies only the known fields and drops a null optional', async () => {
    const card = { ...good.cards[0], agency: null, role: 'Chief', extra: 'ignored' }
    vi.spyOn(api, 'get').mockResolvedValue(okResponse({ ...good, cards: [card], extraTop: 1 }))
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
