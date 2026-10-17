/**
 * e2e/alert-bar.phone.spec.ts
 * ---------------------------------------------------------------------------
 * Locks in the verified phone/tablet behavior of the persistent alert bar
 * (mobile-tablet story 05; PRT-010, PRT-012, NFR-001, COR-053). Runs at every
 * Playwright project: 360 / 390 phones and the 768 tablet.
 *
 * Alerts are injected through the guide-shots `alerts` seam (`seedAlerts`), so
 * there is no backend. Covered:
 *  - the FULL message is visible (wrapped, never ellipsized) with the severity
 *    chip showing a text label (not colour only);
 *  - the bar does not overlap the channel nav, and the published
 *    `--pulse-alert-height` matches the bar's measured height (within 1 px);
 *  - "Details ->" navigates client-side to /alerts (most severe first) and
 *    browser Back returns to the feed;
 *  - "Details ->" and "+N more" are 44 px touch targets (hit-test based);
 *  - the ChannelNav dateline is absent (story 17: no real clock is installed in
 *    the mock, so it would show the wall-clock date, COR-053).
 */
import { test, expect, type Page } from '@playwright/test'
import {
  boxOf, boxesOverlap, expectNoHorizontalScroll, expectNoWallClock, expectTouchTarget,
  seedAlerts, seedOverlay, type SeedAlert,
} from './kit'

const EMERGENCY: SeedAlert = {
  id: 'e2e-emergency',
  severity: 'emergency',
  message: 'Boil water order: Fairhaven Zones 2-4. Do not drink tap water unless boiled.',
  scenarioTime: '2033-09-04T10:30:00-04:00',
}
const ADVISORY: SeedAlert = {
  id: 'e2e-advisory',
  severity: 'advisory',
  message: 'Road closures on Route 9 near the treatment plant. Expect long delays.',
  scenarioTime: '2033-09-04T10:15:00-04:00',
}

async function openFeedWith(page: Page, alerts: readonly SeedAlert[]): Promise<void> {
  await seedAlerts(page, alerts)
  await page.goto('/home')
  await expect(page.getByTestId('pulse-alert-bar')).toBeVisible()
}

/** The published `--pulse-alert-height`, in px. */
async function publishedAlertHeight(page: Page): Promise<number> {
  const raw = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--pulse-alert-height'))
  return parseFloat(raw)
}

test.describe('alert bar: emergency + advisory', () => {
  test.beforeEach(async ({ page }) => {
    await openFeedWith(page, [ADVISORY, EMERGENCY])
  })

  test('shows the full emergency message with a text severity label', async ({ page }) => {
    const bar = page.getByTestId('pulse-alert-bar')
    const message = bar.getByTestId('pulse-alert-bar-message')
    await expect(message).toHaveText(EMERGENCY.message)
    // Wrapped, never ellipsized or clipped: no overflow and no ellipsis styling.
    const clip = await message.evaluate(el => ({
      overflowX: el.scrollWidth > el.clientWidth,
      overflowY: el.scrollHeight > el.clientHeight,
      ellipsis: getComputedStyle(el).textOverflow === 'ellipsis',
    }))
    expect(clip).toEqual({ overflowX: false, overflowY: false, ellipsis: false })
    // Severity is not colour only: the chip carries a text label.
    await expect(bar.getByText('EMERGENCY')).toBeVisible()
    await expect(bar.getByTestId('pulse-alert-bar-more-chip')).toHaveText('+1 more')
    await expect(bar).toHaveAttribute('role', 'status')
    await expectNoHorizontalScroll(page)
    await expectNoWallClock(page)
  })

  test('the bar does not overlap the channel nav; the height var matches', async ({ page }) => {
    const bar = page.getByTestId('pulse-alert-bar')
    const nav = page.getByRole('navigation', { name: 'Channel navigation' })
    await expect(nav).toBeVisible()
    const barBox = await boxOf(bar)
    expect(boxesOverlap(barBox, await boxOf(nav)), 'alert bar covers the channel nav').toBe(false)
    expect(Math.abs((await publishedAlertHeight(page)) - barBox.height)).toBeLessThanOrEqual(1)

    // Expanding the "+N more" stack grows the bar; the var follows it.
    await page.getByTestId('pulse-alert-bar-more-chip').click()
    await expect(page.getByTestId('pulse-alert-bar-stack-item')).not.toHaveCount(0)
    await expect.poll(async () => {
      const h = (await boxOf(bar)).height
      return Math.abs((await publishedAlertHeight(page)) - h)
    }).toBeLessThanOrEqual(1)
    expect(boxesOverlap(await boxOf(bar), await boxOf(nav)), 'expanded bar covers nav').toBe(false)
    await expectNoHorizontalScroll(page)
  })

  test('Details and +N more are 44px touch targets', async ({ page }) => {
    await expectTouchTarget(page.getByTestId('pulse-alert-bar-details'), 44)
    await expectTouchTarget(page.getByTestId('pulse-alert-bar-more-chip'), 44)
  })

  test('the Details hit-slop stays inside the band', async ({ page }) => {
    // The invisible coarse-pointer ::after must not spill onto the compliance
    // chrome above or the channel nav below (those would win the tap).
    const details = await boxOf(page.getByTestId('pulse-alert-bar-details'))
    const band = await boxOf(page.getByTestId('pulse-alert-bar'))
    const cx = details.x + details.width / 2
    for (const y of [band.y + 1, band.y + band.height - 1]) {
      const inside = await page.evaluate(([x, py]) => {
        const hit = document.elementFromPoint(x as number, py as number)
        return !!hit?.closest('[data-testid="pulse-alert-bar"]')
      }, [cx, y])
      expect(inside, `point (${Math.round(cx)},${Math.round(y)}) is outside the alert band`)
        .toBe(true)
    }
  })

  test('Details opens /alerts (most severe first) and Back returns', async ({ page }) => {
    await page.getByTestId('pulse-alert-bar-details').click()
    await expect(page).toHaveURL(/\/alerts$/)
    const history = page.getByTestId('pulse-alerts-history')
    await expect(history).toBeVisible()
    const items = history.getByTestId('pulse-alerts-history-item')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText(EMERGENCY.message)
    await expect(items.nth(1)).toContainText(ADVISORY.message)
    // The bar persists across channels/routes (PRT-010) without hiding the list.
    await expect(page.getByTestId('pulse-alert-bar')).toBeVisible()
    await expectNoHorizontalScroll(page)

    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
  })

  test('has no ChannelNav dateline (no real exercise clock installed)', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Channel navigation' })).toBeVisible()
    await expect(page.locator('.pulse-channel-nav-dateline')).toHaveCount(0)
  })
})

