/**
 * features/login/hooks/useKeepSubmitVisible.ts
 * ---------------------------------------------------------------------------
 * Keeps the sign-in form's submit button above the on-screen keyboard
 * (mobile-tablet story 03; NFR-001, D0 section 4.6). PARTICIPANT WORLD, pre-auth.
 *
 * On a phone the keyboard shrinks the VISUAL viewport (not the layout viewport),
 * and the browser only scrolls the focused field into view, which can leave the
 * "Sign in" button hidden below the keyboard. This hook listens for
 * `visualViewport` resize events and, while a field inside the container has
 * focus, scrolls the submit button into view with `block: 'nearest'` (the
 * smallest scroll that reveals it, so the focused field is not pushed away when
 * both fit). It does nothing where `visualViewport` is unsupported (the
 * keyboard's own Go/Enter key, set through `enterKeyHint`, still submits).
 * Zoom-only resizes (scale != 1 or changed) and height growth are ignored.
 * Reduced-motion users get an instant jump rather than a smooth scroll.
 */
import { useEffect, type RefObject } from 'react'

export function useKeepSubmitVisible(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const maybeViewport = window.visualViewport
    if (!maybeViewport) return undefined
    const viewport: VisualViewport = maybeViewport

    // Pinch-zoom also fires `resize`. Only a keyboard (height shrinks at scale 1) counts.
    let lastHeight = viewport.height
    let lastScale = viewport.scale

    function reveal(): void {
      const { height, scale } = viewport
      const shrank = height < lastHeight
      const zoomOnly = scale !== 1 || scale !== lastScale
      lastHeight = height
      lastScale = scale
      if (zoomOnly || !shrank) return
      const container = containerRef.current
      const active = document.activeElement
      if (!container || !active || !container.contains(active)) return
      if (!(active instanceof HTMLInputElement)) return
      const submit = container.querySelector<HTMLElement>('button[type="submit"]')
      if (!submit || typeof submit.scrollIntoView !== 'function') return
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      submit.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }

    viewport.addEventListener('resize', reveal)
    return () => viewport.removeEventListener('resize', reveal)
  }, [containerRef])
}
