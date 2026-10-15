/**
 * features/social/pinned/pinnedServices.live.test.ts
 * ---------------------------------------------------------------------------
 * LIVE mode (`USE_MOCK_DATA` off) of the two pin seams (demo-feedback story 07):
 *
 *  - `putPin` / `deletePin` call `PUT` / `DELETE /posts/{id}/reactions/pin` with no body,
 *    no params and no config (no identity on the wire, COR-001), reconcile on `active`,
 *    and REJECT a body that is not a pin state for that post (the hook then rolls back).
 *  - `resolvePinnedFeed` calls `GET /feed/pinned` with no params, keeps the server's order,
 *    narrows every post through `toParticipantView` (provenance and who-pinned dropped;
 *    `pinnedForAll` and `viewer.pinned` kept) and fails CLOSED on a malformed body.
 *
 * Own file: `vi.mock` of the mock switch is hoisted over the whole module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { deletePin, putPin } from './pinService'
import { resolvePinnedFeed } from './pinnedFeedService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

function ok<T>(data: T) {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: {} } as never)
}

function wirePost(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    authorPersonaId: 'persona-fairhavenwater',
    text: `post ${id}`,
    scenarioTime: '2033-09-04T13:15:00Z',
    counts: { reply: 1, repost: 2, like: 3 },
    ...extra,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pinService (live)', () => {
  it('PUTs the pin reaction route with no body and no config, and reconciles on active', async () => {
    const put = vi.spyOn(api, 'put').mockImplementation(() => ok({
      postId: 'post a/1',
      kind: 'pin',
      active: true,
      counts: { reply: 0, repost: 0, like: 0 },
      viewer: { liked: false, reposted: false, pinned: true },
    }))

    await expect(putPin('post a/1')).resolves.toEqual({ postId: 'post a/1', active: true })
    expect(put).toHaveBeenCalledWith('/posts/post%20a%2F1/reactions/pin', undefined, undefined)
  })

  it('DELETEs the pin reaction route to unpin', async () => {
    const del = vi.spyOn(api, 'delete').mockImplementation(() => ok({
      postId: 'post-1', kind: 'pin', active: false,
      counts: { reply: 0, repost: 0, like: 0 },
      viewer: { liked: false, reposted: false, pinned: false },
    }))

    await expect(deletePin('post-1')).resolves.toEqual({ postId: 'post-1', active: false })
    expect(del).toHaveBeenCalledWith('/posts/post-1/reactions/pin', undefined)
  })

  it('rejects a body for another post, another kind, or no active flag', async () => {
    for (const data of [
      { postId: 'post-other', kind: 'pin', active: true },
      { postId: 'post-1', kind: 'like', active: true },
      { postId: 'post-1', kind: 'pin' },
      null,
    ]) {
      vi.spyOn(api, 'put').mockImplementation(() => ok(data))
      await expect(putPin('post-1')).rejects.toThrow(/malformed/)
    }
  })
})

describe('resolvePinnedFeed (live)', () => {
  it('GETs /feed/pinned with no params and keeps the server order', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(() => ok({
      items: [
        { reason: 'exercise', post: wirePost('p-ex', { pinnedForAll: true }) },
        { reason: 'like', post: wirePost('p-like', { viewer: { liked: true, reposted: false, pinned: false } }) },
        { reason: 'pin', post: wirePost('p-pin', { viewer: { liked: false, reposted: false, pinned: true } }) },
      ],
    }))

    const items = await resolvePinnedFeed()

    expect(get).toHaveBeenCalledWith('/feed/pinned', undefined)
    expect(items.map(item => [item.reason, item.post.id])).toEqual([
      ['exercise', 'p-ex'],
      ['like', 'p-like'],
      ['pin', 'p-pin'],
    ])
    expect(items[0]?.post.pinnedForAll).toBe(true)
    expect(items[2]?.post.viewer).toEqual({ liked: false, reposted: false, pinned: true })
  })

  it('narrows every post: no provenance, never who pinned it (XC-002)', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => ok({
      items: [{
        reason: 'exercise',
        post: wirePost('p-ex', {
          pinnedForAll: true,
          origin: 'inject',
          actingHumanId: 'human-secret',
          pinnedForAllByHumanId: 'human-secret',
          pinnedForAllAt: '2033-09-04T13:20:00Z',
          createdWallClock: '2026-10-14T00:00:00Z',
        }),
      }],
    }))

    const [item] = await resolvePinnedFeed()

    expect(Object.keys(item?.post ?? {}).sort()).toEqual(
      ['authorPersonaId', 'counts', 'id', 'pinnedForAll', 'scenarioTime', 'text'],
    )
    expect(JSON.stringify(item)).not.toContain('human-secret')
  })

  it('fails closed on a malformed body (never an empty tab)', async () => {
    for (const data of [
      null,
      [],
      { items: 'nope' },
      { items: [{ reason: 'boosted', post: wirePost('p') }] },
      { items: [{ reason: 'pin', post: { id: 'p' } }] },
      { items: [{ reason: 'pin', post: wirePost('p', { viewer: { liked: true, reposted: false, pinned: 'yes' } }) }] },
    ]) {
      vi.spyOn(api, 'get').mockImplementation(() => ok(data))
      await expect(resolvePinnedFeed()).rejects.toThrow(/malformed/)
    }
  })
})
