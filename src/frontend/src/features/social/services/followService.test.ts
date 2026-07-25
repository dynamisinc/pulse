/**
 * features/social/services/followService.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-02 ACs for the follow/unfollow write + read seam (SOC-051,
 * COR-001, COR-015):
 *   - the SHIPPED mock path is idempotent (follow twice / unfollow a
 *     non-edge both succeed silently) and round-trips through
 *     `resolveFollowing`/`resolveFollowers`;
 *   - the BOUNDARY-mocked path (mirrors `personaService.test.ts`) asserts the
 *     exact wire contract — `POST`/`DELETE /personas/{id}/follow`,
 *     `GET /personas/{id}/following|followers` — and that a malformed id-list
 *     body fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import {
  followPersona,
  unfollowPersona,
  resolveFollowing,
  resolveFollowers,
  resetMockFollowEdges,
} from './followService'

/** Casts an arbitrary body into the shape `api.get`'s mock return expects. */
function apiBody(data: unknown): Awaited<ReturnType<typeof api.get>> {
  return { data } as Awaited<ReturnType<typeof api.get>>
}

describe('followPersona / unfollowPersona / resolveFollowing (shipped mock path)', () => {
  beforeEach(() => {
    resetMockFollowEdges()
  })

  it('follows a persona, and the edge shows up in resolveFollowing for the viewer', async () => {
    await followPersona('persona-fairhavenwater')
    const following = await resolveFollowing('persona-dreyes_fh')
    expect(following).toContain('persona-fairhavenwater')
  })

  it('is idempotent: following twice does not throw and does not duplicate the edge', async () => {
    await followPersona('persona-fairhavenwater')
    await expect(followPersona('persona-fairhavenwater')).resolves.toBeUndefined()

    const following = await resolveFollowing('persona-dreyes_fh')
    expect(following.filter(id => id === 'persona-fairhavenwater')).toHaveLength(1)
  })

  it('unfollows a followed persona, removing the edge', async () => {
    await followPersona('persona-fairhavenwater')
    await unfollowPersona('persona-fairhavenwater')

    const following = await resolveFollowing('persona-dreyes_fh')
    expect(following).not.toContain('persona-fairhavenwater')
  })

  it('is idempotent: unfollowing a non-edge does not throw', async () => {
    await expect(unfollowPersona('persona-never-followed')).resolves.toBeUndefined()
  })

  it('resolveFollowers reflects the same edge from the followed side', async () => {
    await followPersona('persona-fulcoem')
    const followers = await resolveFollowers('persona-fulcoem')
    expect(followers).toContain('persona-dreyes_fh')
  })
})

describe('resolveFollowing / resolveFollowers (boundary-mocked wire contract)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('GETs /personas/{id}/following and returns the id array', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a', 'persona-b']))
    const ids = await resolveFollowing('persona-x')

    expect(spy).toHaveBeenCalledWith('/personas/persona-x/following', expect.anything())
    expect(ids).toEqual(['persona-a', 'persona-b'])
  })

  it('GETs /personas/{id}/followers and returns the id array', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-c']))
    const ids = await resolveFollowers('persona-x')

    expect(spy).toHaveBeenCalledWith('/personas/persona-x/followers', expect.anything())
    expect(ids).toEqual(['persona-c'])
  })

  it('fails closed when resolveFollowing gets a non-id-array body', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody({ nope: true }))
    await expect(resolveFollowing('persona-x')).rejects.toThrow()
  })

  it('fails closed when resolveFollowers gets a body containing a non-string element', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody(['persona-a', 42]))
    await expect(resolveFollowers('persona-x')).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting an empty list', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolveFollowing('persona-x')).rejects.toThrow('network down')
  })
})

describe('followPersona / unfollowPersona (boundary-mocked wire contract)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs /personas/{id}/follow with no client-supplied actor in the body', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue(apiBody(undefined))
    await followPersona('persona-x')
    expect(spy).toHaveBeenCalledWith('/personas/persona-x/follow', undefined, expect.anything())
  })

  it('DELETEs /personas/{id}/follow', async () => {
    const spy = vi.spyOn(api, 'delete').mockResolvedValue(apiBody(undefined))
    await unfollowPersona('persona-x')
    expect(spy).toHaveBeenCalledWith('/personas/persona-x/follow', expect.anything())
  })

  it('propagates a follow request failure rather than swallowing it', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('server refused'))
    await expect(followPersona('persona-x')).rejects.toThrow('server refused')
  })

  it('propagates an unfollow request failure rather than swallowing it', async () => {
    vi.spyOn(api, 'delete').mockRejectedValue(new Error('server refused'))
    await expect(unfollowPersona('persona-x')).rejects.toThrow('server refused')
  })
})
