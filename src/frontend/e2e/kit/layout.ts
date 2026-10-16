/**
 * e2e/kit/layout.ts
 * ---------------------------------------------------------------------------
 * Layout assertions jsdom cannot make (mobile-tablet story 01; NFR-001).
 *
 *  - expectNoHorizontalScroll: the page never scrolls sideways.
 *  - expectTouchTarget: a control is a >= N px tap target, measured by HIT
 *    TESTING, not just its bounding box. Some shell controls extend their tap
 *    area with an invisible `::after` (touchHitArea.ts) on coarse pointers, so
 *    the box alone under-reports. We ask the browser what element is under a
 *    point near each edge of the N x N square centred on the control; each hit
 *    must be the control or one of its descendants (a pseudo-element hit resolves
 *    to its owner).
 *  - boxesOverlap: bounding-box intersection for "A does not cover B" checks.
 */
import { expect, type Locator, type Page } from '@playwright/test'

/** Fails when the page scrolls horizontally (scrollWidth > clientWidth). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(m.scrollWidth, `horizontal overflow: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`)
    .toBeLessThanOrEqual(m.clientWidth)
}

/**
 * Fails unless an N x N square centred on `locator` is tappable as the control.
 * Probes the centre and the four points just inside the square (centre +/- N/2 - 1)
 * on each axis; the control is scrolled into view first.
 */
export async function expectTouchTarget(locator: Locator, minPx = 44): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const result = await locator.evaluate((el, min) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const half = min / 2 - 1
    const probes: Array<[number, number]> = [
      [cx, cy], [cx - half, cy], [cx + half, cy], [cx, cy - half], [cx, cy + half],
    ]
    const misses = probes
      .map(([x, y]) => ({ x, y, hit: document.elementFromPoint(x, y) }))
      .filter(p => !p.hit || !(p.hit === el || el.contains(p.hit)))
      .map(p => `(${Math.round(p.x)},${Math.round(p.y)}) -> ${p.hit ? p.hit.tagName.toLowerCase() : 'nothing'}`)
    return { misses, box: `${Math.round(r.width)}x${Math.round(r.height)}` }
  }, minPx)
  expect(
    result.misses,
    `not a ${minPx}px touch target (visible box ${result.box}); points not hitting the control`,
  ).toEqual([])
}

export interface Box { x: number, y: number, width: number, height: number }

/** True when two boxes share any area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Bounding box or a clear failure when the element is not rendered. */
export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, 'element has no bounding box (not rendered?)').not.toBeNull()
  return box as Box
}
