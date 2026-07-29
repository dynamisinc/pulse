/**
 * features/social/hooks/useFollowedSet.test.ts
 * ---------------------------------------------------------------------------
 * Covers the follow-aware stream's predicate seam (feature: feeds-discovery,
 * story 08, #91): `useFollowedSet` — the stable "does the viewer follow this
 * account?" callback the Following feed's `admit` filter is built on.
 *
 *  - it resolves the viewer's followed set through `followService.resolveFollowing`
 *    (the server-authoritative seam — never the mock edge store directly);
 *  - a follow made MID-SESSION is picked up via `subscribeFollowChanges`, with
 *    the predicate keeping the SAME identity across the refresh (that identity
 *    stability is what stops `useFeedStream` re-subscribing on every toggle);
 *  - no viewer persona ⇒ no request at all, and `false` for everyone;
 *  - a failed read fails CLOSED (`false`), never asserting a follow the viewer
 *    may not have.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { followPersona, resetMockFollowEdges } from '../services/followService'
import { useFollowedSet } from './useFollowedSet'

const VIEWER = 'persona-dreyes_fh'
const TARGET = 'persona-fairhavenwater'

beforeEach(() => {
  vi.restoreAllMocks()
  resetMockFollowEdges()
})

afterEach(() => {
  resetMockFollowEdges()
})

describe('useFollowedSet — resolves the viewer\'s followed set', () => {
  it('answers true for a followed id and false for an unfollowed one', async () => {
    await followPersona(TARGET) // acts as the mock viewer persona

    const { result } = renderHook(() => useFollowedSet(VIEWER))

    await waitFor(() => expect(result.current.isFollowed(TARGET)).toBe(true))
    expect(result.current.isFollowed('persona-someone-else')).toBe(false)
  })

  it('issues no follow-graph read at all when there is no viewer persona', async () => {
    const getSpy = vi.spyOn(api, 'get')
    const { result } = renderHook(() => useFollowedSet(undefined))

    // Nothing to resolve for, so nothing is asked of the server, and the
    // predicate answers false for everyone.
    expect(getSpy).not.toHaveBeenCalled()
    expect(result.current.isFollowed(TARGET)).toBe(false)
  })
})

describe('useFollowedSet — a mid-session follow refreshes the set without changing identity', () => {
  it('starts admitting a newly-followed id, and the predicate reference is unchanged', async () => {
    const { result } = renderHook(() => useFollowedSet(VIEWER))
    await waitFor(() => expect(result.current.isFollowed(TARGET)).toBe(false))

    const predicateBefore = result.current.isFollowed

    await followPersona(TARGET)

    await waitFor(() => expect(result.current.isFollowed(TARGET)).toBe(true))
    // STABLE identity across the refresh — `useFeedStream`'s `admit` contract
    // depends on this (a new identity would tear down + restart the transport).
    expect(result.current.isFollowed).toBe(predicateBefore)
  })
})

describe('useFollowedSet — fails closed', () => {
  it('answers false for everyone when the follow-graph read rejects', async () => {
    await followPersona(TARGET)
    // The edge EXISTS in the store — only the read fails, so a `false` here can
    // only be the fail-closed path and not an empty graph.
    const getSpy = vi.spyOn(api, 'get').mockRejectedValue(new Error('graph unavailable'))

    const { result } = renderHook(() => useFollowedSet(VIEWER))

    // The read WAS attempted (so this is the rejection path, not a no-op) …
    await waitFor(() => expect(getSpy).toHaveBeenCalled())
    // … and it settled without fabricating a follow relationship: under the
    // Following label a fail-OPEN here would surface a pill counting accounts
    // the viewer does not follow.
    expect(result.current.isFollowed(TARGET)).toBe(false)
  })
})
