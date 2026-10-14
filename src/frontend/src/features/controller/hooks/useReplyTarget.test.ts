/**
 * features/controller/hooks/useReplyTarget.test.ts
 * ---------------------------------------------------------------------------
 * The route's reply-target state machine (demo-polish Wave 3 integration; Gate-2 checks
 * 1, 11, 26). Pure hook tests - the DOM-level behaviour is in
 * `ControllerConsoleRoute.wave3.test.tsx`.
 *
 *  - a target set while a persona is active is held for THAT persona and dropped when a
 *    different one becomes active (or the exercise changes);
 *  - a target set with NO active persona waits for the palette pick and binds to it - it
 *    survives the pick - but is dropped if the palette closes without one;
 *  - `clearReply` drops it; `requestReply` / `clearReply` keep their identity;
 *  - the returned `replyTo` is never stale for a render (an exercise or persona change is
 *    visible in the same render, before the pruning effect runs).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReplyTarget } from '@/features/social'
import { useReplyTarget, type UseReplyTargetOptions } from './useReplyTarget'

const TARGET: ReplyTarget = {
  postId: 'post-1',
  authorHandle: 'mvega_fh',
  authorDisplayName: 'Maria Vega',
  excerpt: 'is the water safe?',
}
const OTHER: ReplyTarget = { ...TARGET, postId: 'post-2', authorHandle: 'tbrandt41' }

const BASE: UseReplyTargetOptions = {
  exerciseId: 'ex-a',
  activePersonaId: 'persona-x',
  paletteOpen: false,
}

function mount(initial: UseReplyTargetOptions = BASE) {
  return renderHook((props: UseReplyTargetOptions) => useReplyTarget(props), {
    initialProps: initial,
  })
}

describe('useReplyTarget - a persona is active', () => {
  it('holds the target for that persona and clears on request', () => {
    const view = mount()
    expect(view.result.current.replyTo).toBeNull()

    act(() => view.result.current.requestReply(TARGET))
    expect(view.result.current.replyTo).toEqual(TARGET)

    act(() => view.result.current.clearReply())
    expect(view.result.current.replyTo).toBeNull()
  })

  it('replaces the target when another reply is requested', () => {
    const view = mount()
    act(() => view.result.current.requestReply(TARGET))
    act(() => view.result.current.requestReply(OTHER))
    expect(view.result.current.replyTo).toEqual(OTHER)
  })

  it('drops the target when a DIFFERENT persona becomes active, for good', () => {
    const view = mount()
    act(() => view.result.current.requestReply(TARGET))

    view.rerender({ ...BASE, activePersonaId: 'persona-y' })
    expect(view.result.current.replyTo).toBeNull()

    // Not revived when the first persona comes back.
    view.rerender(BASE)
    expect(view.result.current.replyTo).toBeNull()
  })

  it('keeps the target when the SAME persona is re-selected (no change)', () => {
    const view = mount()
    act(() => view.result.current.requestReply(TARGET))
    view.rerender({ ...BASE })
    expect(view.result.current.replyTo).toEqual(TARGET)
  })

  it('drops the target on an exercise switch, for good (COR-001)', () => {
    const view = mount()
    act(() => view.result.current.requestReply(TARGET))

    view.rerender({ ...BASE, exerciseId: 'ex-b' })
    expect(view.result.current.replyTo).toBeNull()

    view.rerender(BASE)
    expect(view.result.current.replyTo).toBeNull()
  })
})

describe('useReplyTarget - no persona active (the command palette picks)', () => {
  const NONE: UseReplyTargetOptions = { ...BASE, activePersonaId: null }

  it('survives while the palette is open, and binds to the persona picked', () => {
    const view = mount({ ...NONE, paletteOpen: false })
    // The route sets the target and opens the palette in the same event.
    view.rerender({ ...NONE, paletteOpen: true })
    act(() => view.result.current.requestReply(TARGET))
    expect(view.result.current.replyTo).toEqual(TARGET)

    // The pick: the persona becomes active and the palette closes in one batch.
    view.rerender({ ...BASE, activePersonaId: 'persona-x', paletteOpen: false })
    expect(view.result.current.replyTo).toEqual(TARGET)

    // ... and it is now bound to persona-x: another persona drops it.
    view.rerender({ ...BASE, activePersonaId: 'persona-y', paletteOpen: false })
    expect(view.result.current.replyTo).toBeNull()
  })

  it('is dropped when the palette closes without a pick', () => {
    const view = mount({ ...NONE, paletteOpen: true })
    act(() => view.result.current.requestReply(TARGET))
    expect(view.result.current.replyTo).toEqual(TARGET)

    view.rerender({ ...NONE, paletteOpen: false })
    expect(view.result.current.replyTo).toBeNull()

    // A later, unrelated pick finds nothing waiting.
    view.rerender({ ...BASE, activePersonaId: 'persona-x', paletteOpen: false })
    expect(view.result.current.replyTo).toBeNull()
  })

  it('is dropped at once when requested while nothing could show it', () => {
    const view = mount({ ...NONE, paletteOpen: false })
    act(() => view.result.current.requestReply(TARGET))
    expect(view.result.current.replyTo).toBeNull()
  })

  it('does not survive an exercise switch while waiting', () => {
    const view = mount({ ...NONE, paletteOpen: true })
    act(() => view.result.current.requestReply(TARGET))
    view.rerender({ ...NONE, exerciseId: 'ex-b', paletteOpen: true })
    expect(view.result.current.replyTo).toBeNull()
    view.rerender({ ...BASE, exerciseId: 'ex-b', activePersonaId: 'persona-x' })
    expect(view.result.current.replyTo).toBeNull()
  })
})

describe('useReplyTarget - identities', () => {
  it('keeps requestReply and clearReply stable across every kind of re-render', () => {
    const view = mount()
    const { requestReply, clearReply } = view.result.current
    act(() => view.result.current.requestReply(TARGET))
    view.rerender({ ...BASE, activePersonaId: 'persona-y', paletteOpen: true })
    view.rerender({ ...BASE, exerciseId: 'ex-b' })
    expect(view.result.current.requestReply).toBe(requestReply)
    expect(view.result.current.clearReply).toBe(clearReply)
  })

  it('binds a request to the persona / exercise of the latest committed render', () => {
    const view = mount()
    const { requestReply } = view.result.current
    view.rerender({ ...BASE, activePersonaId: 'persona-y' })
    // The OLD function identity, called after the persona changed, binds to persona-y.
    act(() => requestReply(TARGET))
    expect(view.result.current.replyTo).toEqual(TARGET)
    view.rerender({ ...BASE, activePersonaId: 'persona-y', paletteOpen: true })
    expect(view.result.current.replyTo).toEqual(TARGET)
  })
})
