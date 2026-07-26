/**
 * features/social/services/followFeedRoundTrip.test.ts
 * ---------------------------------------------------------------------------
 * THE WHOLE POINT of the WR-004 fold (Gate-1 warnings, #88/#121): before this
 * fix, `followService.ts`'s mock follow edges and `feedService.ts`'s
 * Following-scope mock filter were two DISCONNECTED stores. Every existing
 * spec for each service mocked (or stubbed) the OTHER side, so nothing in
 * the suite ever exercised them together — which is exactly how the bug
 * shipped invisibly: under `VITE_USE_MOCK_DATA=true` (UAT's own setting),
 * following an account through `followService.followPersona` never moved a
 * single post into `feedService.resolveFeed('following')`.
 *
 * This spec calls BOTH real modules together, through `followEdgeStore.ts`'s
 * now-shared state, and asserts the round trip an operator/participant would
 * actually observe: follow -> the account's posts appear in the Following
 * feed; unfollow -> they disappear again. No mock of either service — this
 * is the integration seam itself.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import { followPersona, unfollowPersona, resetMockFollowEdges } from './followService'
import { resolveFeed, setMockFollowingForTests } from './feedService'
import { postStore } from './postStore'

// A real seeded author (`postService.ts`'s `SEEDED_POSTS`) NOT in the mock
// store's default followed set (`FairhavenWater`/`kwardFH`), so following
// them is an observable change, not a no-op against an already-followed id.
const FULCOEM_ID = personaIdForHandle('FulcoEM')

describe('follow/unfollow -> Following feed round trip (WR-004 fold, #88/#121)', () => {
  beforeEach(() => {
    resetMockFollowEdges()
  })

  afterEach(() => {
    resetMockFollowEdges()
    postStore.resetForTests()
  })

  it('is not already in the Following feed before it is followed (sanity)', async () => {
    const before = await resolveFeed('following')
    expect(before.some(post => post.authorPersonaId === FULCOEM_ID)).toBe(false)
  })

  it('following a persona via followService moves their posts into the Following feed', async () => {
    await followPersona(FULCOEM_ID)

    const following = await resolveFeed('following')
    expect(following.some(post => post.authorPersonaId === FULCOEM_ID)).toBe(true)
  })

  it('unfollowing via followService removes their posts from the Following feed again', async () => {
    await followPersona(FULCOEM_ID)
    const followed = await resolveFeed('following')
    expect(followed.some(post => post.authorPersonaId === FULCOEM_ID)).toBe(true)

    await unfollowPersona(FULCOEM_ID)
    const unfollowed = await resolveFeed('following')
    expect(unfollowed.some(post => post.authorPersonaId === FULCOEM_ID)).toBe(false)
  })

  it('following one account never evicts another already-followed account from the feed', async () => {
    const fairhavenWaterId = personaIdForHandle('FairhavenWater')

    // Model the real dev/UAT default state explicitly (WR-004's "feed has
    // content before the reader follows anyone") rather than relying on
    // incidental module-load ordering — `resetMockFollowEdges()` in
    // `beforeEach` clears to empty (the shared clean-slate every OTHER
    // consumer of this store depends on); this test opts back INTO the
    // default on purpose.
    setMockFollowingForTests(undefined)

    await followPersona(FULCOEM_ID)
    const following = await resolveFeed('following')

    expect(following.some(post => post.authorPersonaId === fairhavenWaterId)).toBe(true)
    expect(following.some(post => post.authorPersonaId === FULCOEM_ID)).toBe(true)
  })
})
