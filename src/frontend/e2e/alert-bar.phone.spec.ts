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
