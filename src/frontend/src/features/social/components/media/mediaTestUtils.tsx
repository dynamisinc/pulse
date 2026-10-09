/**
 * features/social/components/media/mediaTestUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY helper for the media components' suites (demo-polish F2). Never
 * imported by app code.
 *
 * `VideoPlayer` reads `useChromeConfig()` (the NFR-008 watermark signal), which
 * needs an `ExerciseContextProvider` AND a React Query client — exactly what the
 * real participant shell supplies. `renderWithMediaProviders` supplies both, so a
 * test that renders a video (directly or inside a `PostCard`) does not have to
 * re-derive the stack.
 *
 * It also stubs the three `HTMLMediaElement` methods jsdom does not implement
 * (`play`, `pause`, `load`) so a click on a control does not log a "not
 * implemented" error; `installMediaElementStubs` returns the spies.
 */
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'

export function renderWithMediaProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>{ui}</ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

export interface MediaElementStubs {
  readonly play: ReturnType<typeof vi.fn>
  readonly pause: ReturnType<typeof vi.fn>
}

/**
 * Replaces `HTMLMediaElement.prototype.play/pause/load` with spies. `play` flips the
 * element's `paused` flag and fires a `play` event (like a browser); `pause` flips it
 * back and fires `pause` — so the player's state machine runs end to end. Call once
 * per test (e.g. in `beforeEach`); the spies are rebuilt each call.
 */
export function installMediaElementStubs(): MediaElementStubs {
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true
    },
  })
  const play = vi.fn(function play(this: HTMLMediaElement) {
    paused.set(this, false)
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  const pause = vi.fn(function pause(this: HTMLMediaElement) {
    const wasPlaying = paused.get(this) === false
    paused.set(this, true)
    if (wasPlaying) this.dispatchEvent(new Event('pause'))
  })
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play']
  HTMLMediaElement.prototype.pause = pause as unknown as HTMLMediaElement['pause']
  HTMLMediaElement.prototype.load = vi.fn()
  return { play, pause }
}
