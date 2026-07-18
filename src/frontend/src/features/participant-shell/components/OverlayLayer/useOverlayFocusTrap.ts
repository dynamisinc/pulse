/**
 * features/participant-shell/components/OverlayLayer/useOverlayFocusTrap.ts
 * ---------------------------------------------------------------------------
 * The overlay layer's focus-trap primitive (feature: participant-shell,
 * story 05; NFR-001 — see docs/features/participant-shell/05-overlay-layer.md
 * cross-cutting AC "overlays trap focus and are announced").
 *
 * `OverlayLayer.tsx` mounts as a top-level sibling of the channel content, not
 * a descendant of it (it must be able to paint ABOVE content/nav/alert-bar,
 * per `SHELL_Z`). That means a channel's interactive elements stay in the DOM
 * — and stay Tab-reachable — underneath a visually-covering overlay unless
 * something actively redirects focus back in. This hook is that something:
 *
 *  - On activation, remembers `document.activeElement` (to restore later) and
 *    moves focus into the overlay container so assistive tech announces its
 *    accessible name (role + `aria-labelledby`) immediately.
 *  - A `focusin` listener on `document` pulls focus back inside the container
 *    the instant it lands anywhere else — covering both Tab/Shift+Tab cycling
 *    and any non-keyboard focus change (e.g. a script elsewhere calling
 *    `.focus()`), since the overlays this hook guards have no dismiss
 *    affordance a keydown-only trap would need to special-case.
 *  - A `keydown` listener additionally cycles Tab/Shift+Tab among the
 *    container's OWN focusable descendants (none exist for any state this
 *    story ships today — no overlay is user-dismissable — but the trap stays
 *    correct if a later story's overlay content ever adds one).
 *  - On deactivation (state clears — a SERVER push, never a user dismiss),
 *    restores focus to whatever was focused before, if it's still attached.
 *
 * World: participant. Pure behavior hook, no UI, no COBRA.
 */

import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Traps focus inside the returned ref's element while `active` is `true`.
 * The consumer attaches the ref to the overlay's root element and gives that
 * element `tabIndex={-1}` so it is programmatically focusable.
 */
export function useOverlayFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return undefined

    const container = containerRef.current
    if (!container) return undefined

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    container.focus()

    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (!container || !(target instanceof Node) || container.contains(target)) return
      // Focus escaped the overlay (e.g. landed on hidden page chrome/content
      // still in the DOM underneath) — pull it back inside.
      const [first] = getFocusable(container)
      ;(first ?? container).focus()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !container) return
      const focusable = getFocusable(container)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (!first || !last) {
        // No focusable descendants (every overlay this story ships today) —
        // keep focus pinned on the container itself.
        event.preventDefault()
        container.focus()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keydown', handleKeyDown)
      // Overlays clear on a server push, never a user dismiss — restore
      // whatever had focus before the trap engaged, if it's still attached.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return containerRef
}
