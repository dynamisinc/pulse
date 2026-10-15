/**
 * features/social/pinned/pinnedFeedService.mock.test.ts
 * ---------------------------------------------------------------------------
 * The MOCK `GET /api/feed/pinned` (demo-feedback story 07) applies the server's DF-5
 * rules, so dev / UAT-no-backend behaves like the real tab:
 *
 *  - exercise pins first, newest pin first; then the viewer's pins and likes MERGED,
 *    newest first; each post once with precedence exercise > pin > like;
 *  - an unpin / unlike takes the post off; replies are included; taken-down posts are not;
 *  - every post is participant-safe, with `pinnedForAll` and the viewer's flags set.
 *
 * Vitest runs in mock mode (`USE_MOCK_DATA` is on), so the real adapter is exercised
 * through the shared axios client.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { postStore } from '../services/postStore'
import { removedPosts } from '../services/removedPosts'
import {
  recordMockLike,
  recordMockPersonalPin,
  resetMockPins,
  setMockExercisePin,
  setMockPinFailure,
} from './mockPins'
import { resolvePinnedFeed } from './pinnedFeedService'

async function order() {
  return (await resolvePinnedFeed()).map(item => [item.reason, item.post.id])
}

beforeEach(() => {
  postStore.resetForTests()
  removedPosts.reset()
  resetMockPins({ exercisePins: [] })
})

afterEach(() => {
  resetMockPins()
  removedPosts.reset()
  postStore.resetForTests()
})

describe('mock pinned feed — DF-5', () => {
  it('is empty when nothing is pinned or liked', async () => {
    expect(await order()).toEqual([])
  })

  it('lists exercise pins first (newest pin first), then pins and likes merged newest first', async () => {
    setMockExercisePin('post-seed-fw-advisory', true)
    recordMockLike('post-seed-mvega-question', true)
    setMockExercisePin('post-seed-fulco-coordination', true)
    recordMockPersonalPin('post-seed-newsline7-breaking', true)
    recordMockLike('post-seed-kward-correction', true)

    expect(await order()).toEqual([
      ['exercise', 'post-seed-fulco-coordination'],
      ['exercise', 'post-seed-fw-advisory'],
      ['like', 'post-seed-kward-correction'],
      ['pin', 'post-seed-newsline7-breaking'],
      ['like', 'post-seed-mvega-question'],
    ])
  })

  it('lists each post once, with the strongest reason', async () => {
    recordMockLike('post-seed-fw-advisory', true)
    recordMockPersonalPin('post-seed-fw-advisory', true)
    setMockExercisePin('post-seed-fw-advisory', true)
    recordMockLike('post-seed-kward-correction', true)
    recordMockPersonalPin('post-seed-kward-correction', true)

    expect(await order()).toEqual([
      ['exercise', 'post-seed-fw-advisory'],
      ['pin', 'post-seed-kward-correction'],
    ])
  })

  it('re-pinning for everyone keeps the original pin place', async () => {
    setMockExercisePin('post-seed-fw-advisory', true)
    setMockExercisePin('post-seed-fulco-coordination', true)
    setMockExercisePin('post-seed-fw-advisory', true)

    expect((await order()).map(([, id]) => id)).toEqual([
      'post-seed-fulco-coordination',
      'post-seed-fw-advisory',
    ])
  })

  it('drops a post that is unpinned / unliked', async () => {
    recordMockPersonalPin('post-seed-fw-advisory', true)
    recordMockLike('post-seed-kward-correction', true)
    setMockExercisePin('post-seed-fulco-coordination', true)

    recordMockPersonalPin('post-seed-fw-advisory', false)
    recordMockLike('post-seed-kward-correction', false)
    setMockExercisePin('post-seed-fulco-coordination', false)

    expect(await order()).toEqual([])
  })

  it('excludes taken-down posts', async () => {
    recordMockLike('post-seed-kward-correction', true)
    recordMockLike('post-seed-mvega-question', true)
    removedPosts.add('post-seed-kward-correction')

    expect(await order()).toEqual([['like', 'post-seed-mvega-question']])
  })

  it('includes replies', async () => {
    postStore.appendPost({
      id: 'post-reply-1',
      exerciseId: 'ex-mock-0001',
      authorPersonaId: 'persona-kwardfh',
      actingHumanId: 'human-x',
      text: 'a reply',
      parentPostId: 'post-seed-fw-advisory',
      counts: { reply: 0, repost: 0, like: 0 },
      createdWallClock: '2026-07-01T00:00:00.000Z',
      scenarioTime: '2033-09-04T14:40:00Z',
      origin: 'participant',
    })
    recordMockPersonalPin('post-reply-1', true)

    const [item] = await resolvePinnedFeed()
    expect(item?.post.id).toBe('post-reply-1')
    expect(item?.post.inReplyTo?.postId).toBe('post-seed-fw-advisory')
  })

  it('serves participant-safe posts with pinnedForAll and the viewer flags', async () => {
    setMockExercisePin('post-seed-fwupd-rumor', true)
    recordMockPersonalPin('post-seed-fwupd-rumor', true)
    recordMockLike('post-seed-kward-correction', true)

    const [exercise, like] = await resolvePinnedFeed()

    expect(exercise?.post.pinnedForAll).toBe(true)
    expect(exercise?.post.viewer).toEqual({ liked: false, reposted: false, pinned: true })
    expect(like?.post.viewer).toEqual({ liked: true, reposted: false, pinned: false })
    expect(Object.prototype.hasOwnProperty.call(like?.post, 'pinnedForAll')).toBe(false)
    // The seeded rumor is an inject: no provenance reaches the participant view (XC-002).
    for (const key of ['origin', 'injectId', 'actingHumanId', 'createdWallClock', 'exerciseId']) {
      expect(Object.prototype.hasOwnProperty.call(exercise?.post, key)).toBe(false)
    }
  })

  it('rejects while the mock is failing', async () => {
    setMockPinFailure(true)
    await expect(resolvePinnedFeed()).rejects.toBeDefined()
  })

  it('seeds one exercise pin by default (dev shows the marker without a console)', async () => {
    resetMockPins()
    expect(await order()).toEqual([['exercise', 'post-seed-fw-advisory']])
  })
})