test.describe('alert bar: advisory ticker', () => {
  test('shows the full advisory message and Details is a 44px target', async ({ page }) => {
    await openFeedWith(page, [ADVISORY])
    const bar = page.getByTestId('pulse-alert-bar')
    await expect(bar.getByTestId('pulse-alert-bar-message')).toHaveText(ADVISORY.message)
    await expect(bar.getByText('ADVISORY')).toBeVisible()
    await expect(bar.getByTestId('pulse-alert-bar-more-chip')).toHaveCount(0)
    const barBox = await boxOf(bar)
    expect(Math.abs((await publishedAlertHeight(page)) - barBox.height)).toBeLessThanOrEqual(1)
    await expectTouchTarget(page.getByTestId('pulse-alert-bar-details'), 44)
    await expectNoHorizontalScroll(page)
  })
})

/**
 * Copilot #584: a SHORT alert fits on one line, so the band can be shorter
 * than 44 px. A centred 44 px hit area must then still sit fully inside the
 * band; otherwise the compliance banner above (higher z-index) or the channel
 * nav below wins the tap. The long-message fixtures above mask this case.
 */
test.describe('alert bar: short single-line alerts', () => {
  const SHORT_EMERGENCY: SeedAlert = { ...EMERGENCY, id: 'e2e-short-e', message: 'Evacuate now.' }
  const SHORT_ADVISORY: SeedAlert = { ...ADVISORY, id: 'e2e-short-a', message: 'Boil water.' }

  for (const [label, alerts, controls] of [
    ['emergency band', [SHORT_ADVISORY, SHORT_EMERGENCY], ['pulse-alert-bar-details', 'pulse-alert-bar-more-chip']],
    ['advisory ticker', [SHORT_ADVISORY], ['pulse-alert-bar-details']],
  ] as const) {
    test(`${label}: every 44px target fits inside the band`, async ({ page }) => {
      await openFeedWith(page, alerts)
      const band = await boxOf(page.getByTestId('pulse-alert-bar'))
      for (const id of controls) {
        const control = page.getByTestId(id)
        await expectTouchTarget(control, 44)
        const box = await boxOf(control)
        const cy = box.y + box.height / 2
        expect(cy - 22, `${id} 44px target pokes above the band`).toBeGreaterThanOrEqual(band.y - 0.5)
        expect(cy + 22, `${id} 44px target pokes below the band`)
          .toBeLessThanOrEqual(band.y + band.height + 0.5)
      }
    })
  }
})

/** A second advisory so the ticker has something to rotate to. */
const ADVISORY_2: SeedAlert = {
  id: 'e2e-advisory-2',
  severity: 'advisory',
  message: 'Shelters are open at Fairhaven High School.',
  scenarioTime: '2033-09-04T10:20:00-04:00',
}

