/**
 * e2e/controller-tablet.spec.ts
 * ---------------------------------------------------------------------------
 * Controller console at the four tablet viewports (mobile-tablet story 16; closes wave B3).
 * STAFF world: this spec drives the COBRA console, never a participant surface.
 *
 * Viewports (TABLET-AMENDMENT section 1/2): 1024x768 and 768x1024 (tabs), 1180x820 (side by
 * side) and 820x1180 (stacked). Each describe sets `test.use({ viewport, hasTouch: true,
 * isMobile: false })`: touch input and a coarse pointer, but NOT mobile emulation (an iPad
 * reports a desktop-class layout viewport). The `controller-tablet` Playwright project runs
 * this file once and the phone/tablet projects skip it (playwright.config.ts), so no existing
 * spec is multiplied by four.
 *
 * What is covered
 *  - per viewport: no horizontal scroll, the story 12 arrangement for that band, the sticky
 *    command band (kill switch first, End exercise present), 44px toolstrip tools, flyouts
 *    (ENGINE / USAGE) that stay below the command band.
 *  - touch flows with their deliberate step: PERSONAS -> palette, pane tabs, open a review
 *    item, Take down (a stray tap inside the 400ms arming delay does nothing; a tap after it
 *    completes), Pause popover -> Freeze confirm step (stray tap ignored, Back returns).
 *  - geometry deferred from stories 12 to 15: the Take down confirm popover does not cover its
 *    trigger, the Pause popover does not cover the pill, the 1180 command band is measured with and
 *    without the dev-only button (DEV wraps; production-equivalent is one row).
 *  - rotation 1024x768 -> 768x1024 mid-flow: the selected pane tab and an open persona composer
 *    (with typed text) survive.
 *  - roles at 1180x820: evaluator and planner see no controller controls; the evaluator
 *    dashboard is only checked for reachability.
 *
 * Mock-only: the guide-shots server serves the fictional Coastal Surge exercise. The 400ms
 * arming delay (`ARMING_DELAY_MS`) is real here, which is the point: the stray tap is clicked a
 * few animation frames after the opening tap (synthetic `HTMLElement.click()`, fine because the
 * guard sits in `onClick`), the deliberate tap is a real touch tap after waiting past the delay.
 *
 * PRODUCTION-EQUIVALENT GEOMETRY: the dev-only "Simulate degraded (dev)" button
 * (`engine-degraded-simulate`) renders in the command band on the dev server and widens it, so
 * `openControllerConsole` hides it (as capture.mjs does) and all geometry reflects production.
 * The observation test measures the band both ways.
 *
 * Do not assert persistence across the 1280px boundary (story 12 known limit: panes remount).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  boxOf, boxesOverlap, expectNoHorizontalScroll, expectTouchTarget, signInAs, type Box,
} from './kit'

/** Longer than the 400ms touch arming delay (useArmedConfirm), with margin. */
const PAST_ARMING_MS = 650
/** useArmedConfirm's ARMING_DELAY_MS. */
const ARMING_DELAY_MS = 400

type Band = 'landscape' | 'landscapeWide' | 'portrait' | 'portraitTall'

interface TabletViewport {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly band: Band
  /** Pane tabs expected, in order. */
  readonly tabs: readonly string[]
}

const VIEWPORTS: readonly TabletViewport[] = [
  { name: '1024x768 landscape', width: 1024, height: 768, band: 'landscape', tabs: ['live-world', 'run-sheet'] },
  { name: '768x1024 portrait', width: 768, height: 1024, band: 'portrait', tabs: ['live-world', 'run-sheet', 'review'] },
  { name: '1180x820 landscape wide', width: 1180, height: 820, band: 'landscapeWide', tabs: [] },
  { name: '820x1180 portrait tall', width: 820, height: 1180, band: 'portraitTall', tabs: ['live-world', 'run-sheet'] },
]

async function openConsole(page: Page, role: 'controller' | 'evaluator' | 'planner' = 'controller') {
  await signInAs(page, role)
  await page.goto('/staff/console')
}

const HIDE_DEV_BUTTON_CSS = '[data-testid="engine-degraded-simulate"]{display:none!important}'

