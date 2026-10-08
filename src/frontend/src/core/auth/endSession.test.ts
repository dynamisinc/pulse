/**
 * core/auth/endSession.test.ts
 * ---------------------------------------------------------------------------
 * Covers the shared client-session teardown: `endSession()` clears the shared
 * React Query cache (so no prior-user data survives into the next session on
 * the same tab) AND logs out, with the cache cleared SYNCHRONOUSLY before the
 * best-effort network call is awaited. `./logout` is mocked at the boundary
 * (its own token/network contract is covered by `logout.test.ts`); the real
 * shared `queryClient` singleton is used and reset between tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { endSession } from './endSession'
import { logout } from './logout'
import { queryClient } from '../services/queryClient'
import { ownPostStore } from '@/features/social/services/ownPostStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import {
  consumeReplyFocus,
  requestReplyFocus,
  resetReplyIntent,
} from '@/features/social/services/replyIntent'

vi.mock('./logout', () => ({ logout: vi.fn().mockResolvedValue(undefined) }))

const mockLogout = vi.mocked(logout)

beforeEach(() => {
  mockLogout.mockReset()
  mockLogout.mockResolvedValue(undefined)
  queryClient.clear()
  ownPostStore.resetForTests()
  removedPosts.resetForTests()
  resetReplyIntent()
})

describe('endSession', () => {
  it('clears cached server-state so no prior-session data survives', async () => {
    queryClient.setQueryData(['staff', 'assignments'], [{ exerciseId: 'ex-alpha' }])
    expect(queryClient.getQueryData(['staff', 'assignments'])).toBeDefined()

    await endSession()

    expect(queryClient.getQueryData(['staff', 'assignments'])).toBeUndefined()
  })

  it('logs out (delegates to the shared logout() helper) exactly once', async () => {
    await endSession()
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('clears the cache SYNCHRONOUSLY, before awaiting logout() (never blocks the redirect)', async () => {
    queryClient.setQueryData(['k'], 1)
    let cacheSeenInsideLogout: unknown = 'not-observed'
    mockLogout.mockImplementation(async () => {
      // logout() is awaited only AFTER endSession()'s synchronous clear(), so by
      // the time this runs the cache is already empty.
      cacheSeenInsideLogout = queryClient.getQueryData(['k'])
    })

    await endSession()

    expect(cacheSeenInsideLogout).toBeUndefined()
  })

  it('forgets the composer\'s session-scoped state: own posts and a pending reply intent (F4)', async () => {
    ownPostStore.add({
      id: 'post-own-1',
      authorPersonaId: 'persona-dreyes_fh',
      text: 'made in the previous session',
      counts: { reply: 0, repost: 0, like: 0 },
      scenarioTime: '2033-09-04T15:00:00Z',
    })
    requestReplyFocus('post-1')
    const heard = vi.fn()
    ownPostStore.subscribe(heard)

    await endSession()

    expect(ownPostStore.getAll()).toEqual([])
    expect(ownPostStore.has('post-own-1')).toBe(false)
    // A mounted feed is told, so it drops the rows rather than showing them until a refresh.
    expect(heard).toHaveBeenCalledTimes(1)
    expect(consumeReplyFocus('post-1')).toBe(false)
  })

  it('clears them SYNCHRONOUSLY too, before awaiting logout()', async () => {
    ownPostStore.add({
      id: 'post-own-2',
      authorPersonaId: 'persona-dreyes_fh',
      text: 'x',
      counts: { reply: 0, repost: 0, like: 0 },
      scenarioTime: '2033-09-04T15:00:00Z',
    })
    let seenInsideLogout: number | undefined
    mockLogout.mockImplementation(async () => {
      seenInsideLogout = ownPostStore.getAll().length
    })

    await endSession()

    expect(seenInsideLogout).toBe(0)
  })

  it('forgets the session\'s taken-down post ids so the next sign-in never inherits them (C5)', async () => {
    removedPosts.add('post-taken-down')
    const heard = vi.fn()
    removedPosts.subscribe(heard)

    await endSession()

    expect(removedPosts.has('post-taken-down')).toBe(false)
    expect(removedPosts.getAll().size).toBe(0)
    // A mounted feed is told, so it can show whatever it had hidden.
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('clears the removed ids SYNCHRONOUSLY too, before awaiting logout()', async () => {
    removedPosts.add('post-taken-down')
    let seenInsideLogout: number | undefined
    mockLogout.mockImplementation(async () => {
      seenInsideLogout = removedPosts.getAll().size
    })

    await endSession()

    expect(seenInsideLogout).toBe(0)
  })
})
