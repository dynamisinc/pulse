/**
 * features/social/hooks/useFeed.live.test.ts
 * ---------------------------------------------------------------------------
 * The UAT feed-bug regression test (feeds-discovery/01/04; COR-053, XC-002):
 * `useFeed()`'s baseline must be exactly what `resolveFeed()` resolves with —
 * in LIVE mode that is the backend's `GET /api/feed` response — never a
 * separate re-read of the in-tab mock `postStore`. Before this fix the hook
 * discarded `resolveFeed()`'s return value and called `postStore.getPosts()`
 * instead, so a real backend's persisted posts (engine-approved posts,
 * manually-created persona posts, a participant's own compose) never reached
 * the participant feed at all — this file pins that down.
 *
 * DRIVER. Rather than mocking `../services/feedService` itself (an
 * async-factory `vi.mock(..., async importOriginal => {...})` on THIS module
 * was found to leave `useFeed.ts`'s own import unmocked in this Vitest 4.1.10
 * setup — calling `importOriginal()` inside the factory appears to race the
 * real module's registration against consumers resolved after it, so
 * `useFeed.ts` ended up calling the REAL `resolveFeed`, not the stub; see
 * `useFeed.race.test.ts`'s header for the same note), this file mocks the
 * shared axios client (`@/core/services/api`) directly — mirrors
 * `liveReviewActions.test.ts` — and lets `resolveFeed`/`assembleFeedView`/
 * `usePersonas` run for REAL against the canned `GET` responses. This is
 * arguably the MORE faithful live-mode test anyway: it exercises
 * `resolveFeed`'s own `isPost` validation and `assembleFeedView`'s real
 * author-resolution convergence, not a bypassed stand-in for either.
 *
 * `@/core/auth` is mocked to a fixed, non-read-only, persona-bound session
 * (WR-005 fold): `useFeed` now reads the session itself for its own COR-015
 * guard. A synchronous mock (rather than the real `SessionProvider`, which
 * would itself call `/session` through the very `api.get` stub this file
 * replaces) keeps the existing fixtures/timing intact.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import type { Persona } from '@/features/personas'
import { useFeed } from './useFeed'

const MOCK_SESSION: Session = {
  exerciseId: 'ex-live-0001',
  accountId: 'acct-dreyes',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => MOCK_SESSION,
}))

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: { get: (...args: unknown[]) => getMock(...args) },
}))

/**
 * A single fixture author, shaped like a live `GET /api/personas` response in
 * the PARTICIPANT projection — no `personaType` (SOC-052/D1-008): the feed is
 * a participant surface, so the archetype tell is structurally absent here.
 */
const API_PERSONA: Persona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  verified: true,
  avatarColor: '#19647e',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 50232,
  joinedAt: '2025-07-08T12:00:00.000Z',
}

/** A fixture shaped like the live `GET /api/feed` → `ParticipantPostDto[]`
 * response (camelCase, no provenance fields). */
const API_POST = {
  id: 'post-api-live-0001',
  authorPersonaId: 'persona-fairhavenwater',
  text: 'Boil-water advisory lifted for Zones 2-4 — confirmed safe.',
  counts: { reply: 4, repost: 11, like: 30 },
  scenarioTime: '2033-09-05T09:00:00Z',
}

function mockApiOnce(feedResponse: unknown): void {
  getMock.mockImplementation((url: string) => {
    if (url === '/feed') return Promise.resolve({ data: feedResponse })
    if (url === '/personas') return Promise.resolve({ data: [API_PERSONA] })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

afterEach(() => {
  getMock.mockReset()
})

describe('useFeed — live-mode baseline is the resolveFeed() response, not postStore (UAT fix)', () => {
  it('renders exactly what the live GET /feed response resolved with', async () => {
    mockApiOnce([API_POST])

    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The API-shaped post came through — this is the UAT fix.
    expect(result.current.posts.map(p => p.id)).toEqual(['post-api-live-0001'])
    // None of the seeded mock-store posts leaked in alongside it.
    expect(result.current.posts.some(p => p.id === 'post-seed-fw-advisory')).toBe(false)
  })

  it('an empty live GET /feed response renders an empty feed', async () => {
    mockApiOnce([])

    const { result } = renderHook(() => useFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.posts).toEqual([])
  })
})