async function openControllerConsole(page: Page, hideDevButton = true): Promise<void> {
  await openConsole(page)
  if (hideDevButton) await page.addStyleTag({ content: HIDE_DEV_BUTTON_CSS })
  await expect(page.getByTestId('console-command-band')).toBeVisible()
  await expect(page.getByTestId('live-world-row').first()).toBeVisible()
}

/** The Paper that wraps a popover's content (the visible card), not just its inner box. */
async function paperBoxOf(inner: Locator): Promise<Box> {
  const handle = await inner.evaluateHandle(el => el.closest('.MuiPaper-root') ?? el)
  const box = await handle.asElement()?.boundingBox()
  expect(box, 'popover paper has no bounding box').toBeTruthy()
  return box as Box
}

interface StrayTap {
  /** True when the second control existed and was clicked. */
  readonly clicked: boolean
  /** `aria-disabled` of the second control at the moment it was clicked (not armed yet). */
  readonly ariaDisabled: string | null
  /** ms between the opening click and the stray click (must be inside the 400ms delay). */
  readonly elapsedMs: number
}

/**
 * Click the first `firstTestId` control and, a few animation frames later, click
 * `secondTestId` once it exists. This is the "stray tap right after opening" case:
 * far inside the 400ms arming delay and independent of how slow the test runner is. Returns what
 * the second control looked like when it was clicked, so the caller can assert it was unarmed.
 */
async function openThenStrayTap(
  page: Page, firstTestId: string, secondTestId: string,
): Promise<StrayTap> {
  return page.evaluate(async ([a, b]) => {
    const start = performance.now()
    document.querySelector<HTMLElement>(`[data-testid="${a}"]`)?.click()
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(r))
      const second = document.querySelector<HTMLElement>(`[data-testid="${b}"]`)
      if (second) {
        const ariaDisabled = second.getAttribute('aria-disabled')
        second.click()
        return { clicked: true, ariaDisabled, elapsedMs: performance.now() - start }
      }
    }
    return { clicked: false, ariaDisabled: null, elapsedMs: performance.now() - start }
  }, [firstTestId, secondTestId])
}

