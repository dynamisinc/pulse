/**
 * core/a11y/otherModal.ts
 * ---------------------------------------------------------------------------
 * One tiny rule that lets two focus traps coexist (demo-polish F2 Gate-1 H-1):
 * a trap must YIELD to any OTHER modal. Two traps that each "pull focus back
 * inside" fight forever when both are active — the shell's Pause / EndEx /
 * break-fiction overlay (`participant-shell`'s `useOverlayFocusTrap`) can mount
 * while the social media viewer (`social`'s `useFocusTrap`) is open, and each
 * one's `focusin` handler re-focuses its own container the moment the other
 * moves focus: an unbounded ping-pong that ends in a stack overflow and leaves
 * focus under the overlay.
 *
 * The convention: every trap in the product owns an element with
 * `aria-modal="true"`. A trap only acts on a focus move whose target is NOT
 * inside some other `[aria-modal="true"]` element; a focus that has landed in a
 * different modal belongs to that modal's own trap.
 *
 * World-neutral (`core/`): a pure DOM predicate, no React, no theme — imported by
 * the participant shell and the participant social channel alike (the shell must
 * never import from a feature, so the shared rule lives here).
 */

const MODAL_SELECTOR = '[aria-modal="true"]'

/**
 * True when `node` sits inside an `aria-modal="true"` element other than `own`
 * (the calling trap's container). `null`, text nodes outside any element, and
 * nodes inside `own` (or inside no modal at all) are all `false`.
 */
export function isInsideOtherModal(node: EventTarget | null, own: Element): boolean {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  if (element === null) return false
  const modal = element.closest(MODAL_SELECTOR)
  return modal !== null && modal !== own
}
