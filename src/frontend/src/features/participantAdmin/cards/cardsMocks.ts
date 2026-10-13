/**
 * features/participantAdmin/cards/cardsMocks.ts
 * ---------------------------------------------------------------------------
 * The MOCK adapter for `GET /api/staff/roster/cards` (easy-login story 12), so the
 * card sheet, the preview and the print layout can be built, reviewed and tested with
 * no backend. It follows the FROZEN contract in docs/features/easy-login/
 * implementation.md ("cards (staff)") and is swapped in at exactly ONE flip point,
 * `USE_MOCK_CARDS` in `cardsService.ts` (= `USE_MOCK_DATA`), never per call. Delete this
 * file's adapter when the live endpoint (backend story 04) is the only path.
 *
 * WHAT IT SERVES
 *   - No `id` params ("every eligible participant"): a realistic set of
 *     {@link MOCK_DEFAULT_CARD_COUNT} cards (two full pages plus a part page, so the
 *     page break and the short last page can be reviewed) AND one skipped entry for each
 *     of the four reasons (`noActiveLink`, `disabled`, `tokenUnrecoverable`, `notFound`).
 *   - One or more `id` params: that many cards, no skips. IDs ARE NOT LOOKED UP. The mock
 *     cannot know the ids the roster screen's own mock invents, so the i-th requested id
 *     is given the i-th mock person's card (re-keyed to the id you sent). That keeps the
 *     composed mock screen honest where it matters here: "Print cards (N)" yields N cards.
 *   - More than 500 `id`s: a 400 ProblemDetails, exactly as the server answers (the
 *     service chunks at 500, so this is only reachable if that chunking regresses).
 *
 * The cards mix agency and role present, one present without the other, and neither;
 * one name has diacritics and one is very long, so the layout is reviewed against the
 * awkward cases, not only the tidy ones.
 *
 * THE FAKE QR IS NOT SCANNABLE. It is a small deterministic SVG that LOOKS like a QR
 * (three finder squares plus a pseudo-random module field), built as a base64 data URI
 * in the same `data:image/svg+xml;base64,...` form the server returns. The tokens in the
 * mock join URLs are obviously fake and grant nothing. Scanning a real QR from paper is
 * on the manual checklist and needs the live backend.
 *
 * ERROR SCENARIOS. {@link setMockCardsScenario} switches the adapter to answer `409`
 * (join links not configured), `403` (wrong role) or `500`, so the preview's error
 * states are reachable and testable. Module state, default `'ok'`; tests call
 * {@link resetMockCards} in `afterEach`.
 *
 * World: STAFF (data only). No UI, no COBRA.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import type { RosterCardDto, RosterCardSkippedDto, RosterCardsDto } from './types'

/** The exercise name every mock response carries. */
export const MOCK_EXERCISE_NAME = 'Coastal Surge (Mock Exercise)'

/** How many cards "every eligible participant" yields: two full pages of eight plus four. */
export const MOCK_DEFAULT_CARD_COUNT = 20

/** The SPA origin the mock join URLs point at (UAT's, per EL-6). */
const MOCK_SITE = 'https://pulse-uat.cobrasoftware.com'

/** The cap the real endpoint enforces (`MaxCardsPerRequest`). */
const MOCK_MAX_IDS = 500

interface MockPerson {
  readonly name: string
  readonly agency?: string
  readonly role?: string
  readonly signInName: string
}