for (const vp of VIEWPORTS) {
  test.describe(`controller console at ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: false,
    })

    test.beforeEach(async ({ page }) => {
      await openControllerConsole(page)
    })

    test('has no horizontal scroll and a coarse pointer', async ({ page }) => {
      await expectNoHorizontalScroll(page)
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    })

    test('shows the story 12 arrangement for the band', async ({ page }) => {
      const tabs = page.getByTestId('console-pane-tabs')
      const queue = page.getByTestId('review-queue-column')
      if (vp.tabs.length === 0) {
        await expect(tabs).toHaveCount(0)
      } else {
        await expect(tabs).toBeVisible()
        await expect(tabs.getByRole('tab')).toHaveCount(vp.tabs.length)
        for (const id of vp.tabs) {
          const tab = page.getByTestId(`console-pane-tab-${id}`)
          await expect(tab).toBeVisible()
          expect((await boxOf(tab)).height).toBeGreaterThanOrEqual(44)
        }
        // Exactly one tab is selected, and the first one is by default.
        await expect(tabs.locator('[aria-selected="true"]')).toHaveCount(1)
        await expect(page.getByTestId(`console-pane-tab-${vp.tabs[0]}`)).toHaveAttribute('aria-selected', 'true')
      }

      const live = page.getByTestId('console-slot-live-world')
      const run = page.getByTestId('console-slot-run-sheet')
      if (vp.band === 'landscapeWide') {
        // Side by side: Live world | Run sheet in one row, Review docked to their right.
        await expect(live).toBeVisible()
        await expect(run).toBeVisible()
        await expect(queue).toBeVisible()
        const [l, r, q] = [await boxOf(live), await boxOf(run), await boxOf(queue)]
        expect(Math.abs(l.y - r.y), 'live world and run sheet share a row').toBeLessThanOrEqual(2)
        expect(r.x, 'run sheet is right of live world').toBeGreaterThanOrEqual(l.x + l.width - 1)
        expect(q.x, 'review queue is right of run sheet').toBeGreaterThanOrEqual(r.x + r.width - 1)
        expect(Math.round(q.width), 'review dock is the 296px clamp').toBeLessThanOrEqual(296)
      } else if (vp.band === 'landscape') {
        // One switcher + the Review queue continuously docked to its right.
        await expect(queue).toBeVisible()
        await expect(live).toBeVisible()
        await expect(run).toBeHidden()
        const [lb, qb] = [await boxOf(live), await boxOf(queue)]
        expect(qb.x, 'review dock is right of the pane').toBeGreaterThan(lb.x + lb.width - 1)
      } else if (vp.band === 'portraitTall') {
        // Stacked: switcher above a docked Review queue.
        await expect(queue).toBeVisible()
        const [t, q] = [await boxOf(tabs), await boxOf(queue)]
        expect(q.y, 'review queue is below the pane tabs').toBeGreaterThanOrEqual(t.y + t.height - 1)
        expect(q.width, 'review queue spans the work area').toBeGreaterThan(500)
      } else {
        // Portrait: Review is a badged tab, hidden until selected.
        await expect(page.getByTestId('console-pane-tab-review')).toContainText(/review/i)
        await expect(queue).toBeHidden()
      }
      await expectNoHorizontalScroll(page)
    })

    test('has a sticky command band: kill switch first, End exercise present', async ({ page }) => {
      const band = page.getByTestId('console-command-band')
      await expect(band).toBeVisible()
      const kill = page.getByTestId('engine-kill-switch')
      const end = page.getByTestId('lifecycle-end')
      await expect(kill).toBeVisible()
      await expect(end).toBeVisible()
      await expect(page.getByTestId('pause-pill')).toBeVisible()

      // Kill switch is the first control in the band: no other band control precedes it.
      const firstControl = await band.evaluate(el => {
        const ctl = el.querySelector<HTMLElement>('button, [role="button"], a[href], input')
        return ctl?.getAttribute('data-testid') ?? ctl?.textContent ?? ''
      })
      expect(firstControl, 'the first control in the command band').toBe('engine-kill-switch')

      // Kill switch is left of (or above) End exercise, never adjacent: End is the far end.
      const [k, e] = [await boxOf(kill), await boxOf(end)]
      expect(e.x > k.x + k.width || e.y > k.y + k.height, 'End exercise follows the kill switch').toBe(true)

      // Sticky: it stays put when the page/work area is scrolled.
      const before = await boxOf(band)
      const scrolled = await page.evaluate(() => {
        window.scrollTo(0, 400)
        let moved = window.scrollY
        const scrollers = '[data-testid="console-slot-live-world"], [data-testid="review-queue-column"], '
          + '[data-testid="live-world-list"]'
        document.querySelectorAll(scrollers)
          .forEach(n => { n.scrollTop = 400; moved = Math.max(moved, n.scrollTop) })
        return moved
      })
      expect(scrolled, 'nothing scrolled, so the sticky check proves nothing').toBeGreaterThan(0)
      const after = await boxOf(band)
      expect(Math.abs(after.y - before.y), 'command band moved on scroll').toBeLessThanOrEqual(1)
      await expect(kill).toBeVisible()
    })

    test('toolstrip tools are 44px touch targets', async ({ page }) => {
      for (const id of ['personas', 'engine-settings', 'engine-usage']) {
        await expectTouchTarget(page.getByTestId(`toolstrip-tool-${id}`), 44)
      }
    })

    test('ENGINE and USAGE flyouts stay below the command band and inside the viewport', async ({ page }) => {
      const band = await boxOf(page.getByTestId('console-command-band'))
      for (const [tool, panel] of [
        ['engine-settings', 'engine-settings-panel'],
        ['engine-usage', 'engine-usage-panel'],
      ] as const) {
        await page.getByTestId(`toolstrip-tool-${tool}`).tap()
        const flyout = page.getByTestId(panel)
        await expect(flyout).toBeVisible()
        const box = await boxOf(flyout)
        expect(boxesOverlap(box, band), `${panel} covers the command band`).toBe(false)
        expect(box.y, `${panel} starts above the band bottom`).toBeGreaterThanOrEqual(band.y + band.height - 1)
        expect(box.x + box.width, `${panel} extends past the viewport`).toBeLessThanOrEqual(vp.width + 1)
        expect(box.y + box.height, `${panel} extends past the viewport`).toBeLessThanOrEqual(vp.height + 1)
        // The kill switch (in the band) is still the topmost thing at its centre.
        const kill = await boxOf(page.getByTestId('engine-kill-switch'))
        const topmost = await page.evaluate(([x, y]) => {
          const hit = document.elementFromPoint(x as number, y as number)
          return hit?.closest('[data-testid="engine-kill-switch"]') != null
        }, [kill.x + kill.width / 2, kill.y + kill.height / 2])
        expect(topmost, 'a flyout covers the kill switch').toBe(true)
        await page.getByTestId(panel.replace('-panel', '-close')).tap()
        await expect(flyout).toBeHidden()
      }
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Touch flows (deliberate step). Run at the two shapes that matter: switcher and side by side.
// ---------------------------------------------------------------------------------------------

for (const vp of VIEWPORTS.filter(v => v.band === 'landscape' || v.band === 'landscapeWide')) {
  test.describe(`touch flows at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: false })

    test.beforeEach(async ({ page }) => {
      await openControllerConsole(page)
    })

    test('PERSONAS opens the palette with a single tap; close returns', async ({ page }) => {
      await page.getByTestId('toolstrip-tool-personas').tap()
      const palette = page.getByTestId('command-palette')
      await expect(palette).toBeVisible()
      await expect(page.getByTestId('command-palette-close')).toBeVisible()
      await expectTouchTarget(page.getByTestId('command-palette-close'), 44)
      await page.getByTestId('command-palette-close').tap()
      await expect(palette).toBeHidden()
    })

    if (vp.tabs.length > 0) {
      test('pane tabs switch the visible pane', async ({ page }) => {
        const live = page.getByTestId('console-slot-live-world')
        const run = page.getByTestId('console-slot-run-sheet')
        await expect(live).toBeVisible()
        await page.getByTestId('console-pane-tab-run-sheet').tap()
        await expect(page.getByTestId('console-pane-tab-run-sheet')).toHaveAttribute('aria-selected', 'true')
        await expect(run).toBeVisible()
        await expect(live).toBeHidden()
        await page.getByTestId('console-pane-tab-live-world').tap()
        await expect(live).toBeVisible()
        await expect(run).toBeHidden()
      })
    }

    test('a review item opens for editing and Cancel returns', async ({ page }) => {
      const card = page.getByTestId('review-card').first()
      await card.scrollIntoViewIfNeeded()
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: /^edit/i }).tap()
      await expect(page.getByTestId('engine-draft-edit-composer')).toBeVisible()
      await page.getByTestId('engine-draft-edit-composer').getByRole('button', { name: /cancel/i }).tap()
      await expect(page.getByTestId('engine-draft-edit-composer')).toBeHidden()
    })

    test('Take down: a stray tap does not complete it, a deliberate Confirm does', async ({ page }) => {
      const trigger = page.getByTestId('takedown-trigger').first()
      await trigger.scrollIntoViewIfNeeded()
      await expect(trigger).toBeVisible()

      // Stray tap: the confirm is clicked a few frames after the opening tap (< 400ms).
      const stray = await openThenStrayTap(page, 'takedown-trigger', 'takedown-confirm')
      expect(stray.clicked, 'the Take down confirm never opened').toBe(true)
      expect(stray.ariaDisabled, 'the confirm was already armed at the stray tap').toBe('true')
      expect(stray.elapsedMs, 'the stray tap landed after the arming delay').toBeLessThan(ARMING_DELAY_MS)
      const dialog = page.getByTestId('takedown-dialog')
      await expect(dialog, 'a tap inside the arming delay completed the take down').toBeVisible()
      await expect(page.getByTestId('takedown-confirmation')).toHaveCount(0)

      // Deliberate: wait past the arming delay; the Confirm is now armed; one tap completes it.
      await page.waitForTimeout(PAST_ARMING_MS)
      await expect(page.getByTestId('takedown-confirm')).not.toHaveAttribute('aria-disabled', 'true')
      await page.getByTestId('takedown-confirm').tap()
      await expect(dialog).toBeHidden()
      await expect(
        page.getByTestId('takedown-confirmation').or(page.getByTestId('live-world-removed')).first(),
      ).toBeVisible()
    })

    test('Take down confirm popover does not cover its trigger; Cancel closes it', async ({ page }) => {
      const trigger = page.getByTestId('takedown-trigger').first()
      await trigger.scrollIntoViewIfNeeded()
      await trigger.tap()
      const dialog = page.getByTestId('takedown-dialog')
      await expect(dialog).toBeVisible()
      const d = await boxOf(dialog)
      const t = await boxOf(trigger)
      console.log(`[geometry ${vp.name}] takedown dialog ${JSON.stringify(rounded(d))} trigger ${JSON.stringify(rounded(t))}`)
      expect(boxesOverlap(d, t), 'the confirm popover covers the Take down trigger').toBe(false)
      expect(d.x).toBeGreaterThanOrEqual(0)
      expect(d.y).toBeGreaterThanOrEqual(0)
      expect(d.x + d.width).toBeLessThanOrEqual(vp.width + 1)
      expect(d.y + d.height).toBeLessThanOrEqual(vp.height + 1)
      // Radio options are 44px rows.
      const options = dialog.getByRole('radio')
      expect(await options.count()).toBeGreaterThan(0)
      const heights = await options.evaluateAll(els =>
        els.map(el => (el.closest('label') ?? el).getBoundingClientRect().height))
      for (const h of heights) expect(h, 'a category row is under 44px').toBeGreaterThanOrEqual(43.5)
      await page.getByTestId('takedown-cancel').tap()
      await expect(dialog).toBeHidden()
    })

    test('Pause popover: Freeze shows the guarded confirm; stray tap ignored, Back returns', async ({ page }) => {
      const pill = page.getByTestId('pause-pill')
      await pill.tap()
      const popover = page.getByTestId('pause-popover')
      await expect(popover).toBeVisible()

      // Geometry: the popover's card does not overlap the pill.
      const card = await paperBoxOf(popover)
      const pillBox = await boxOf(pill)
      console.log(`[geometry ${vp.name}] pause popover ${JSON.stringify(rounded(card))} pill ${JSON.stringify(rounded(pillBox))}`)
      expect(boxesOverlap(card, pillBox), 'the pause popover overlaps the pill').toBe(false)
      expect(card.x + card.width).toBeLessThanOrEqual(vp.width + 1)

      await page.getByTestId('pause-tier-option-freeze').tap()
      // Open the confirm step and tap its Confirm a few frames later (inside the arming delay).
      const stray = await openThenStrayTap(page, 'pause-apply', 'pause-freeze-confirm-button')
      expect(stray.clicked, 'the Freeze confirm step never opened').toBe(true)
      expect(stray.ariaDisabled, 'Confirm freeze was already armed at the stray tap').toBe('true')
      expect(stray.elapsedMs, 'the stray tap landed after the arming delay').toBeLessThan(ARMING_DELAY_MS)
      const confirm = page.getByTestId('pause-freeze-confirm')
      await expect(confirm, 'the guarded Freeze confirm step did not appear').toBeVisible()
      await expect(page.getByTestId('pause-freeze-confirm-register')).toBeVisible()
      await expect(page.getByTestId('staff-header-state-pill-label'), 'a stray tap froze the world')
        .not.toContainText(/frozen/i)

      // Back returns to the tier list, with Freeze still selected.
      const back = page.getByTestId('pause-freeze-back')
      const confirmBtn = page.getByTestId('pause-freeze-confirm-button')
      const [b, c] = [await boxOf(back), await boxOf(confirmBtn)]
      expect(boxesOverlap(b, c), 'Back and Confirm freeze overlap').toBe(false)
      expect(b.height).toBeGreaterThanOrEqual(44)
      expect(c.height).toBeGreaterThanOrEqual(44)
      await back.tap()
      await expect(confirm).toBeHidden()
      await expect(page.getByTestId('pause-tier-option-freeze')).toBeVisible()

      // Deliberate: Pause -> wait past the arming delay -> Confirm freeze freezes the world.
      await page.getByTestId('pause-apply').tap()
      await expect(confirm).toBeVisible()
      await page.waitForTimeout(PAST_ARMING_MS)
      await expect(confirmBtn).not.toHaveAttribute('aria-disabled', 'true')
      await confirmBtn.tap()
      await expect(confirm).toBeHidden()
      await expect(page.getByTestId('staff-header-state-pill-label')).toContainText(/frozen/i)
    })
  })
}

