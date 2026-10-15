/**
 * features/social/pinned/usePinnedFeed.test.ts
 * ---------------------------------------------------------------------------
 * The Pinned tab's read sequencing (demo-feedback story 07, PR #517 pin-race fix): reads
 * never overlap, and when a change (`PostPinChanged` or `viewerEngagement`) lands while a
 * read is on the wire, that read's answer is DISCARDED - it predates the change - and the
 * queued read applies instead. So a controller's unpin cannot be undone by a stale answer,
 * and a failed queued read keeps the patched (newer) list.
 *
 * Own file: `vi.mock('./pinnedFeedService')` is module-wide; each read is a hand-settled
 * promise so the test chooses what is in flight when.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinChangeSource } from '../services/realtimeFeed'
import type { ParticipantPostView } from '../types/post'
import { resolvePinnedFeed } from './pinnedFeedService'
import { viewerEngagement } from './pinEvents'
import type { PinnedFeedItem } from './types'
import { usePinnedFeed } from './usePinnedFeed'

vi.mock('./pinnedFeedService', () => ({ resolvePinnedFeed: vi.fn() }))

const mockedResolve = vi.mocked(resolvePinnedFeed)

/** A hand-driven `PostPinChanged` source. */
class FakePinSource implements PinChangeSource {
  private readonly handlers = new Set<(e: { postId: string; pinnedForAll: boolean }) => void>()

  subscribePinChanged(handler: (e: { postId: string; pinnedForAll: boolean }) => void) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  push(postId: string, pinnedForAll: boolean) {
    for (const handler of [...this.handlers]) handler({ postId, pinnedForAll })
  }
}

interface Read {
  resolve(items: PinnedFeedItem[]): void
  reject(reason: unknown): void
}

let reads: Read[] = []

function post(id: string, pinnedForAll: boolean): ParticipantPostView {
  return {
    id,
    authorPersonaId: 'persona-1',
    text: `text of ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T14:00:00Z',
    ...(pinnedForAll ? { pinnedForAll: true as const } : {}),
  }
}

function item(id: string, pinnedForAll: boolean): PinnedFeedItem {
  return { reason: pinnedForAll ? 'exercise' : 'like', post: post(id, pinnedForAll) }
}

/** Settles read `index` and lets the hook's async loop run on. */
async function settle(index: number, outcome: PinnedFeedItem[] | Error) {
  const read = reads[index]
  if (read === undefined) throw new Error(`read ${index} was never issued`)
  await act(async () => {
    if (outcome instanceof Error) read.reject(outcome)
    else read.resolve(outcome)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function markerOf(items: readonly PinnedFeedItem[], postId: string): boolean | undefined {
  return items.find(entry => entry.post.id === postId)?.post.pinnedForAll
}

beforeEach(() => {
  reads = []
  mockedResolve.mockReset()
  mockedResolve.mockImplementation(() => new Promise<PinnedFeedItem[]>((resolve, reject) => {
    reads.push({ resolve, reject })
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Mounts the hook and lets the first read land with `p1` pinned for everyone. */
async function mountWithPinnedPost(source: FakePinSource) {
  const utils = renderHook(() => usePinnedFeed(source))
  expect(reads).toHaveLength(1)
  await settle(0, [item('p1', true)])
  expect(utils.result.current.status).toBe('ready')
  expect(markerOf(utils.result.current.items, 'p1')).toBe(true)
  return utils
}

describe('usePinnedFeed — a change mid-read discards the in-flight answer', () => {
  it('a stale pinned answer cannot restore the marker, and a failed queued read keeps it off', async () => {
    const source = new FakePinSource()
    const { result } = await mountWithPinnedPost(source)

    // A like settles elsewhere: read #2 goes out.
    act(() => viewerEngagement.notify({ postId: 'p2', kind: 'like', active: true }))
    expect(reads).toHaveLength(2)

    // While it is on the wire, a controller unpins p1 for everyone.
    act(() => source.push('p1', false))
    expect(markerOf(result.current.items, 'p1')).toBeUndefined() // patched at once
    expect(reads).toHaveLength(2) // queued, never overlapped

    // Read #2 answers with the OLD server state (still pinned): it is dropped.
    await settle(1, [item('p1', true)])
    expect(markerOf(result.current.items, 'p1')).toBeUndefined()
    expect(reads).toHaveLength(3) // the queued read went out

    // The queued read fails: what is on screen (the newer, unpinned list) stays.
    await settle(2, new Error('down'))
    expect(markerOf(result.current.items, 'p1')).toBeUndefined()
    expect(result.current.items.map(entry => entry.post.id)).toEqual(['p1'])
    expect(result.current.status).toBe('ready')
  })

  it('the queued read, when it succeeds, is the answer that applies', async () => {
    const source = new FakePinSource()
    const { result } = await mountWithPinnedPost(source)

    act(() => viewerEngagement.notify({ postId: 'p2', kind: 'like', active: true }))
    act(() => source.push('p1', false))
    await settle(1, [item('p1', true)])
    await settle(2, [item('p1', false), item('p2', false)])

    expect(result.current.items.map(entry => entry.post.id)).toEqual(['p1', 'p2'])
    expect(markerOf(result.current.items, 'p1')).toBeUndefined()
    expect(reads).toHaveLength(3)
  })

  it('control: with no change mid-read, the in-flight answer applies', async () => {
    const source = new FakePinSource()
    const { result } = await mountWithPinnedPost(source)

    act(() => viewerEngagement.notify({ postId: 'p2', kind: 'like', active: true }))
    await settle(1, [item('p1', true), item('p2', false)])

    expect(result.current.items.map(entry => entry.post.id)).toEqual(['p1', 'p2'])
    expect(markerOf(result.current.items, 'p1')).toBe(true)
    expect(reads).toHaveLength(2) // nothing was queued
  })
})
