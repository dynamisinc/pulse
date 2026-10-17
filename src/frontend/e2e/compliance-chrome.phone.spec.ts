/**
 * e2e/compliance-chrome.phone.spec.ts
 * ---------------------------------------------------------------------------
 * The EXERCISE compliance banners on phones and tablets (#612, D7-005 phone amendment;
 * NFR-008). Runs at every Playwright project (phone-360, phone-390, tablet-768), and the
 * phone projects also re-check at 412 px (a large Android phone).
 *
 * Locks in:
 *  - the FULL banner text is visible: no horizontal clipping and no line clamp hit
 *    with the default markings (they wrap to two lines on phones);
 *  - tablets keep the single 22 px line;
 *  - the published `--pulse-chrome-top/bottom` insets equal the measured banner heights
 *    (within 1 px), so everything pinned to the chrome follows a taller band;
 *  - nothing that reads those insets overlaps a banner: the alert bar, the bottom tab
 *    bar, the compose sheet, and the pause / EndEx holding pages.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { boxOf, expectNoHorizontalScroll, seedAlerts, seedOverlay, type Box, type SeedAlert } from './kit'

const ALERT: SeedAlert = {
  id: 'e2e-chrome-alert',
  severity: 'emergency',
  message: 'Boil water order: Fairhaven Zones 2-4. Do not drink tap water unless boiled.',
  scenarioTime: '2033-09-04T10:30:00-04:00',
}

const top = (page: Page) => page.getByTestId('pulse-compliance-chrome-top')
const bottom = (page: Page) => page.getByTestId('pulse-compliance-chrome-bottom')

/** True when the banner's text is fully shown: no horizontal clip, no clamped lines. */
async function showsFullText(banner: Locator): Promise<boolean> {
  return banner.evaluate(el => {
    const text = el.querySelector('span') as HTMLElement
    return el.scrollWidth <= el.clientWidth + 1
      && text.scrollWidth <= text.clientWidth + 1
      && text.scrollHeight <= text.clientHeight + 1
  })
}

/**
 * The published insets RESOLVED to px. At tablet width they are `calc(22px + env(...))`
 * strings, so they are measured through a probe element sized by the var.
 */
async function publishedInsets(page: Page): Promise<{ top: number, bottom: number }> {
  return page.evaluate(() => {
    const resolve = (name: string) => {
      const probe = document.createElement('div')
      probe.style.cssText = `position:absolute;visibility:hidden;height:var(${name}, 0px)`
      document.body.appendChild(probe)
      const px = probe.getBoundingClientRect().height
      probe.remove()
      return px
    }
    return { top: resolve('--pulse-chrome-top'), bottom: resolve('--pulse-chrome-bottom') }
  })
}

/** `box` sits entirely between the bottom of the top banner and the top of the bottom one. */
async function expectBetweenBanners(page: Page, box: Box, what: string): Promise<void> {
  const t = await boxOf(top(page))
  const b = await boxOf(bottom(page))
  expect(box.y, `${what} starts below the top banner`).toBeGreaterThanOrEqual(t.y + t.height - 0.5)
  expect(box.y + box.height, `${what} ends above the bottom banner`).toBeLessThanOrEqual(b.y + 0.5)
}

async function checkBanners(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0
  for (const banner of [top(page), bottom(page)]) {
    await expect(banner).toBeVisible()
    expect(await showsFullText(banner), 'banner text is not clipped').toBe(true)
    const box = await boxOf(banner)
    if (width >= 700) {
      await expect(banner).not.toHaveAttribute('data-wrapped')
      expect(Math.round(box.height)).toBe(22)
    } else {
      await expect(banner).toHaveAttribute('data-wrapped', 'true')
      expect(box.height).toBeGreaterThanOrEqual(22)
    }
  }
  const insets = await publishedInsets(page)
  expect(Math.abs(insets.top - (await boxOf(top(page))).height)).toBeLessThanOrEqual(1)
  expect(Math.abs(insets.bottom - (await boxOf(bottom(page))).height)).toBeLessThanOrEqual(1)
  await expectNoHorizontalScroll(page)
}

test.describe('compliance banners', () => {
  test('show their full text and publish matching insets', async ({ page }) => {
    await page.goto('/home')
    await checkBanners(page)
  })

  test('also at 412px (large Android phone)', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 700, 'phone projects only')
    await page.setViewportSize({ width: 412, height: 915 })
    await page.goto('/home')
    await checkBanners(page)
  })

  test('the alert bar and the bottom tab bar sit clear of both banners', async ({ page }) => {
    await seedAlerts(page, [ALERT])
    await page.goto('/home')
    await expect(page.getByTestId('pulse-alert-bar')).toBeVisible()
    await expectBetweenBanners(page, await boxOf(page.getByTestId('pulse-alert-bar')), 'alert bar')
    // The tab bar is phone-only; on a tablet the left rail scrolls with the page instead.
    const tabBar = page.getByTestId('bottom-tab-bar')
    if (await tabBar.isVisible()) {
      await expectBetweenBanners(page, await boxOf(tabBar), 'bottom tab bar')
    }
  })

  test('the compose sheet sits clear of both banners', async ({ page }) => {
    await page.goto('/home')
    await page.getByRole('button', { name: 'Post', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expectBetweenBanners(page, await boxOf(dialog), 'compose sheet')
  })

  for (const state of ['pause', 'endex'] as const) {
    test(`the ${state} holding page card sits clear of both banners`, async ({ page }) => {
      await seedAlerts(page, [ALERT])
      await seedOverlay(page, { state, register: 'out-of-fiction', message: '' })
      await page.goto('/home')
      const card = page.getByTestId('pulse-overlay-card')
      await expect(card).toBeVisible()
      await expectBetweenBanners(page, await boxOf(card), `${state} card`)
    })
  }
})