// ---------------------------------------------------------------------------------------------
// 1180 command band: DEV wraps (dev-only button), production is one row (story 12 AC note, W-001).
// ---------------------------------------------------------------------------------------------

test.describe('command band at 1180x820 (dev versus production)', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false })

  /** Kill switch / End exercise geometry of the command band right now. */
  async function measureBand(page: Page) {
    const band = await boxOf(page.getByTestId('console-command-band'))
    const kill = await boxOf(page.getByTestId('engine-kill-switch'))
    const end = await boxOf(page.getByTestId('lifecycle-end'))
    return { band, kill, end, wraps: end.y >= kill.y + kill.height - 1 }
  }

  test('the band is one row in production; the DEV build wraps (dev button)', async ({ page }) => {
    await openControllerConsole(page, false)
    // DEV build: the "Simulate degraded (dev)" button is visible and widens the band.
    const dev = await measureBand(page)
    const devNote = `DEV build: band ${Math.round(dev.band.height)}px tall, End exercise `
      + `${dev.wraps ? 'on a second row' : 'on the first row'} (kill y=${Math.round(dev.kill.y)}, `
      + `End y=${Math.round(dev.end.y)}).`
    test.info().annotations.push({ type: 'observed-dev', description: devNote })
    console.log(`[observed] ${devNote}`)

    // Production-equivalent: the dev-only button never renders in a production build.
    await page.addStyleTag({ content: HIDE_DEV_BUTTON_CSS })
    const prod = await measureBand(page)
    const prodNote = `PRODUCTION-equivalent: band ${Math.round(prod.band.height)}px tall, End exercise `
      + `${prod.wraps ? 'on a second row' : 'on the first row'} (kill y=${Math.round(prod.kill.y)}, `
      + `End y=${Math.round(prod.end.y)}).`
    test.info().annotations.push({ type: 'observed-prod', description: prodNote })
    console.log(`[observed] ${prodNote}`)
    expect(prod.wraps, 'with the dev button hidden the band is one row').toBe(false)
    expect(prod.band.x + prod.band.width).toBeLessThanOrEqual(1180)
    await expect(page.getByTestId('lifecycle-end')).toBeVisible()
  })

  // Accepted (Tom, 2026-10-29): a safety banner (provider degraded, swamped mode ON) may wrap
  // the band to a second row at 1180, for leads too; the banners stay full text (NFR-001).
  // What must hold: End exercise stays visible, on-screen and tappable, and nothing scrolls
  // sideways. Degraded is the alarm state the mock can reach (the dev simulate button).
  test('a safety banner may wrap the band, but End exercise stays on-screen and tappable', async ({ page }) => {
    await openControllerConsole(page, false)
    await page.getByTestId('engine-degraded-simulate').click()
    await expect(page.getByText('PROVIDER DEGRADED', { exact: false })).toBeVisible()
    await page.addStyleTag({ content: HIDE_DEV_BUTTON_CSS })

    const { band, end, wraps } = await measureBand(page)
    expect(wraps, 'the alarm banner wraps the band (the state this test is about)').toBe(true)
    expect(end.x + end.width, 'End exercise ends inside the band (no clip)').toBeLessThanOrEqual(band.x + band.width)
    expect(end.x + end.width, 'End exercise ends inside the viewport').toBeLessThanOrEqual(1180)
    expect(end.y + end.height, 'End exercise sits inside the band').toBeLessThanOrEqual(band.y + band.height)
    expect(end.y + end.height, 'End exercise sits inside the viewport').toBeLessThanOrEqual(820)
    await expect(page.getByTestId('lifecycle-end')).toBeVisible()
    await expectTouchTarget(page.getByTestId('lifecycle-end'))
    await expectNoHorizontalScroll(page)
  })
})

