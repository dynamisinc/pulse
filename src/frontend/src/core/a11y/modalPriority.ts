/**
 * core/a11y/modalPriority.ts
 * ---------------------------------------------------------------------------
 * ONE-WAY modal priority for focus traps (demo-polish F2 Gate-1 H-1 / M-A): the
 * shell's Pause / EndEx / break-fiction overlay ALWAYS wins over a channel's own
 * modal (the social media viewer, a compose dialog, ...). Two traps that each
 * "pull focus back inside" fight forever — the first cut made them back off for
 * each other, which stopped the stack overflow but let focus sit in the channel
 * modal UNDER the overlay. The rule is now asymmetric:
 *
 *  - A CHANNEL trap stands aside COMPLETELY while ANY other `[aria-modal="true"]`
 *    element (that is not inside it and does not contain it) is mounted: no
 *    pull-back, no Tab cycling, no focus-on-mount, no focus restore.
 *    `hasOtherModalMounted` is that test.
 *  - The SHELL overlay trap never backs off for a channel modal: it pulls focus
 *    back from anywhere outside itself. It only backs off for another SHELL-level
 *    layer, which is marked with the `data-shell-layer` attribute
 *    (`isInsideOtherShellLayer`) — so two shell layers cannot ping-pong either.
 *
 * Every channel trap in the product must use `hasOtherModalMounted`; the shell
 * layers must carry `data-shell-layer`. World-neutral (`core/`): pure DOM
 * predicates, no React, no theme — the shell must never import from a feature, so
 * the shared rule lives here.
 */

/** The attribute that marks a shell-level layer (the overlay) for the shell's own trap. */
export const SHELL_LAYER_ATTR = 'data-shell-layer'

const MODAL_SELECTOR = '[aria-modal="true"]'
const SHELL_LAYER_SELECTOR = `[${SHELL_LAYER_ATTR}]`

/**
 * True when some `aria-modal="true"` element other than `own` is in the document and is
 * neither inside `own` nor an ancestor of it (a modal nested in, or hosting, this one is
 * not "another" modal). A channel trap stands aside while this is true.
 */
export function hasOtherModalMounted(own: Element): boolean {
  for (const modal of document.querySelectorAll(MODAL_SELECTOR)) {
    if (modal !== own && !own.contains(modal) && !modal.contains(own)) return true
  }
  return false
}

/**
 * True when `node` sits inside a shell layer (`data-shell-layer`) other than `own`. The
 * shell's overlay trap backs off for a focus that has landed in a DIFFERENT shell layer.
 */
export function isInsideOtherShellLayer(node: EventTarget | null, own: Element): boolean {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  if (element === null) return false
  const layer = element.closest(SHELL_LAYER_SELECTOR)
  return layer !== null && layer !== own
}
