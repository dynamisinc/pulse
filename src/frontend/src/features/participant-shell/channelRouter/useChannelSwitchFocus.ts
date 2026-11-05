/**
 * features/participant-shell/channelRouter/useChannelSwitchFocus.ts
 * ---------------------------------------------------------------------------
 * Moves focus to the content heading when the mounted channel changes
 * (channels-foundation 12, focus-and-title AC; WCAG 2.4.3). The
 * `RouteFocusScope` pattern, one level down: `RoleAwareEntry` focuses the
 * participant surface when the world changes; this focuses the new channel's
 * `h1` when the channel changes (or a not-found replaces it). Moves inside one
 * channel stay that channel's own (Social's `useRouteFocus`).
 *
 * The first settled view is left alone (the world-level scope has just placed
 * focus): a `null` key (the landing entry still waiting for the enabled set) is
 * not a view yet, so `null` -> the first channel moves nothing. A channel's
 * heading can render after its data loads, so focus parks on the scope and
 * follows the heading when it appears, for a short window.
 *
 * World: participant. No UI.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'

/** How long to wait for a late heading before leaving focus on the scope. */
const LATE_HEADING_WINDOW_MS = 4000

function findVisibleHeading(root: HTMLElement): HTMLElement | null {
  for (const heading of root.querySelectorAll<HTMLElement>('h1')) {
    if (heading.closest('[hidden]') === null) return heading
  }
  return null
}

function focusProgrammatically(element: HTMLElement): void {
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
  element.focus({ preventScroll: true })
}

/** Focuses the heading inside `scopeRef` whenever `switchKey` changes (`null`: not settled). */
export function useChannelSwitchFocus(
  scopeRef: RefObject<HTMLElement | null>,
  switchKey: string | null,
): void {
  const previousKey = useRef(switchKey)

  useLayoutEffect(() => {
    if (switchKey === null) return
    const previous = previousKey.current
    previousKey.current = switchKey
    if (previous === null || previous === switchKey) return

    const scope = scopeRef.current
    if (scope === null) return

    const heading = findVisibleHeading(scope)
    if (heading !== null) {
      focusProgrammatically(heading)
      return
    }

    focusProgrammatically(scope)
    const stop = () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
    const observer = new MutationObserver(() => {
      const late = findVisibleHeading(scope)
      if (late === null) return
      stop()
      if (document.activeElement === scope) focusProgrammatically(late)
    })
    const timer = window.setTimeout(stop, LATE_HEADING_WINDOW_MS)
    observer.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })
    return stop
  }, [switchKey, scopeRef])
}