for (const viewport of [{ width: 1180, height: 820 }, { width: 1024, height: 768 }]) {
  test.describe(`pause popover at ${viewport.width}x${viewport.height} (issue #626)`, () => {
    test.use({ viewport, hasTouch: true, isMobile: false })

    // Before #627 the left-aligned popover spilled into the toolstrip at both tablet widths
    // (1180: 17px, 1024: 40px); it now right-aligns to the pill when it would cross the edge.
    test('the popover stays left of the toolstrip (#626, PR #627)', async ({ page }) => {
      await openControllerConsole(page)
      await page.getByTestId('pause-pill').tap()
      const card = await paperBoxOf(page.getByTestId('pause-popover'))
      const strip = await boxOf(page.getByTestId('staff-toolstrip'))
      expect(card.x + card.width, 'popover overlaps the toolstrip').toBeLessThanOrEqual(strip.x + 0.5)
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Rotation: 1024x768 -> 768x1024 mid-flow.
// ---------------------------------------------------------------------------------------------

test.describe('rotation 1024x768 to 768x1024', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false })

  test('the selected pane tab and an open persona composer survive', async ({ page }) => {
    await openControllerConsole(page)
    await page.getByTestId('console-pane-tab-run-sheet').tap()
    await expect(page.getByTestId('console-pane-tab-run-sheet')).toHaveAttribute('aria-selected', 'true')

    // Open the persona composer: PERSONAS -> Fulton County EM, then type a draft.
    await page.getByTestId('toolstrip-tool-personas').tap()
    await page.getByTestId('command-palette').getByText('Fulton County EM').first().tap()
    const composer = page.getByLabel('Post as Fulton County EM')
    await expect(composer).toBeVisible()
    const draft = 'Boil-water advisory remains in effect for Zones 2-4. (rotation e2e)'
    await composer.fill(draft)

    // Rotate.
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(page.getByTestId('console-pane-tab-review'), 'portrait adds the Review tab').toBeVisible()

    await expect(page.getByTestId('console-pane-tab-run-sheet')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('console-slot-run-sheet')).toBeVisible()
    await expect(page.getByLabel('Post as Fulton County EM'), 'the composer closed on rotation').toBeVisible()
    await expect(page.getByLabel('Post as Fulton County EM')).toHaveValue(draft)
    await expectNoHorizontalScroll(page)
  })
})

// ---------------------------------------------------------------------------------------------
// Roles at 1180x820: role guards still hold on a tablet.
// ---------------------------------------------------------------------------------------------

test.describe('roles at 1180x820', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false })

  test('evaluator sees the console view-only: no controller controls', async ({ page }) => {
    await openConsole(page, 'evaluator')
    await expect(page.getByTestId('console-view-only-chip')).toBeVisible()
    for (const id of ['engine-kill-switch', 'pause-pill', 'lifecycle-end', 'takedown-trigger', 'toolstrip-tool-personas']) {
      await expect(page.getByTestId(id), `${id} is visible to an evaluator`).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /end exercise/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^take down/i })).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })

  test('the evaluator dashboard is reachable (not asserted further)', async ({ page }) => {
    await signInAs(page, 'evaluator')
    await page.goto('/staff/evaluate')
    await expect(page).toHaveURL(/\/staff\/evaluate$/)
    await expect(page.getByText('EVALUATOR DASHBOARD')).toBeVisible()
  })

  // Story 17 admits planners to the console for content work (WR-002 chip); conduct stays
  // controller-only.
  test('planner enters the console content-only and sees no conduct controls', async ({ page }) => {
    await openConsole(page, 'planner')
    await expect(page.getByTestId('console-planner-chip')).toBeVisible()
    for (const id of ['engine-kill-switch', 'pause-pill', 'lifecycle-end', 'takedown-trigger']) {
      await expect(page.getByTestId(id), `${id} is visible to a planner`).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /end exercise|pause control|take down/i })).toHaveCount(0)
  })
})

function rounded(b: Box): Box {
  const r = Math.round
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) }
}
