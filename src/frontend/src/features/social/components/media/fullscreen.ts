/**
 * features/social/components/media/fullscreen.ts
 * ---------------------------------------------------------------------------
 * The video player's Fullscreen helpers (demo-polish F2). The document-level half
 * (`getFullscreenElement`, `exitFullscreen`, the change-event names) lives in
 * `core/dom/fullscreen` — shared with the shell's overlay layer, which must leave any
 * fullscreen when a Pause / EndEx / break-fiction overlay takes over — and is
 * re-exported here. This file keeps the ELEMENT-specific half, typed with no `any`:
 *
 * We fullscreen the PLAYER WRAPPER (not the bare `<video>`) so the "EXERCISE"
 * watermark overlay (NFR-008) stays on screen in fullscreen.
 * `requestElementFullscreen` resolves `false` (never throws) when the API is missing or
 * the browser refuses it (iPhone Safari only fullscreens a `<video>`), which is the
 * player's cue to open the modal viewer instead. `exitVideoFullscreenIOS` leaves iOS's
 * native `<video>`-only fullscreen, which the page cannot overlay.
 *
 * World-neutral, no React.
 */

export {
  FULLSCREEN_CHANGE_EVENTS,
  exitFullscreen,
  getFullscreenElement,
} from '@/core/dom/fullscreen'

interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

interface WebkitVideoElement extends HTMLVideoElement {
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
}

/** Asks the browser to show `element` fullscreen. `true` when it did; `false` otherwise. */
export async function requestElementFullscreen(element: HTMLElement): Promise<boolean> {
  const target = element as PrefixedElement
  try {
    if (typeof target.requestFullscreen === 'function') {
      await target.requestFullscreen()
      return true
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      await target.webkitRequestFullscreen()
      return true
    }
  } catch {
    return false
  }
  return false
}

function callWebkitExit(video: WebkitVideoElement): void {
  try {
    video.webkitExitFullscreen?.()
  } catch {
    // Not in iOS native fullscreen (or the browser refused) — nothing to recover.
  }
}

/**
 * Leaves iOS Safari's NATIVE video fullscreen (the `<video>`-only presentation that the
 * page cannot overlay). Best effort, hardened once: the call can be a no-op while the
 * native player is still animating in, so on the NEXT animation frame it re-checks
 * `webkitDisplayingFullscreen` and retries a single time. A missing method or a throw is
 * ignored. (The native player cannot be PREVENTED, only left — it may flash.)
 */
export function exitVideoFullscreenIOS(video: HTMLVideoElement): void {
  const ios = video as WebkitVideoElement
  callWebkitExit(ios)
  if (typeof window.requestAnimationFrame !== 'function') return
  window.requestAnimationFrame(() => {
    if (ios.webkitDisplayingFullscreen === true) callWebkitExit(ios)
  })
}
