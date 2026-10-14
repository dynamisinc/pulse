/**
 * features/controller/services/takedownService.test.ts
 * ---------------------------------------------------------------------------
 * The takedown call in MOCK mode (`npm run dev`; the default under Vitest) - the whole beat is
 * demonstrable without a backend (demo-polish C5, story 22 "Mock mode"):
 *  - it REMOVES the post from `postStore` (the mock backend's soft delete: the next feed read no
 *    longer returns it) and records the id in `removedPosts` (what an open participant feed reacts
 *    to, and what turns the console row to "Removed");
 *  - an id the store does not hold is the mock's 404 - the same sentence the UI shows for the real
 *    one; a repeat of an already-removed id succeeds (idempotent, like the server);
 *  - it makes NO network call (the shared axios client is never touched);
 *  - an invalid category rejects before anything changes;
 *  - the post really is gone from the feed read, so a remount or refresh cannot resurrect it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveFeed } from '@/features/social/services/feedService'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import type { TakedownCategory } from './takedownService'
import { TakedownError, isPostRemoved, takeDownPost } from './takedownService'

// Only `delete` is replaced (it must never be reached in mock mode); `get` stays real so the feed
// read below goes through the shipped mock adapter.
const deleteMock = vi.fn()
vi.mock('@/core/services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/services/api')>()
  const patched = Object.assign(actual.api, { delete: (...args: unknown[]) => deleteMock(...args) })
  return { ...actual, api: patched }
})

const SEEDED_ID = 'post-seed-fwupd-rumor'

beforeEach(() => {
  deleteMock.mockReset()
  postStore.resetForTests()
  removedPosts.resetForTests()
})

afterEach(() => {
  postStore.resetForTests()
  removedPosts.resetForTests()
})

describe('takeDownPost (mock mode)', () => {
  it('removes the post from the store and records the id - with no network call', async () => {
    expect(postStore.getPosts().some(post => post.id === SEEDED_ID)).toBe(true)

    await takeDownPost(SEEDED_ID, 'pii')

    expect(postStore.getPosts().some(post => post.id === SEEDED_ID)).toBe(false)
    expect(isPostRemoved(SEEDED_ID)).toBe(true)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('makes the post disappear from the next feed read (no resurrection on remount)', async () => {
    expect((await resolveFeed()).map(post => post.id)).toContain(SEEDED_ID)

    await takeDownPost(SEEDED_ID, 'other')

    expect((await resolveFeed()).map(post => post.id)).not.toContain(SEEDED_ID)
  })

  it('is idempotent: a repeat succeeds and changes nothing more', async () => {
    await takeDownPost(SEEDED_ID, 'other')
    const afterFirst = postStore.getPosts()

    await expect(takeDownPost(SEEDED_ID, 'other')).resolves.toBeUndefined()

    expect(postStore.getPosts()).toBe(afterFirst)
    expect(removedPosts.getAll().size).toBe(1)
  })

  it('answers the mock 404 for an id the store never held, with the real one\'s sentence', async () => {
    const error = await takeDownPost('post-that-never-existed', 'other').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TakedownError)
    expect((error as TakedownError).message).toBe('That post no longer exists in this exercise.')
    expect((error as TakedownError).status).toBe(404)
    expect(isPostRemoved('post-that-never-existed')).toBe(false)
  })

  it('rejects an invalid category before changing anything', async () => {
    await expect(takeDownPost(SEEDED_ID, 'PII' as unknown as TakedownCategory)).rejects.toBeInstanceOf(
      TakedownError,
    )

    expect(postStore.getPosts().some(post => post.id === SEEDED_ID)).toBe(true)
    expect(isPostRemoved(SEEDED_ID)).toBe(false)
  })

  it('tells store subscribers so a mounted mock feed can react', async () => {
    const heard = vi.fn()
    removedPosts.subscribe(heard)

    await takeDownPost(SEEDED_ID, 'other')

    expect(heard).toHaveBeenCalledTimes(1)
    expect(removedPosts.has(SEEDED_ID)).toBe(true)
  })
})