/** Hand-written people first (the awkward cases among them), then synthetic filler. */
const MOCK_PEOPLE: readonly MockPerson[] = [
  { name: 'Jane Smith', agency: 'Fulco County Emergency Management', role: 'EOC Liaison', signInName: 'jsmith' },
  { name: 'José Álvarez', agency: 'Harbor Fire & Rescue', role: 'Operations Chief', signInName: 'jalvarez' },
  { name: "Mary-Ann O'Neil", agency: 'County Health Department', signInName: 'moneil' },
  { name: 'Madonna', signInName: 'madonna' },
  { name: 'Priya Raman', agency: 'Regional Medical Center', role: 'Incident Commander', signInName: 'praman' },
  { name: 'Tom Becker', role: 'Public Information Officer', signInName: 'tbecker' },
  { name: 'Aisha Okafor', agency: 'City Public Works', role: 'Roads Supervisor', signInName: 'aokafor' },
  { name: 'Liam Nguyen', agency: 'State Police, Troop C', role: 'Watch Commander', signInName: 'lnguyen' },
  {
    name: 'Dr. Alexandria Montgomery-Featherstonehaugh',
    agency: 'Office of Emergency Preparedness and Community Resilience',
    role: 'Deputy Director of Public Information and Joint Information Center Operations',
    signInName: 'amontgomery-featherstonehaugh',
  },
  { name: 'Carlos Mendes', agency: 'Red Cross, Coastal Chapter', role: 'Shelter Manager', signInName: 'cmendes' },
  { name: 'Hannah Lindqvist', agency: 'Port Authority', role: 'Harbor Master', signInName: 'hlindqvist' },
  { name: 'Omar Haddad', agency: 'Metro Transit', signInName: 'ohaddad' },
  { name: 'Grace Whitfield', agency: 'County Sheriff', role: 'Dispatch Supervisor', signInName: 'gwhitfield' },
  { name: 'Ng', agency: 'School District 4', role: 'Transportation Lead', signInName: 'ng1' },
  { name: 'Beatrice Duval', agency: 'Power & Light', role: 'Outage Coordinator', signInName: 'bduval' },
  { name: 'Samuel Ortiz', agency: 'Volunteer Fire Company 2', role: 'Chief', signInName: 'sortiz' },
]

/** A stable, obviously fake id for the i-th mock person (1-based). */
export function mockParticipantId(index: number): string {
  return `mock-participant-${String(index).padStart(4, '0')}`
}

/** The i-th mock person (0-based): hand-written first, then deterministic filler. */
function personAt(index: number): MockPerson {
  const known = MOCK_PEOPLE[index]
  if (known !== undefined) return known
  const n = index + 1
  return {
    name: `Mock Participant ${n}`,
    agency: index % 3 === 0 ? undefined : 'Mock Agency',
    role: index % 2 === 0 ? undefined : 'Mock Role',
    signInName: `mparticipant${n}`,
  }
}

// ---------------------------------------------------------------- fake QR

/** Modules per side of the fake QR (version 2), before the quiet zone. */
const QR_MODULES = 25
const QR_QUIET = 2

/** True when (x, y) is inside a 7x7 finder square or its 1-module separator. */
function inFinderZone(x: number, y: number): boolean {
  const near = (v: number) => v <= 7
  const far = (v: number) => v >= QR_MODULES - 8
  return (near(x) && near(y)) || (far(x) && near(y)) || (near(x) && far(y))
}

/** A finder square: 7x7 ring, 1-module gap, 3x3 centre. */
function finderModules(originX: number, originY: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6
      const centre = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
      if (ring || centre) out.push([originX + dx, originY + dy])
    }
  }
  return out
}

