/**
 * features/social/hooks/useThread.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-01 ACs (SOC-010, D1-006, XC-002):
 *   - `resolveThread` resolves a real 2-deep ancestor chain, the focused
 *     post, and its replies (one visible, one taken-down) as full `Post`
 *     records - unbounded ancestor depth, still a flat array (never a tree);
 *   - `resolveThread` fails closed on a malformed body or request failure
 *     (mirrors `personaService.test.ts`'s validation-boundary block);
 *   - `useThread` narrows every post through `toParticipantView` before
 *     handing it back - the participant-facing result never carries
 *     provenance fields (`origin`/`actingHumanId`/`createdWallClock`/
 *     `injectId`), even though the underlying mock records have them.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { resolveThread, useThread } from './useThread'

describe('resolveThread (shipped mock path)', () => {
  it('resolves the 2-deep ancestor chain, the focused post, and its replies', async () => {
    const thread = await resolveThread('post-seed-mvega-question')

    expect(thread.focused?.id).toBe('post-seed-mvega-question')
    // Ancestors come back oldest-first as a FLAT array (no nesting) even
    // though the chain is 2 deep (D1-006 "unlimited depth, still flat").
    expect(thread.ancestors.map(a => a.id)).toEqual([
      'post-seed-fwupd-rumor',
      'post-seed-fulco-coordination',
    ])

    expect(thread.replies).toHaveLength(2)
    const real = thread.replies.find(r => r.status === 'visible')
    const takenDown = thread.replies.find(r => r.status === 'taken-down')
    expect(real).toBeDefined()
    expect(takenDown).toBeDefined()
    expect(real?.replyToPersonaId).toBe('persona-mvega_fh')
    expect(takenDown?.replyToPersonaId).toBe('persona-mvega_fh')
  })

  it('resolves an empty ancestor chain and no replies for a post with none', async () => {
    const thread = await resolveThread('post-seed-fw-advisory')

    expect(thread.focused?.id).toBe('post-seed-fw-advisory')
    expect(thread.ancestors).toEqual([])
    expect(thread.replies).toEqual([])
  })

  it('resolves `focused: null` for an unknown post id', async () => {
    const thread = await resolveThread('post-does-not-exist')
    expect(thread.focused).toBeNull()
    expect(thread.ancestors).toEqual([])
    expect(thread.replies).toEqual([])
  })
})

describe('resolveThread (validation boundary)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when the resolved body is not a thread shape', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      { data: { nope: true } } as Awaited<ReturnType<typeof api.get>>,
    )
    await expect(resolveThread('post-seed-mvega-question')).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting an empty thread', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolveThread('post-seed-mvega-question')).rejects.toThrow('network down')
  })
})

describe('useThread — narrows to participant-safe view models (XC-002)', () => {
  it('never leaks origin/actingHumanId/createdWallClock/injectId onto ancestors/focused/replies', async () => {
    const { result } = renderHook(() => useThread('post-seed-mvega-question'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    const allViews = [
      ...result.current.ancestors,
      ...(result.current.focused ? [result.current.focused] : []),
      ...result.current.replies,
    ]
    expect(allViews.length).toBeGreaterThan(0)
    for (const view of allViews) {
      expect(view).not.toHaveProperty('origin')
      expect(view).not.toHaveProperty('actingHumanId')
      expect(view).not.toHaveProperty('createdWallClock')
      expect(view).not.toHaveProperty('injectId')
    }
  })

  it('resolves ancestors, focused, and replies (one visible, one taken-down)', async () => {
    const { result } = renderHook(() => useThread('post-seed-mvega-question'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.ancestors).toHaveLength(2)
    expect(result.current.focused?.id).toBe('post-seed-mvega-question')
    expect(result.current.replies.map(r => r.status).sort()).toEqual(['taken-down', 'visible'])
  })

  it('re-resolves when focusedPostId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useThread(id),
      { initialProps: { id: 'post-seed-mvega-question' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.focused?.id).toBe('post-seed-mvega-question')

    act(() => {
      rerender({ id: 'post-seed-fw-advisory' })
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.focused?.id).toBe('post-seed-fw-advisory')
    expect(result.current.ancestors).toEqual([])
  })
})
