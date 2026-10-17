/**
 * features/social/components/media/playbackCoordinator.test.ts
 * ---------------------------------------------------------------------------
 * "One video plays at a time" (demo-polish F2; mobile-tablet story 04).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimPlayback, pauseActivePlayback, releasePlayback, resetPlaybackForTests,
} from './playbackCoordinator'

function fakeVideo(): HTMLVideoElement {
  const el = document.createElement('video')
  el.pause = vi.fn()
  return el
}

beforeEach(resetPlaybackForTests)

describe('playbackCoordinator', () => {
  it('claiming pauses the previous holder, not the new one', () => {
    const a = fakeVideo()
    const b = fakeVideo()
    claimPlayback(a)
    claimPlayback(b)
    expect(a.pause).toHaveBeenCalledTimes(1)
    expect(b.pause).not.toHaveBeenCalled()
  })

  it('re-claiming by the same element pauses nothing', () => {
    const a = fakeVideo()
    claimPlayback(a)
    claimPlayback(a)
    expect(a.pause).not.toHaveBeenCalled()
  })

  it('release only clears the holder; pauseActivePlayback pauses it', () => {
    const a = fakeVideo()
    const b = fakeVideo()
    claimPlayback(a)
    releasePlayback(b)
    pauseActivePlayback()
    expect(a.pause).toHaveBeenCalledTimes(1)
    releasePlayback(a)
    pauseActivePlayback()
    expect(a.pause).toHaveBeenCalledTimes(1)
  })
})
