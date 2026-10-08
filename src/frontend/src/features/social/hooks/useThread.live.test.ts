/**
 * features/social/hooks/useThread.live.test.ts
 * ---------------------------------------------------------------------------
 * `useThread`'s F4 additions (demo-polish, story 13 "Flattened real thread" +
 * "Live reply append"; SOC-010/011, D1-006, XC-002):
 *
 *  - the MOCK thread is built from `postStore`, so a reply composed in dev (which
 *    `useComposePost` appends there, where it is linked to its parent) shows in that
 *    parent's thread on the next resolve;
 *  - `options.live` listens to the arrival source and appends a reply to the focused
 *    post BELOW the fetched ones, in arrival order, de-duplicated by id, bumping the
 *    focused post's `counts.reply` and `newReplyCount`;
 *  - the viewer's OWN reply (`appendReply`, or an echo authored by their persona) is
 *    appended but never counted as new, and its realtime echo - before OR after -
 *    neither duplicates it nor double-counts;
 *  - a reply that lands while the thread is still loading is merged, not lost, and a
 *    late fetch that already contains it neither shows it twice nor counts it twice;
 *  - other parents' replies and top-level posts are ignored; switching thread resets
 *    the overlay; the subscription is released on unmount; `live: false` (the
 *    default) never touches the source.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { personaIdForHandle } from '@/features/personas'
import type { ParticipantPostView, Post } from '@/features/social'
import type {
  FeedStreamHandler,
  FeedStreamSource,
  FeedTransportMode,
} from '../services/feedStreamSource'
import { postStore } from '../services/postStore'
import { resolveThread, useThread } from './useThread'

const FOCUS = 'post-seed-mvega-question'
const FOCUS_AUTHOR = personaIdForHandle('mvega_fh')

class FakeSource implements FeedStreamSource {
  private handlers = new Set<FeedStreamHandler>()
  startCalls = 0
  stopCalls = 0
  mode: FeedTransportMode = 'realtime'

  subscribe(handler: FeedStreamHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  start(): Promise<void> {
    this.startCalls += 1
    return Promise.resolve()
  }

  stop(): void {
    this.stopCalls += 1
  }

  get subscriberCount(): number {
    return this.handlers.size
  }

  push(post: ParticipantPostView): void {
    for (const handler of this.handlers) handler(post)
  }
}

function replyView(
  id: string,
  overrides: Partial<ParticipantPostView> = {},
): ParticipantPostView {
  return {
    id,
    authorPersonaId: personaIdForHandle('kwardFH'),
    text: `reply ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    scenarioTime: '2033-09-04T14:30:00Z',
    inReplyTo: { postId: FOCUS, authorHandle: 'mvega_fh' },
    ...overrides,
  }
}

function replyPost(id: string, parentPostId = FOCUS): Post {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle('kwardFH'),
    actingHumanId: 'human-participant-kward',
    text: `reply ${id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:30:00Z',
    origin: 'participant',
    parentPostId,
  }
}

afterEach(() => {
  postStore.resetForTests()
})

describe('resolveThread — the mock thread reads postStore (replies composed in dev show up)', () => {
  it('includes a reply appended to the store, linked to its parent, and the bumped parent count', async () => {
    const before = await resolveThread(FOCUS)
    const beforeCount = before.focused?.counts.reply ?? -1

    postStore.appendPost(replyPost('post-dev-reply'))
    const after = await resolveThread(FOCUS)

    expect(after.replies.map(r => r.id)).toContain('post-dev-reply')
    const created = after.replies.find(r => r.id === 'post-dev-reply')
    expect(created?.inReplyTo).toEqual({ postId: FOCUS, authorHandle: 'mvega_fh' })
    expect(created?.status).toBe('visible')
    expect(created?.replyToPersonaId).toBe(FOCUS_AUTHOR)
    expect(after.focused?.counts.reply).toBe(beforeCount + 1)
  })

  it('a reply to a reply opens as its own thread with the whole chain as ancestors', async () => {
    postStore.appendPost(replyPost('post-dev-reply'))
    postStore.appendPost(replyPost('post-dev-reply-2', 'post-dev-reply'))

    const thread = await resolveThread('post-dev-reply-2')

    expect(thread.ancestors.map(a => a.id)).toEqual([
      'post-seed-fwupd-rumor',
      'post-seed-fulco-coordination',
      FOCUS,
      'post-dev-reply',
    ])
  })
})

describe('useThread — live reply append', () => {
  it('does nothing by default (live: false never touches the source)', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { source }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(source.startCalls).toBe(0)
    expect(source.subscriberCount).toBe(0)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('subscribes + starts when live, and releases both on unmount', async () => {
    const source = new FakeSource()
    const { result, unmount } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(source.startCalls).toBe(1)
    expect(source.subscriberCount).toBe(1)

    unmount()
    expect(source.stopCalls).toBe(1)
    expect(source.subscriberCount).toBe(0)
  })

  it('appends a reply for the focused post BELOW the fetched ones, counts it, and flags it new', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const fetched = result.current.replies.map(r => r.id)
    const beforeCount = result.current.focused?.counts.reply ?? -1

    act(() => source.push(replyView('live-1')))

    expect(result.current.replies.map(r => r.id)).toEqual([...fetched, 'live-1'])
    const appended = result.current.replies[result.current.replies.length - 1]
    expect(appended?.status).toBe('visible')
    // A direct reply replies to the focused post's author - an opaque id from the
    // focused post, not derived from the handle.
    expect(appended?.replyToPersonaId).toBe(FOCUS_AUTHOR)
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 1)
    expect(result.current.newReplyCount).toBe(1)

    act(() => source.push(replyView('live-2')))
    expect(result.current.replies.map(r => r.id)).toEqual([...fetched, 'live-1', 'live-2'])
    expect(result.current.newReplyCount).toBe(2)
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 2)
  })

  it('keeps arrival order (never re-sorts what is under the reader)', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const fetched = result.current.replies.map(r => r.id)

    act(() => source.push(replyView('live-late', { scenarioTime: '2033-09-04T16:00:00Z' })))
    act(() => source.push(replyView('live-early', { scenarioTime: '2033-09-04T09:00:00Z' })))

    expect(result.current.replies.map(r => r.id)).toEqual([...fetched, 'live-late', 'live-early'])
  })

  it('de-duplicates a re-delivered id (one row, one count)', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const beforeCount = result.current.focused?.counts.reply ?? -1

    act(() => {
      source.push(replyView('live-1'))
      source.push(replyView('live-1'))
    })

    expect(result.current.replies.filter(r => r.id === 'live-1')).toHaveLength(1)
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 1)
    expect(result.current.newReplyCount).toBe(1)
  })

  it('ignores a reply to a different post and a top-level post', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const fetched = result.current.replies

    act(() => {
      source.push(replyView('other', { inReplyTo: { postId: 'post-seed-fw-advisory', authorHandle: 'x' } }))
      source.push(replyView('top', { inReplyTo: undefined }))
    })

    expect(result.current.replies).toBe(fetched)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('an arrival authored by the viewer\'s own persona is appended but NOT announced as new', async () => {
    const source = new FakeSource()
    const viewerPersonaId = personaIdForHandle('dreyes_fh')
    const { result } = renderHook(
      () => useThread(FOCUS, { live: true, source, viewerPersonaId }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => source.push(replyView('mine', { authorPersonaId: viewerPersonaId })))

    expect(result.current.replies.map(r => r.id)).toContain('mine')
    expect(result.current.newReplyCount).toBe(0)
  })

  it('merges a reply that arrived while still loading', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    // Subscribed from mount: push BEFORE the fetch resolves.
    act(() => source.push(replyView('early')))
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.replies.map(r => r.id)).toContain('early')
    expect(result.current.newReplyCount).toBe(1)
  })

  it('a late fetch that already contains the live reply neither duplicates nor double-counts it', async () => {
    // The reply is already in the mock backend (parent count bumped by the store).
    postStore.appendPost(replyPost('both-places'))
    const stored = postStore.getPosts().find(p => p.id === FOCUS)?.counts.reply ?? -1
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    act(() => source.push(replyView('both-places')))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.replies.filter(r => r.id === 'both-places')).toHaveLength(1)
    expect(result.current.focused?.counts.reply).toBe(stored)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('switching to another thread drops the previous thread\'s overlay', async () => {
    const source = new FakeSource()
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useThread(id, { live: true, source }),
      { initialProps: { id: FOCUS } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => source.push(replyView('live-1')))
    expect(result.current.newReplyCount).toBe(1)

    rerender({ id: 'post-seed-fw-advisory' })
    await waitFor(() => expect(result.current.focused?.id).toBe('post-seed-fw-advisory'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.replies).toEqual([])
    expect(result.current.newReplyCount).toBe(0)
  })
})

describe('useThread — appendReply (the viewer\'s own reply) and its echo', () => {
  it('appends below, bumps the count once, and is not announced', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const beforeCount = result.current.focused?.counts.reply ?? -1

    act(() => result.current.appendReply(replyView('mine')))

    const last = result.current.replies[result.current.replies.length - 1]
    expect(last?.id).toBe('mine')
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 1)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('its echo AFTER the append is a no-op (no duplicate, no second bump)', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const beforeCount = result.current.focused?.counts.reply ?? -1

    act(() => result.current.appendReply(replyView('mine')))
    act(() => source.push(replyView('mine')))

    expect(result.current.replies.filter(r => r.id === 'mine')).toHaveLength(1)
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 1)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('its echo BEFORE the append is also a no-op, and it still is not announced', async () => {
    const source = new FakeSource()
    const viewerPersonaId = personaIdForHandle('dreyes_fh')
    const { result } = renderHook(
      () => useThread(FOCUS, { live: true, source, viewerPersonaId }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const beforeCount = result.current.focused?.counts.reply ?? -1
    const mine = replyView('mine', { authorPersonaId: viewerPersonaId })

    act(() => source.push(mine))
    act(() => result.current.appendReply(mine))

    expect(result.current.replies.filter(r => r.id === 'mine')).toHaveLength(1)
    expect(result.current.focused?.counts.reply).toBe(beforeCount + 1)
    expect(result.current.newReplyCount).toBe(0)
  })

  it('works with live: false too (a read-only viewer never calls it, but it is safe)', async () => {
    const { result } = renderHook(() => useThread(FOCUS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.appendReply(replyView('mine')))

    expect(result.current.replies.map(r => r.id)).toContain('mine')
  })
})

describe('useThread — XC-002', () => {
  it('a live reply carries no provenance keys', async () => {
    const source = new FakeSource()
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => source.push(replyView('live-1')))

    const appended = result.current.replies.find(r => r.id === 'live-1')
    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId']) {
      expect(appended).not.toHaveProperty(key)
    }
  })

  it('spies: the source is started and stopped through the interface only', async () => {
    const source = new FakeSource()
    const start = vi.spyOn(source, 'start')
    const subscribe = vi.spyOn(source, 'subscribe')
    const { result } = renderHook(() => useThread(FOCUS, { live: true, source }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(start.mock.calls[0]).toEqual([])
    expect(subscribe.mock.calls[0]).toHaveLength(1)
  })
})
