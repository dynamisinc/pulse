/**
 * features/social/layout/useRouteFocus.ts
 * ---------------------------------------------------------------------------
 * Moves keyboard/screen-reader focus to the main region's heading whenever the
 * route changes (demo-polish F1, accessibility AC: "on every route change focus
 * moves to the main region heading (replaces the old feed<->detail focus
 * effect)").
 *
 * A single-page app does not reload, so a screen-reader user who activates "Explore"
 * would otherwise hear nothing and stay on a link that is no longer the page: focus
 * is moved for them, to the new page's `<h1>`, so the new context is announced.
 *
 * WHAT COUNTS AS A ROUTE CHANGE: a change of PATHNAME, not of search/hash. NOT the
 * first render (the app-level `RouteFocusScope` already placed focus on arrival, and
 * stealing it again would be hostile), and NOT a hop out of a redirecting path
 * (`/` or an unknown path -> `/home`): that is plumbing, not a navigation the user
 * made.
 *
 * WHERE FOCUS GOES: the first VISIBLE `<h1>` inside the main region -- visible
 * meaning not inside a `[hidden]` subtree, because the Home view stays mounted
 * (hidden) behind other routes and its heading must not be picked. The heading is
 * given `tabindex="-1"` on the fly so it can take programmatic focus without
 * becoming a tab stop. If the page has no heading YET (a profile still loading), the
 * main region itself takes focus, and a short-lived observer hands focus to the
 * heading the moment it appears -- but only if focus is still parked on the main
 * region, so it never overrides something the user has since focused.
 *
 * `preventScroll` is deliberate: scrolling is `useScrollRestoration`'s job (top for
 * a new page, the saved position for Back); focus must not fight it.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { matchSocialRoute } from './socialNavigation'

/** How long to wait for a late heading before giving up and leaving focus on main. */
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

export function useRouteFocus(mainRef: RefObject<HTMLElement | null>, pathname: string): void {
  const previousPathname = useRef(pathname)

  useLayoutEffect(() => {
    const previous = previousPathname.current
    previousPathname.current = pathname
    if (previous === pathname) return
    if (matchSocialRoute(previous) === 'redirect') return

    const main = mainRef.current
    if (main === null) return

    const heading = findVisibleHeading(main)
    if (heading !== null) {
      focusProgrammatically(heading)
      return
    }

    // No heading yet: park on the main region, then follow focus to the heading
    // when it renders (see the module header).
    focusProgrammatically(main)
    const stop = () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
    const observer = new MutationObserver(() => {
      const late = findVisibleHeading(main)
      if (late === null) return
      stop()
      if (document.activeElement === main) focusProgrammatically(late)
    })
    const timer = window.setTimeout(stop, LATE_HEADING_WINDOW_MS)
    observer.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })
    return stop
  }, [pathname, mainRef])
}