test.describe('alert bar: ticker rotation and reduced motion', () => {
  test('rotates (and the live region text changes) without a reduced-motion preference', async ({ page }) => {
    // Rotation announces: the persistent role=status node's text changes.
    // (The project default is reduced motion; opt out for the control case.)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await openFeedWith(page, [ADVISORY, ADVISORY_2])
    const bar = page.getByTestId('pulse-alert-bar')
    await expect(bar).toHaveAttribute('role', 'status')
    await expect(bar).toHaveAttribute('aria-live', 'polite')
    const first = await bar.getByTestId('pulse-alert-bar-message').innerText()
    await page.clock.runFor(3600)
    await expect(bar.getByTestId('pulse-alert-bar-message')).not.toHaveText(first)
    await expect(bar).toContainText('ADVISORY')
    // The published height still tracks the bar after the text swapped.
    await expect.poll(async () => {
      const h = (await boxOf(bar)).height
      return Math.abs((await publishedAlertHeight(page)) - h)
    }).toBeLessThanOrEqual(1)
  })

  test('holds on one alert with prefers-reduced-motion: reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install()
    await openFeedWith(page, [ADVISORY, ADVISORY_2])
    const bar = page.getByTestId('pulse-alert-bar')
    const message = bar.getByTestId('pulse-alert-bar-message')
    const first = await message.innerText()
    await page.clock.runFor(20000)
    await expect(message).toHaveText(first)
    await expectTouchTarget(page.getByTestId('pulse-alert-bar-details'), 44)
  })
})

test.describe('alert bar: emergency live region at phone, tablet sizes', () => {
  test('the bar is one role=status node, assertive, carrying the full text and severity label', async ({ page }) => {
    await openFeedWith(page, [EMERGENCY])
    await expect(page.getByTestId('pulse-alert-bar')).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: EMERGENCY.message })).toHaveCount(1)
    const bar = page.getByTestId('pulse-alert-bar')
    await expect(bar).toHaveAttribute('role', 'status')
    await expect(bar).toHaveAttribute('aria-live', 'assertive')
    await expect(bar).toHaveAttribute('aria-atomic', 'true')
    await expect(bar).toContainText('EMERGENCY')
    await expect(bar).toContainText(EMERGENCY.message)
  })
})

type Rect = { x: number, y: number, width: number, height: number }

/** Which shell layer is topmost at a point: the alert bar, the overlay, or neither. */
async function topmostLayerAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px as number, py as number)
    return el?.closest('[data-testid="pulse-overlay-pause-alert-shield"]') ? 'shield'
      : el?.closest('[data-testid="pulse-shell-content-region"]') ? 'content'
        : el?.closest('[data-testid="pulse-alert-bar"]') ? 'bar'
          : el?.closest('[data-shell-layer="overlay"]') ? 'overlay' : 'other'
  }, [x, y])
}

/** Top and bottom edges plus the centre of a box all hit the expected layer. */
async function expectLayerOnTop(page: Page, box: Rect, layer: string, what: string): Promise<void> {
  const cx = box.x + box.width / 2
  for (const y of [box.y + 1, box.y + box.height / 2, box.y + box.height - 1]) {
    const hit = await topmostLayerAt(page, cx, y)
    // An inert bar is skipped by hit-testing: the pause click shield must be what is hit,
    // never the feed underneath.
    const ok = layer === 'bar-inert' ? hit === 'shield' : hit === layer
    expect(ok, `${what} is covered at y=${Math.round(y)} (hit: ${hit})`).toBe(true)
  }
}

