/**
 * features/social/hooks/useComposePost.interim.test.ts
 * ---------------------------------------------------------------------------
 * Pins the INTERIM composer behaviour introduced by the demo-polish F0 contract
 * change (MOCK mode; the live half is `useComposePost.interim.live.test.ts`):
 *
 *  - the attach affordance still produces local DRAFT CHIPS, but a chip is not an
 *    uploaded asset (no `mediaId`) and the legacy `{ kind, alt }` placeholder is
 *    retired, so a published post carries NO media;
 *  - a TEXT-LESS post is blocked even with chips attached (`canPublish` false,
 *    `publish()` a no-op) — otherwise it would create a blank post;
 *  - publishing WITH chips sends the text and raises the in-fiction
 *    `mediaError` notice, then clears the chips, so a photo never vanishes
 *    silently.
 *
 * F4 replaces this with the real attach tray (upload via `@/core/media`).
 * `.ts` file: `createElement` stands in for JSX in the provider wrapper.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import type { Post } from '@/features/social'
import { DRAFT_MEDIA_NOT_SENT_MESSAGE, useComposePost } from './useComposePost'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

function imageFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' })
}

async function renderComposer(onPosted: (post: Post) => void) {
  const rendered = renderHook(() => useComposePost({ onPosted }), { wrapper })
  await waitFor(() => expect(rendered.result.current.canPost).toBe(true))
  return rendered
}

describe('useComposePost — interim draft chips (MOCK mode)', () => {
  it('still accepts a chip (the attach UI is unchanged)', async () => {
    const { result } = await renderComposer(vi.fn())

    act(() => result.current.attachImages([imageFile('flood.png')]))

    expect(result.current.media).toEqual([{ kind: 'image', alt: 'flood.png' }])
    expect(result.current.mediaError).toBeUndefined()
  })

  it('blocks a TEXT-LESS post even with chips attached', async () => {
    const onPosted = vi.fn<(post: Post) => void>()
    const { result } = await renderComposer(onPosted)

    act(() => result.current.attachImages([imageFile('flood.png')]))

    expect(result.current.canPublish).toBe(false)
    act(() => result.current.publish())
    act(() => result.current.setText('   '))
    expect(result.current.canPublish).toBe(false)
    act(() => result.current.publish())

    expect(onPosted).not.toHaveBeenCalled()
    // Nothing was sent, so nothing was cleared and no notice was raised.
    expect(result.current.media).toHaveLength(1)
    expect(result.current.mediaError).toBeUndefined()
  })

  it('publishes the TEXT only, carrying no media, when chips are attached', async () => {
    const onPosted = vi.fn<(post: Post) => void>()
    const { result } = await renderComposer(onPosted)

    act(() => result.current.attachImages([imageFile('flood.png'), imageFile('street.png')]))
    act(() => result.current.setText('Water is back on in Zone 3.'))
    expect(result.current.canPublish).toBe(true)
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    const post = onPosted.mock.calls[0]?.[0]
    expect(post?.text).toBe('Water is back on in Zone 3.')
    expect(post?.media).toBeUndefined()
  })

  it('raises the in-fiction notice and clears the chips after such a publish', async () => {
    const { result } = await renderComposer(vi.fn())

    act(() => result.current.attachImages([imageFile('flood.png')]))
    act(() => result.current.setText('Water is back on in Zone 3.'))
    act(() => result.current.publish())

    expect(result.current.mediaError).toBe(DRAFT_MEDIA_NOT_SENT_MESSAGE)
    expect(result.current.media).toEqual([])
    expect(result.current.text).toBe('')
    // In-fiction wording: no engineering vocabulary leaks to a participant.
    expect(DRAFT_MEDIA_NOT_SENT_MESSAGE).toMatch(/photo upload isn.t available yet/i)
    expect(DRAFT_MEDIA_NOT_SENT_MESSAGE).not.toMatch(/mock|fixture|F4|draft|mediaId|backend/i)
  })

  it('raises NO notice for an ordinary text-only publish', async () => {
    const onPosted = vi.fn<(post: Post) => void>()
    const { result } = await renderComposer(onPosted)

    act(() => result.current.setText('Just text.'))
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(result.current.mediaError).toBeUndefined()
  })

  it('clears the notice when the author attaches or removes a chip afterwards', async () => {
    const { result } = await renderComposer(vi.fn())
    act(() => result.current.attachImages([imageFile('a.png')]))
    act(() => result.current.setText('x'))
    act(() => result.current.publish())
    expect(result.current.mediaError).toBe(DRAFT_MEDIA_NOT_SENT_MESSAGE)

    act(() => result.current.attachImages([imageFile('b.png')]))

    expect(result.current.mediaError).toBeUndefined()
  })
})
