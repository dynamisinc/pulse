/**
 * features/participant-shell/components/OverlayLayer/useLeaveFullscreenWhileActive.ts
 * ---------------------------------------------------------------------------
 * Nothing stays fullscreen behind a Pause / EndEx / break-fiction overlay
 * (demo-polish F2 re-review HI-1; SHELL-CONTRACT §3, CTL-024). The browser paints
 * a fullscreen element ABOVE EVERYTHING — above any z-index — so a channel's
 * fullscreen video would hide the overlay, and break-fiction's "REAL-WORLD MESSAGE"
 * (which must cover everything) would stay hidden behind a frozen frame.
 *
 * While `active` (re-engaged when `layerKey` changes), this leaves any current
 * fullscreen at once — `exitFullscreen()` needs no user gesture — and leaves again
 * if something enters fullscreen while the overlay is still up. It talks to
 * `document` only (via `core/dom/fullscreen`): the shell never imports a channel
 * (here, social), and it covers every channel, not just the one that happens to
 * play video.
 *
 * `onLeft` fires once fullscreen has actually been left (the exit promise settled, or a
 * `fullscreenchange` reported no fullscreen element). The overlay uses it to re-take
 * focus: while another element is fullscreen the browser makes everything outside it
 * un-focusable, so the overlay's focus-on-activation can silently fail, and the page
 * behind (whose controls — Play, ... — would then still be reachable) keeps focus.
 *
 * World: participant. Pure behavior hook, no UI, no COBRA.
 */

import { useEffect, useRef } from 'react'
import {
  FULLSCREEN_CHANGE_EVENTS,
  exitFullscreen,
  getFullscreenElement,
} from '@/core/dom/fullscreen'

/** Leaves fullscreen now, and again whenever it is re-entered, while `active`. */
export function useLeaveFullscreenWhileActive(
  active: boolean,
  layerKey = '',
  onLeft?: () => void,
): void {
  // The latest callback, read from handlers that must not re-subscribe on every render.
  const onLeftRef = useRef(onLeft)
  useEffect(() => {
    onLeftRef.current = onLeft
  })

  useEffect(() => {
    if (!active) return undefined

    const leave = () => {
      if (getFullscreenElement() === null) return
      void exitFullscreen().then(() => onLeftRef.current?.())
    }
    const handleChange = () => {
      if (getFullscreenElement() !== null) leave()
      else onLeftRef.current?.()
    }

    leave()
    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, handleChange)
    return () => {
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, handleChange)
    }
  }, [active, layerKey])
}
