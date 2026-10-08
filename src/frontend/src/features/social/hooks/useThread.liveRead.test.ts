/**
 * features/social/hooks/useThread.liveRead.test.ts
 * ---------------------------------------------------------------------------
 * `useThread` / `resolveThread` over the LIVE `GET /api/threads/{postId}` (demo-polish
 * F4, story 13 "Flattened real thread"; implementation.md §1.5.3; COR-001, XC-002):
 *
 *  - with `USE_MOCK_DATA` off the request goes to `/threads/{id}` through the shared
 *    client with NO mock adapter and NO query parameter (no `exerciseId`, ever), the
 *    id percent-encoded and treated as an opaque string (a GUID);
 *  - the server's body - ancestors root -> parent, the focused post, `ThreadReply`s
 *    oldest first with a `taken-down` TOMBSTONE (`text: ''`, no media, zero counts) -
 *    is accepted and narrowed to participant-safe views;
 *  - the byte-identical not-found shape `{ancestors:[],focused:null,replies:[]}`
 *    resolves with no focused post (the view shows "unable to load");
 *  - a malformed body fails closed.
 *
 * Own file: `vi.mock` of `@/core/config/mockData` is module-wide.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { api } from '@/core/services/api'
import { resolveThread, useThread } from './useThread'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

const ROOT = '0b9d2f5e-0000-4000-8000-000000000001'
const FOCUS = '0b9d2f5e-0000-4000-8000-000000000002'
const REPLY = '0b9d2f5e-0000-4000-8000-000000000003'
const GONE = '0b9d2f5e-0000-4000-8000-000000000004'
const AUTHOR = 'c1f0a1d2-0000-4000-8000-0000000000aa'

function wire(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    authorPersonaId: AUTHOR,
    text: `text ${id}`,
    scenarioTime: '2033-09-04T14:05:00.0000000+00:00',
    counts: { reply: 1, repost: 0, like: 2 },
    ...overrides,
  }
}

const BODY = {
  ancestors: [wire(ROOT)],
  focused: wire(FOCUS, { inReplyTo: { postId: ROOT, authorHandle: 'FulcoEM' } }),
  replies: [
    wire(REPLY, {
      inReplyTo: { postId: FOCUS, authorHandle: 'mvega_fh' },
      media: [{ id: 'm1', kind: 'image', url: 'https://blob/m1', alt: 'A road' }],
      replyToPersonaId: AUTHOR,
      status: 'visible',
    }),
    wire(GONE, {
      text: '',
      counts: { reply: 0, repost: 0, like: 0 },
      inReplyTo: { postId: FOCUS, authorHandle: 'mvega_fh' },
      replyToPersonaId: AUTHOR,
      status: 'taken-down',
    }),
  ],
}

let getSpy: MockInstance<typeof api.get>

beforeEach(() => {
  getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: BODY, status: 200 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveThread — live GET /threads/{id}', () => {
  it('asks the shared client for /threads/{id} with no adapter override and no params', async () => {
    await resolveThread(FOCUS)

    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(getSpy.mock.calls[0]).toEqual([`/threads/${FOCUS}`, undefined])
  })

  it('percent-encodes the id (it is an opaque string, never parsed)', async () => {
    await resolveThread('weird id/with?chars')

    expect(getSpy.mock.calls[0]?.[0]).toBe('/threads/weird%20id%2Fwith%3Fchars')
  })

  it('accepts the server body: ancestors, the focused post, replies and a tombstone', async () => {
    const thread = await resolveThread(FOCUS)

    expect(thread.ancestors.map(a => a.id)).toEqual([ROOT])
    expect(thread.focused?.id).toBe(FOCUS)
    expect(thread.replies.map(r => [r.id, r.status])).toEqual([
      [REPLY, 'visible'],
      [GONE, 'taken-down'],
    ])
  })

  it('resolves the not-found shape with no focused post (nothing leaks)', async () => {
    getSpy.mockResolvedValue({ data: { ancestors: [], focused: null, replies: [] }, status: 200 })

    const thread = await resolveThread('0b9d2f5e-0000-4000-8000-00000000ffff')

    expect(thread.focused).toBeNull()
    expect(thread.ancestors).toEqual([])
    expect(thread.replies).toEqual([])
  })

  it('fails closed on a malformed body', async () => {
    getSpy.mockResolvedValue({ data: { ancestors: 'nope' }, status: 200 })

    await expect(resolveThread(FOCUS)).rejects.toThrow()
  })
})

describe('useThread — over the live body', () => {
  it('narrows every post to a participant-safe view and keeps the tombstone empty', async () => {
    const { result } = renderHook(() => useThread(FOCUS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.focused?.id).toBe(FOCUS)
    const tombstone = result.current.replies.find(r => r.status === 'taken-down')
    expect(tombstone).toMatchObject({ text: '', counts: { reply: 0, repost: 0, like: 0 } })
    expect(tombstone).not.toHaveProperty('media')
    const visible = result.current.replies.find(r => r.status === 'visible')
    expect(visible?.media?.[0]?.alt).toBe('A road')
    for (const view of [...result.current.ancestors, ...result.current.replies]) {
      for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
        expect(view).not.toHaveProperty(key)
      }
    }
  })

  it('reports an error (not a thread) for a failed request', async () => {
    getSpy.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useThread(FOCUS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.focused).toBeUndefined()
  })
})
