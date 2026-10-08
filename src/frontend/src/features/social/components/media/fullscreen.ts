/**
 * features/social/components/media/fullscreen.ts
 * ---------------------------------------------------------------------------
 * A tiny, typed wrapper over the Fullscreen API for the video player
 * (demo-polish F2). The standard API plus the `webkit` prefix older Safari
 * still needs, with NO `any`. We fullscreen the PLAYER WRAPPER (not the bare
 * `<video>`) so the "EXERCISE" watermark overlay (NFR-008) stays on screen in
 * fullscreen. `requestElementFullscreen` resolves `false` (never throws) when
 * the API is missing or the browser refuses (iPhone Safari only fullscreens a
 * `<video>`), which is the player's cue to open the modal viewer instead.
 *
 * World-neutral, no React.
 */

interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

/** The element currently shown fullscreen, if any. */
export function getFullscreenElement(): Element | null {
  const doc = document as PrefixedDocument
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
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

/** Leaves fullscreen if the document is in it. Never throws. */
export async function exitFullscreen(): Promise<void> {
  const doc = document as PrefixedDocument
  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen()
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen()
    }
  } catch {
    // Already out (or the browser refused) — nothing to recover.
  }
}

/** The change-event names to listen for on `document` (standard + legacy WebKit). */
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const
