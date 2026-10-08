/**
 * features/social/layout/useScrollRestoration.ts
 * ---------------------------------------------------------------------------
 * Window scroll position across in-channel navigation (demo-polish F1, "State
 * survives Back": "scroll position (feed stays mounted-hidden or scroll is
 * restored)").
 *
 * Keeping the Home view mounted preserves its CONTENT, but the page scrolls the
 * WINDOW, and the window's scroll offset belongs to the document, not to a
 * component: while another route is showing, Home is `display: none`, the document
 * gets shorter, and the browser clamps the offset. So the position is recorded here
 * and written back:
 *
 *  - It is recorded continuously (a passive `scroll` listener) against the CURRENT
 *    history entry's `key`. By the time the browser clamps the offset on a
 *    navigation, the new key is already current, so the clamped value is filed under
 *    the NEW entry and the previous entry keeps the position the user actually left.
 *  - On an entry change, the entry's saved position is restored if it has one (Back
 *    / Forward return to an entry we have seen) and otherwise the page starts at the
 *    top (a fresh push, a redirect).
 *
 * BROWSER KIND ONLY. The memory provider "never touches browser history" -- and the
 * staff preview it serves is embedded in a page whose scroll is the staff app's, not
 * the channel's. So under `kind === 'memory'` this hook is inert.
 *
 * The write is `document.documentElement.scrollTop = y` rather than
 * `window.scrollTo`, which jsdom reports as "not implemented" on every call.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

function readScroll(): number {
  return window.scrollY
}

function writeScroll(top: number): void {
  document.documentElement.scrollTop = top
}

export function useScrollRestoration(locationKey: string, enabled: boolean): void {
  const positions = useRef(new Map<string, number>())
  const currentKey = useRef(locationKey)

  useEffect(() => {
    if (!enabled) return
    const record = () => {
      positions.current.set(currentKey.current, readScroll())
    }
    window.addEventListener('scroll', record, { passive: true })
    return () => window.removeEventListener('scroll', record)
  }, [enabled])

  useLayoutEffect(() => {
    if (currentKey.current === locationKey) return
    currentKey.current = locationKey
    if (!enabled) return
    writeScroll(positions.current.get(locationKey) ?? 0)
  }, [locationKey, enabled])
}
