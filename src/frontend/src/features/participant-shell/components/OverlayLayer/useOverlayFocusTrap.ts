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
 * THE OVERLAY ALWAYS WINS (demo-polish F2 Gate-1 H-1 / M-A). A channel can have its
 * own `aria-modal` surface open — the social media viewer — when this overlay mounts,
 * and the overlay paints above it. The priority is ONE-WAY: this trap pulls focus back
 * from EVERYWHERE outside itself (channel modals included) and never backs off for a
 * channel modal; the channel's trap (`core/a11y/modalPriority`'s `hasOtherModalMounted`)
 * stands aside completely while this overlay is mounted, so the two cannot ping-pong and
 * focus can never sit in the viewer under the overlay. The only thing this trap backs off
 * for is another SHELL-level layer (an element marked `data-shell-layer`), so two shell
 * layers cannot fight either.
 *
 * `layerKey` re-engages the trap when the overlay's ROOT ELEMENT is swapped while it
 * stays active (pause -> break-fiction, in-fiction -> out-of-fiction register): without it
 * the listeners kept holding the removed element and focus fell to `<body>`. The focus
 * to restore on deactivation is remembered ONCE, at activation, across such swaps.
 * A Tab while focus is outside the overlay (e.g. on `<body>`) enters the overlay at its
 * first/last control instead of wandering through the page underneath.
 *
 * World: participant. Pure behavior hook, no UI, no COBRA.
 */

import { useEffect, useRef } from 'react'
import { isInsideOtherShellLayer } from '@/core/a11y/modalPriority'

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
 * element `tabIndex={-1}` so it is programmatically focusable. Pass a `layerKey` that
 * changes whenever the root element is replaced while `active` stays true.
 */
export function useOverlayFocusTrap<T extends HTMLElement>(active: boolean, layerKey = '') {
  const containerRef = useRef<T | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Remember what to restore ONCE per activation (not per root swap). Declared BEFORE the
  // engage effect below so it records the focus from before the overlay took it.
  useEffect(() => {
    if (!active) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  }, [active])

  // Engage the CURRENT root element: focus it, pull focus back, cycle Tab.
  useEffect(() => {
    if (!active) return undefined

    const container = containerRef.current
    if (!container) return undefined

    container.focus()

    function handleFocusIn(event: FocusEvent): void {
      const target = event.target
      if (!container || !(target instanceof Node) || container.contains(target)) return
      // Another SHELL layer owns this focus; anything else — page content, a channel's
      // own modal — is pulled back: the overlay always wins.
      if (isInsideOtherShellLayer(target, container)) return
      const [first] = getFocusable(container)
      ;(first ?? container).focus()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || !container) return
      if (isInsideOtherShellLayer(document.activeElement, container)) return
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

      const current = document.activeElement
      if (!container.contains(current)) {
        // Focus is outside the overlay (e.g. on <body>): enter it, never walk the page behind.
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, layerKey])

  // Restore on deactivation or unmount — overlays clear on a server push, never a user dismiss.
  // Declared AFTER the engage effect so (cleanups run in declaration order) the trap's listeners
  // are already removed when focus is handed back.
  useEffect(() => {
    if (!active) return undefined
    return () => {
      const previouslyFocused = returnFocusRef.current
      returnFocusRef.current = null
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return containerRef
}
