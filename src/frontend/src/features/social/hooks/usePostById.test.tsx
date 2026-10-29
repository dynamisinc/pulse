/**
 * features/social/hooks/usePostById.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 21, "Post by id (news FU-6a, NWS-015)". The exercise-scoped read
 * (`resolveThread`) is stubbed so each answer the server can give is driven directly:
 *  - a visible post of the session's exercise -> `ready` with the participant-safe view;
 *  - an unknown id and a post of ANOTHER exercise -> the SAME `unavailable` answer
 *    (identical object: the caller cannot tell them apart, XC-001);
 *  - a taken-down / deleted / hidden post, a failed read, a takedown while embedded ->
 *    `unavailable`, never a throw (no error boundary; XC-010, E4-Q10).
 */
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider, useExerciseContext } from '@/core/exerciseContext'
import type { Post } from '../types/post'
import { removedPosts } from '../services/removedPosts'

const resolveThread = vi.hoisted(() => vi.fn())
vi.mock('./useThread', () => ({ resolveThread }))

const { usePostById, POST_UNAVAILABLE } = await import('./usePostById')

/** The mock exercise the provider resolves to. */
const EXERCISE = 'ex-mock-0001'

function post(id: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: EXERCISE,
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-1',
    text: `post ${id}`,
    counts: { reply: 1, repost: 2, like: 3 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:00:00.000Z',
    origin: 'inject',
    injectId: '042',
    ...extra,
  }
}

function thread(focused: Post | null) {
  return { ancestors: [], focused, replies: [] }
}

function Providers({ children }: { children: ReactNode }) {
  return <ExerciseContextProvider>{children}</ExerciseContextProvider>
}

/** Renders the hook and waits until it has settled (left `loading`). */
async function settle(postId: string) {
  const rendered = renderHook(
    () => ({ result: usePostById(postId), scope: useExerciseContext().exerciseId }),
    { wrapper: Providers },
  )
  await waitFor(() => expect(rendered.result.current.result.status).not.toBe('loading'))
  return rendered
}

beforeEach(() => {
  resolveThread.mockReset()
})

afterEach(() => {
  removedPosts.resetForTests()
})

describe('usePostById', () => {
  it('returns the participant-safe post of the session\'s exercise', async () => {
    resolveThread.mockResolvedValue(thread(post('p-1')))
    const { result } = await settle('p-1')

    expect(result.current.scope).toBe(EXERCISE)
    const answer = result.current.result
    expect(answer.status).toBe('ready')
    if (answer.status !== 'ready') return
    expect(answer.post.id).toBe('p-1')
    expect(answer.post.counts).toEqual({ reply: 1, repost: 2, like: 3 })
    for (const key of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
      expect(answer.post).not.toHaveProperty(key)
    }
    // Scope comes from the session: the read gets the post id and nothing else.
    expect(resolveThread).toHaveBeenCalledWith('p-1')
  })

  it('answers a post of ANOTHER exercise exactly like an unknown id', async () => {
    resolveThread.mockResolvedValue(thread(null))
    const unknown = (await settle('nope')).result.current.result

    resolveThread.mockResolvedValue(thread(post('foreign', { exerciseId: 'ex-other-9999' })))
    const foreign = (await settle('foreign')).result.current.result

    expect(unknown).toEqual({ status: 'unavailable' })
    expect(foreign).toBe(unknown)
    expect(foreign).toBe(POST_UNAVAILABLE)
  })

  it.each([
    ['taken-down'],
    ['deleted'],
    ['hidden'],
  ])('a %s post is unavailable', async status => {
    resolveThread.mockResolvedValue(thread(post('gone', { status } as Partial<Post>)))
    const { result } = await settle('gone')

    expect(result.current.result).toBe(POST_UNAVAILABLE)
  })

  it('a failed read is unavailable, never a throw', async () => {
    resolveThread.mockRejectedValue(new Error('network down'))
    const { result } = await settle('p-1')

    expect(result.current.result).toBe(POST_UNAVAILABLE)
  })

  it('a focus that is not the requested id is unavailable', async () => {
    resolveThread.mockResolvedValue(thread(post('someone-else')))
    const { result } = await settle('p-1')

    expect(result.current.result).toBe(POST_UNAVAILABLE)
  })

  it('turns unavailable at once when a controller takes the embedded post down', async () => {
    resolveThread.mockResolvedValue(thread(post('p-1')))
    const { result } = await settle('p-1')
    expect(result.current.result.status).toBe('ready')

    act(() => removedPosts.add('p-1'))

    expect(result.current.result).toBe(POST_UNAVAILABLE)
  })

  it('an empty id is unavailable without a read', async () => {
    const { result } = renderHook(() => usePostById(''), { wrapper: Providers })

    await waitFor(() => expect(result.current).toBe(POST_UNAVAILABLE))
    expect(resolveThread).not.toHaveBeenCalled()
  })

  it('is loading until the read lands, and a new id starts loading again', async () => {
    let finish!: (value: ReturnType<typeof thread>) => void
    resolveThread.mockReturnValueOnce(new Promise(res => { finish = res }))
    const { result, rerender } = renderHook(({ id }) => usePostById(id), {
      wrapper: Providers,
      initialProps: { id: 'p-1' },
    })
    await waitFor(() => expect(resolveThread).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('loading')

    await act(async () => finish(thread(post('p-1'))))
    expect(result.current.status).toBe('ready')

    resolveThread.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: 'p-2' })
    expect(result.current.status).toBe('loading')
  })
})