/** The SVG text of a QR-looking placeholder, deterministic in `seed`. */
function mockQrSvg(seed: number): string {
  const dark: Array<[number, number]> = [
    ...finderModules(0, 0),
    ...finderModules(QR_MODULES - 7, 0),
    ...finderModules(0, QR_MODULES - 7),
  ]
  // A small LCG: same seed, same pattern, no Math.random (stable snapshots and reviews).
  let state = (seed * 2654435761 + 12345) >>> 0
  for (let y = 0; y < QR_MODULES; y++) {
    for (let x = 0; x < QR_MODULES; x++) {
      if (inFinderZone(x, y)) continue
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      if ((state >>> 16) % 2 === 0) dark.push([x, y])
    }
  }
  const size = QR_MODULES + QR_QUIET * 2
  const path = dark.map(([x, y]) => `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  )
}

/** `data:image/svg+xml;base64,...`, the exact form the server returns. */
function mockQrDataUri(seed: number): string {
  return `data:image/svg+xml;base64,${btoa(mockQrSvg(seed))}`
}

/** A fake 22-character base64url-looking token. Grants nothing. */
function mockToken(index: number): string {
  return `MockTkn${String(index).padStart(4, '0')}-xxxxxxxxxx`.slice(0, 22)
}

// ---------------------------------------------------------------- builders

/**
 * `count` mock cards in the frozen wire shape. Pure and deterministic; exported for the
 * tests and for anyone reviewing the layout against a bigger set (e.g. 100 cards).
 * `participantIds`, when given, re-keys the i-th card to the i-th id.
 */
export function buildMockCards(
  count: number,
  participantIds: readonly string[] = [],
): RosterCardDto[] {
  const cards: RosterCardDto[] = []
  for (let i = 0; i < count; i++) {
    const person = personAt(i)
    const joinUrl = `${MOCK_SITE}/join/${mockToken(i + 1)}`
    cards.push({
      participantId: participantIds[i] ?? mockParticipantId(i + 1),
      name: person.name,
      ...(person.agency !== undefined ? { agency: person.agency } : {}),
      ...(person.role !== undefined ? { role: person.role } : {}),
      signInName: person.signInName,
      joinUrl,
      qrSvgDataUri: mockQrDataUri(i + 1),
    })
  }
  return cards
}

/** One skipped entry per reason, for the "every eligible participant" request. */
export function buildMockSkipped(): RosterCardSkippedDto[] {
  return [
    { participantId: mockParticipantId(MOCK_DEFAULT_CARD_COUNT + 1), reason: 'noActiveLink' },
    { participantId: mockParticipantId(MOCK_DEFAULT_CARD_COUNT + 2), reason: 'disabled' },
    { participantId: mockParticipantId(MOCK_DEFAULT_CARD_COUNT + 3), reason: 'tokenUnrecoverable' },
    { participantId: mockParticipantId(MOCK_DEFAULT_CARD_COUNT + 4), reason: 'notFound' },
  ]
}

// ---------------------------------------------------------------- scenarios

/** Which answer the mock adapter gives. */
export type MockCardsScenario = 'ok' | 'notConfigured' | 'forbidden' | 'serverError'

let scenario: MockCardsScenario = 'ok'

/** Switches the mock's answer (dev and tests). */
export function setMockCardsScenario(next: MockCardsScenario): void {
  scenario = next
}

/** Back to the happy path. Call in `afterEach`. */
export function resetMockCards(): void {
  scenario = 'ok'
}

/** A rejected axios response, as a real HTTP error status reaches the service. */
function httpError(
  config: InternalAxiosRequestConfig,
  status: number,
  title: string,
  detail: string,
): AxiosError {
  const response = {
    data: { title, status, detail },
    status,
    statusText: title,
    headers: {},
    config,
  }
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  )
}

/** The `id` values on the request URL, read off the REAL serialization (`id=a&id=b`). */
function requestedIds(config: InternalAxiosRequestConfig): string[] {
  return new URL(api.getUri(config), 'http://mock.invalid').searchParams.getAll('id')
}

/**
 * The mock adapter. Rejects with a real `AxiosError` for the error scenarios (a resolved
 * non-2xx response would be read as success: `validateStatus` runs inside the built-in
 * adapters, not in the dispatcher).
 */
export const mockCardsAdapter: AxiosAdapter = config => {
  if (scenario === 'notConfigured') {
    return Promise.reject(httpError(config, 409, 'Conflict', 'Join links are not configured.'))
  }
  if (scenario === 'forbidden') {
    return Promise.reject(httpError(config, 403, 'Forbidden', 'Your role cannot print cards.'))
  }
  if (scenario === 'serverError') {
    return Promise.reject(httpError(config, 500, 'Server Error', 'Something went wrong.'))
  }

  const ids = requestedIds(config)
  if (ids.length > MOCK_MAX_IDS) {
    return Promise.reject(
      httpError(config, 400, 'Bad Request', `At most ${MOCK_MAX_IDS} ids per request.`),
    )
  }

  const body: RosterCardsDto = ids.length === 0
    ? {
      exerciseName: MOCK_EXERCISE_NAME,
      cards: buildMockCards(MOCK_DEFAULT_CARD_COUNT),
      skipped: buildMockSkipped(),
    }
    : {
      exerciseName: MOCK_EXERCISE_NAME,
      cards: buildMockCards(ids.length, ids),
      skipped: [],
    }

  return Promise.resolve({
    data: body,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}
