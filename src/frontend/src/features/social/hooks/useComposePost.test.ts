/**
 * features/social/hooks/useComposePost.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the compose helpers that back `<Composer>` (story
 * 01; SOC-001, NFR-004), PLUS the mock-mode publish-path regression coverage
 * for the UAT live-compose fix:
 *  - `parseHashtags` / `parseMentions` extract distinct tags/mentions for the
 *    model/telemetry (S2 does not navigate them);
 *  - `validateImageFiles` enforces the media rules (0–4 images, MIME, size)
 *    and rejects a video with the documented inline-video follow-up message;
 *  - MOCK mode's `publish()` is UNCHANGED by the live-compose addition: it
 *    still calls `createPost` + `onPosted`, and never touches
 *    `livePostActions.publishPost`.
 *
 * (The mock-mode publish path is ALSO exercised end-to-end through the real
 * component in `../components/Composer.test.tsx`; the LIVE-mode branch — which
 * needs `@/core/config/mockData` mocked file-wide — lives in the sibling
 * `useComposePost.live.test.ts`, mirroring the `useReaction.readonly.test.ts`
 * split: `vi.mock` is hoisted per file, so a scenario needing a different mock
 * shape gets its own file rather than fighting the existing ones.)
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import type { Post } from '@/features/social'
import {
  MAX_IMAGE_BYTES,
  parseHashtags,
  parseMentions,
  useComposePost,
  validateImageFiles,
} from './useComposePost'
import { publishPost } from '../services/livePostActions'

// The live-persist seam is mocked here purely to assert MOCK mode never calls
// it — `USE_MOCK_DATA` is on by default in this test environment (Vitest runs
// with `import.meta.env.DEV`), so the hook's own branch takes the mock path
// for real; nothing about `@/core/config/mockData` is mocked in this file.
vi.mock('../services/livePostActions', () => ({
  publishPost: vi.fn(),
}))

// This file is `.ts`, not `.tsx` (matches `useReaction.readonly.test.ts`'s own
// note) — `createElement` stands in for JSX in the provider wrapper.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

function imageFile(name: string, type = 'image/png', size = 1024): File {
  const file = new File(['x'], name, { type })
  // jsdom sets size from content; override it so size validation is exercised
  // without materializing multi-MB blobs.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('parseHashtags', () => {
  it('extracts distinct hashtags, order-preserved, with the # stripped', () => {
    expect(parseHashtags('boil water #Fairhaven #zone2 again #Fairhaven')).toEqual([
      'Fairhaven',
      'zone2',
    ])
  })

  it('returns an empty array when there are no hashtags', () => {
    expect(parseHashtags('just some plain text')).toEqual([])
  })
})

describe('parseMentions', () => {
  it('extracts distinct mentions, order-preserved, with the @ stripped', () => {
    expect(parseMentions('cc @FulcoEM and @FairhavenWater and @FulcoEM')).toEqual([
      'FulcoEM',
      'FairhavenWater',
    ])
  })
})

describe('validateImageFiles', () => {
  it('accepts valid images and maps each to a PostMedia with its filename as alt', () => {
    const result = validateImageFiles(
      [imageFile('flood.png'), imageFile('street.jpg', 'image/jpeg')],
      0,
    )
    expect(result.error).toBeUndefined()
    expect(result.media).toEqual([
      { kind: 'image', alt: 'flood.png' },
      { kind: 'image', alt: 'street.jpg' },
    ])
  })

  it('rejects the batch when it would exceed 4 images total', () => {
    const result = validateImageFiles([imageFile('a.png'), imageFile('b.png')], 3)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/up to 4 images/i)
  })

  it('rejects an unsupported MIME type', () => {
    const result = validateImageFiles([imageFile('doc.pdf', 'application/pdf')], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/isn't supported/i)
  })

  it('rejects an oversized image', () => {
    const result = validateImageFiles([imageFile('huge.png', 'image/png', MAX_IMAGE_BYTES + 1)], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/too large/i)
  })

  it('rejects a video with the documented inline-video follow-up message', () => {
    const result = validateImageFiles([imageFile('clip.mp4', 'video/mp4')], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/inline video is coming soon/i)
  })
})

describe('useComposePost — MOCK mode publish() is unchanged by the live-compose fix', () => {
  afterEach(() => {
    vi.mocked(publishPost).mockClear()
  })

  it('publishes via createPost + onPosted, and never calls livePostActions.publishPost', async () => {
    const onPosted = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() => useComposePost({ onPosted }), { wrapper })

    await waitFor(() => expect(result.current.canPost).toBe(true))

    act(() => result.current.setText('Boil-water advisory lifted for zone 3.'))
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    const post = onPosted.mock.calls[0]?.[0]
    expect(post?.text).toBe('Boil-water advisory lifted for zone 3.')
    expect(post?.origin).toBe('participant')

    expect(publishPost).not.toHaveBeenCalled()
  })
})