test.describe('alert bar: emergency + pause overlay interplay (Tom, 10/16)', () => {
  test('pause keeps the alert visible and inert; focus trap holds; Details does nothing', async ({ page }) => {
    await seedOverlay(page, { state: 'pause', register: 'out-of-fiction', message: '' })
    await openFeedWith(page, [EMERGENCY])
    const overlay = page.getByTestId('pulse-overlay-pause-out-of-fiction')
    const heading = overlay.getByRole('heading', { name: 'EXERCISE PAUSED' })
    await expect(heading).toBeVisible()

    const bar = page.getByTestId('pulse-alert-bar')
    const message = bar.getByTestId('pulse-alert-bar-message')
    await expect(message).toBeVisible()
    await expect(bar).toHaveAttribute('inert', '')
    await expectLayerOnTop(page, await boxOf(message), 'bar-inert', 'emergency text')
    await expectLayerOnTop(page, await boxOf(heading), 'overlay', 'overlay heading')
    expect(boxesOverlap(await boxOf(message), await boxOf(heading))).toBe(false)
    expect(boxesOverlap(await boxOf(bar), await boxOf(overlay.locator('h1')))).toBe(false)
    await expectNoHorizontalScroll(page)

    // Assistive tech: the dialog's description carries the alert.
    await expect(overlay).toHaveAccessibleDescription(
      `Active alert. EMERGENCY: ${EMERGENCY.message}`)

    // Inert: tapping Details navigates nowhere.
    const details = await boxOf(page.getByTestId('pulse-alert-bar-details'))
    await page.touchscreen.tap(details.x + details.width / 2, details.y + details.height / 2)
    await expect(page).toHaveURL(/\/home$/)

    // Focus trap: focus lands in the overlay and Tab never leaves it.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const o = document.querySelector('[data-shell-layer="overlay"]')
        return !!o && (o === document.activeElement || o.contains(document.activeElement))
      })
      expect(inside, `focus escaped the overlay after Tab #${i + 1}`).toBe(true)
    }
  })

  test('taps on the inert bar band never reach the feed scrolled underneath', async ({ page }) => {
    await seedOverlay(page, { state: 'pause', register: 'in-fiction', message: '' })
    await openFeedWith(page, [EMERGENCY])
    await page.evaluate(() => {
      const spacer = document.createElement('div')
      spacer.style.height = '3000px'
      document.body.appendChild(spacer)
      window.scrollTo(0, 600)
    })
    const band = await boxOf(page.getByTestId('pulse-alert-bar'))
    const before = await page.evaluate(() => document.body.innerText)
    const points = [0.05, 0.5, 0.95].map(frac => ({
      x: band.x + band.width * (0.1 + frac * 0.8),
      y: band.y + band.height * frac,
    }))
    // Non-vacuous: without the shield the band points fall through to the feed.
    const setShield = (show: boolean) => page.evaluate(display => {
      const el = document.querySelector<HTMLElement>(
        '[data-testid="pulse-overlay-pause-alert-shield"]')
      if (el) el.style.display = display
    }, show ? '' : 'none')
    await setShield(false)
    const bare = await Promise.all(points.map(pt => topmostLayerAt(page, pt.x, pt.y)))
    expect(bare, 'without the shield some band point must hit the feed').toContain('content')
    await setShield(true)
    for (const pt of points) {
      expect(await topmostLayerAt(page, pt.x, pt.y), 'band point').toBe('shield')
      await page.touchscreen.tap(pt.x, pt.y)
    }
    await expect(page).toHaveURL(/\/home$/)
    expect(await page.evaluate(() => document.body.innerText)).toBe(before)
  })

  test('the pause dialog has empty polite and assertive alert-change regions at open', async ({ page }) => {
    await seedOverlay(page, { state: 'pause', register: 'in-fiction', message: '' })
    await openFeedWith(page, [EMERGENCY])
    const live = page.getByTestId('pulse-overlay-pause-alert-live')
    const assertive = page.getByTestId('pulse-overlay-pause-alert-live-assertive')
    await expect(live).toBeEmpty()
    await expect(live).toHaveAttribute('aria-live', 'polite')
    await expect(assertive).toBeEmpty()
    await expect(assertive).toHaveAttribute('aria-live', 'assertive')
  })

  test('pause holds the ticker rotation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await seedOverlay(page, { state: 'pause', register: 'in-fiction', message: '' })
    await openFeedWith(page, [ADVISORY, ADVISORY_2])
    const message = page.getByTestId('pulse-alert-bar').getByTestId('pulse-alert-bar-message')
    const first = await message.innerText()
    await page.clock.runFor(20000)
    await expect(message).toHaveText(first)
  })

  test('EndEx covers the alert bar entirely', async ({ page }) => {
    await seedOverlay(page, { state: 'endex', register: 'out-of-fiction', message: '' })
    await openFeedWith(page, [EMERGENCY])
    const overlay = page.getByTestId('pulse-overlay-endex-out-of-fiction')
    await expect(overlay).toBeVisible()
    const bar = await boxOf(page.getByTestId('pulse-alert-bar'))
    await expectLayerOnTop(page, bar, 'overlay', 'alert band under EndEx')
  })
})

test.describe('alert bar: scroll restoration on Back (AC3)', () => {
  test('Back from /alerts restores the previous scroll position', async ({ page }) => {
    await openFeedWith(page, [ADVISORY, EMERGENCY])
    await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
    const scrollable = await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(200)
      .then(() => true, () => false)
    expect(scrollable, 'the seeded feed must be tall enough to scroll').toBe(true)
    const target = await page.evaluate(() => {
      window.scrollTo(0, 250)
      return window.scrollY
    })
    expect(target).toBeGreaterThan(150)
    // Let the app's scroll listener settle before leaving.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(target)
    await page.getByTestId('pulse-alert-bar-details').click()
    await expect(page).toHaveURL(/\/alerts$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - target))
      .toBeLessThanOrEqual(5)
  })
})
