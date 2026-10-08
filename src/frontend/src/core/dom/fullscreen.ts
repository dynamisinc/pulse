/**
 * core/dom/fullscreen.ts
 * ---------------------------------------------------------------------------
 * The document-level Fullscreen API, typed (standard + the `webkit` prefix older
 * Safari still needs, no `any`). World-neutral and element-agnostic so BOTH sides
 * of the shell/channel boundary can use it without importing each other:
 *
 *  - the shell's overlay layer leaves any fullscreen the moment a Pause / EndEx /
 *    break-fiction overlay takes over (the browser paints a fullscreen element
 *    above everything, so otherwise the overlay — which must cover everything —
 *    would stay hidden behind it);
 *  - the social video player tracks and leaves its own fullscreen.
 *
 * The element-specific half (requesting fullscreen on a player wrapper, iOS native
 * video fullscreen) stays with the social player, which re-exports these three.
 */

interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

/** The element currently shown fullscreen, if any. */
export function getFullscreenElement(): Element | null {
  const doc = document as PrefixedDocument
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
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
