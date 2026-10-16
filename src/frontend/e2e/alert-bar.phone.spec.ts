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
  seedAlerts, type SeedAlert,
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
