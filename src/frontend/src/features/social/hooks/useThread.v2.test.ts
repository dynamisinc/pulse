/**
 * features/social/hooks/useThread.v2.test.ts
 * ---------------------------------------------------------------------------
 * The thread read under CONTRACT v2 (demo-polish F0, implementation.md §1.5.3 /
 * §5.3): the v2 fixture thread (root -> question -> focus; the focus has three
 * direct replies — a normal one, one with media, one taken-down TOMBSTONE),
 * ancestry via `inReplyTo`, the tombstone shape (`taken-down`, empty text, no
 * media, zero counts, original text never surfaced), the not-found shape for a
 * soft-deleted focus, and the validation guards (accept v2 members, fail closed
 * on malformed ones). The legacy seeded thread is covered by `useThread.test.ts`.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { demoFixturePost, DEMO_IDS } from '../services/mockFixtures'
import { resolveThread, useThread } from './useThread'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveThread — the v2 fixture thread', () => {
  it('resolves ancestors root -> question (depth 2), oldest first, via inReplyTo', async () => {
    const thread = await resolveThread(DEMO_IDS.threadFocus)

    expect(thread.focused?.id).toBe(DEMO_IDS.threadFocus)
    expect(thread.ancestors.map(a => a.id)).toEqual([DEMO_IDS.threadRoot, DEMO_IDS.threadQuestion])
  })

  it('gives the focused post three direct replies, oldest first, each carrying inReplyTo', async () => {
    const thread = await resolveThread(DEMO_IDS.threadFocus)

    expect(thread.replies.map(r => r.id)).toEqual([
      DEMO_IDS.threadReplyConfirm,
      DEMO_IDS.threadReplyTakenDown,
      DEMO_IDS.threadReplyPhoto,
    ])
    for (const reply of thread.replies) {
      expect(reply.inReplyTo?.postId).toBe(DEMO_IDS.threadFocus)
      expect(reply.replyToPersonaId).toBe('persona-fulcoem')
    }
  })

  it('has one reply with media and one tombstone', async () => {
    const thread = await resolveThread(DEMO_IDS.threadFocus)

    const withMedia = thread.replies.filter(r => (r.media ?? []).length > 0)
    expect(withMedia.map(r => r.id)).toEqual([DEMO_IDS.threadReplyPhoto])
    expect(withMedia[0]?.media?.[0]?.alt.length).toBeGreaterThan(0)
    expect(thread.replies.filter(r => r.status === 'taken-down')).toHaveLength(1)
    expect(thread.replies.filter(r => r.status === 'visible')).toHaveLength(2)
  })

  it('shapes the tombstone: taken-down, empty text, no media, zero counts', async () => {
    const thread = await resolveThread(DEMO_IDS.threadFocus)
    const tombstone = thread.replies.find(r => r.id === DEMO_IDS.threadReplyTakenDown)

    expect(tombstone).toMatchObject({
      status: 'taken-down',
      text: '',
      counts: { reply: 0, repost: 0, like: 0 },
    })
    expect(tombstone).not.toHaveProperty('media')
    expect(tombstone).not.toHaveProperty('viewer')
  })

  it('never surfaces the taken-down reply\'s original text anywhere in the response', async () => {
    const original = demoFixturePost(DEMO_IDS.threadReplyTakenDown)?.text ?? ''
    expect(original.length).toBeGreaterThan(10)

    const thread = await resolveThread(DEMO_IDS.threadFocus)

    expect(JSON.stringify(thread)).not.toContain(original)
  })

  it('resolves the root with no ancestors and its one direct reply', async () => {
    const thread = await resolveThread(DEMO_IDS.threadRoot)

    expect(thread.ancestors).toEqual([])
    expect(thread.replies.map(r => r.id)).toEqual([DEMO_IDS.threadQuestion])
    expect(thread.focused?.media).toHaveLength(1)
  })

  it('answers the not-found shape for a soft-deleted focus (no leak that it exists)', async () => {
    const thread = await resolveThread(DEMO_IDS.threadReplyTakenDown)

    expect(thread).toEqual({ ancestors: [], focused: null, replies: [] })
  })

  it('does not disturb the legacy seeded thread (still two replies: one visible, one taken down)', async () => {
    const thread = await resolveThread('post-seed-mvega-question')

    expect(thread.replies).toHaveLength(2)
    expect(thread.replies.every(r => r.inReplyTo?.postId === 'post-seed-mvega-question')).toBe(true)
  })
})

describe('useThread — v2 members reach the participant-safe view', () => {
  it('carries media / inReplyTo and still strips provenance (XC-002)', async () => {
    const { result } = renderHook(() => useThread(DEMO_IDS.threadFocus))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.focused?.inReplyTo?.postId).toBe(DEMO_IDS.threadQuestion)
    const photoReply = result.current.replies.find(r => r.id === DEMO_IDS.threadReplyPhoto)
    expect(photoReply?.media).toHaveLength(1)
    for (const view of [
      ...result.current.ancestors,
      ...(result.current.focused ? [result.current.focused] : []),
      ...result.current.replies,
    ]) {
      for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId']) {
        expect(view).not.toHaveProperty(key)
      }
    }
  })
})

describe('resolveThread — validation guards accept v2 and fail closed on malformed v2', () => {
  const post = {
    id: 'p1',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-mvega_fh',
    actingHumanId: 'human-x',
    text: 't',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:00:00Z',
    origin: 'participant',
  }

  it('accepts a body whose posts carry media / inReplyTo / viewer', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        ancestors: [],
        focused: {
          ...post,
          media: [{ id: 'm', kind: 'image', url: '/u', alt: 'a' }],
          inReplyTo: { postId: 'p0', authorHandle: 'h' },
          viewer: { liked: true, reposted: false },
        },
        replies: [],
      },
    })

    await expect(resolveThread('p1')).resolves.toBeDefined()
  })

  it.each([
    ['focused media without a url', { focused: { ...post, media: [{ id: 'm', kind: 'image', alt: 'a' }] } }],
    ['an ancestor with a malformed viewer', { ancestors: [{ ...post, viewer: { liked: 'x' } }] }],
  ])('fails closed on %s', async (_label, patch) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { ancestors: [], focused: post, replies: [], ...patch },
    })

    await expect(resolveThread('p1')).rejects.toThrow(/malformed thread/)
  })
})
