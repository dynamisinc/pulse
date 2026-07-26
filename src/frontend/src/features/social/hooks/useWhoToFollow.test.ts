/**
 * features/social/hooks/useWhoToFollow.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-04 ACs for `useWhoToFollow()` (SOC-053, COR-001, D1-R1):
 *   - resolves the planner-seeded suggestion order, converged against
 *     `usePersonas()`, in the EXACT order the read returned — no re-sort;
 *   - the SOC-052 impersonator resolves like any other suggestion (unverified,
 *     unflagged, no differential treatment — D1-R1/D1-008);
 *   - never suggests the viewer's OWN persona;
 *   - never suggests an account the viewer ALREADY follows (a real follow
 *     edge via `followService`);
 *   - an id the suggestion list names but personas can't resolve is skipped,
 *     never crashes;
 *   - surfaces the first error from either read, failing closed (no partial/
 *     stale suggestion list).
 *
 * Runs through the REAL `SessionProvider` (resolves the mock session bound to
 * `persona-dreyes_fh`, mirrors `useFollow.test.ts`) and the shipped
 * `usePersonas()` mock adapter — no provider mocking needed for the "happy
 * path" specs. `whoToFollowService` is mocked per-test where a specific
 * suggestion order needs to be asserted; `followService`'s real mock edge
 * store is used (and reset) to exercise the already-followed exclusion.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { personaIdForHandle } from '@/features/personas'
import { followPersona, resetMockFollowEdges } from '../services/followService'
import { resolveSuggestedFollowIds } from '../services/whoToFollowService'
import { useWhoToFollow } from './useWhoToFollow'

vi.mock('../services/whoToFollowService', () => ({
  resolveSuggestedFollowIds: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SessionProvider, null, children)
}

beforeEach(() => {
  resetMockFollowEdges()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWhoToFollow — planner-seeded order, converged against personas (SOC-053)', () => {
  it('resolves suggestions in the EXACT order the read returned, never re-sorted', async () => {
    const ids = [
      personaIdForHandle('TheScoopHQ'),
      personaIdForHandle('FulcoEM'),
      personaIdForHandle('FairhavenWaterUpd'),
    ]
    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue(ids)

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions.map(p => p.id)).toEqual(ids)
  })

  it('includes the SOC-052 impersonator, unverified and unflagged (D1-R1/D1-008)', async () => {
    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue([
      personaIdForHandle('FairhavenWaterUpd'),
    ])

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions).toHaveLength(1)
    expect(result.current.suggestions[0]?.handle).toBe('FairhavenWaterUpd')
    expect(result.current.suggestions[0]?.verified).toBe(false)
  })

  it('skips an id the suggestion list names but personas cannot resolve — never crashes', async () => {
    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue([
      'persona-does-not-exist',
      personaIdForHandle('FulcoEM'),
    ])

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions.map(p => p.id)).toEqual([personaIdForHandle('FulcoEM')])
  })
})

describe('useWhoToFollow — the two exclusions this story owns (never a ranking)', () => {
  it('never suggests the viewer own persona', async () => {
    // The mock session is bound to persona-dreyes_fh (core/auth/sessionResolver.ts).
    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue([
      personaIdForHandle('FulcoEM'),
      'persona-dreyes_fh',
      personaIdForHandle('Newsline7'),
    ])

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ids = result.current.suggestions.map(p => p.id)
    expect(ids).not.toContain('persona-dreyes_fh')
    expect(ids).toEqual([personaIdForHandle('FulcoEM'), personaIdForHandle('Newsline7')])
  })

  it('never suggests an account the viewer already follows (a real follow edge)', async () => {
    await followPersona(personaIdForHandle('kwardFH'))

    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue([
      personaIdForHandle('kwardFH'),
      personaIdForHandle('FulcoEM'),
    ])

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ids = result.current.suggestions.map(p => p.id)
    expect(ids).not.toContain(personaIdForHandle('kwardFH'))
    expect(ids).toEqual([personaIdForHandle('FulcoEM')])
  })

  it('does NOT filter or reorder by verification status — only self/already-followed are excluded', async () => {
    vi.mocked(resolveSuggestedFollowIds).mockResolvedValue([
      personaIdForHandle('TheScoopHQ'), // unverified
      personaIdForHandle('FairhavenWaterUpd'), // unverified impersonator
      personaIdForHandle('FulcoEM'), // verified
    ])

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions.map(p => p.handle)).toEqual([
      'TheScoopHQ',
      'FairhavenWaterUpd',
      'FulcoEM',
    ])
  })
})

describe('useWhoToFollow — fails closed on error', () => {
  it('surfaces the suggestion read rejection with an empty suggestion list', async () => {
    vi.mocked(resolveSuggestedFollowIds).mockRejectedValue(new Error('suggestions unavailable'))

    const { result } = renderHook(() => useWhoToFollow(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.suggestions).toEqual([])
    expect(result.current.error).toBeInstanceOf(Error)
  })
})
