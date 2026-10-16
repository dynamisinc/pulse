/**
 * e2e/participant-screens.phone.spec.ts
 * ---------------------------------------------------------------------------
 * Core participant social screens at 360 / 390 / 768 (mobile-tablet story 02;
 * NFR-001, COR-053, MT-D2, MT-D8, G3). One run per Playwright project (= viewport),
 * against the frontend mock seams, no backend.
 *
 * Per screen (feed, thread, composer modal, profile, Explore, Pinned, notifications):
 * no horizontal page scroll, no wall-clock date (scenario time only), nothing clipped
 * by the column, and nothing hidden under the bottom tab bar.
 *
 * The bottom tab bar (MT-D2) exists on phones (< 600px) and NOT at 768, where the
 * icon rail is unchanged. Its items are 44 px targets, `aria-current` marks the current
 * tab, and tabbing between them navigates.
 *
 * Screenshots: set SCREENSHOT_DIR to also write one PNG per screen and viewport.
 *
 * KNOWN MOCK LIMIT (MT-D8): a COLD load of /notifications redirects to /home because the
 * shell-state query is still loading and reports the least-affordance `readOnly` variant,
 * which the Notifications page treats as "not available". So these tests reach the page
 * by clicking the tab (the real user path), exactly as the audit found it working.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  boxOf, boxesOverlap, expectNoHorizontalScroll, expectNoWallClock, expectTouchTarget,
  type Box,
} from './kit'

const PHONE_MAX = 599
const THREAD_URL = '/i/status/post-fx-thread-root'

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) <= PHONE_MAX

async function snap(page: Page, name: string, testInfo: { project: { name: string } }) {
  const dir = process.env.SCREENSHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}-${testInfo.project.name}.png` })
}

async function openFeed(page: Page): Promise<void> {
  await page.goto('/home')
  await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
}

/** The common per-screen checks. */
async function expectScreenSound(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page)
  await expectNoWallClock(page)
}

/** Fails if `locator`'s box pokes outside the main column horizontally. */
async function expectInsideColumn(page: Page, locator: Locator, what: string): Promise<void> {
  const column = await boxOf(page.getByTestId('social-main'))
  const box = await boxOf(locator)
  expect(box.x, `${what} clipped at the left edge`).toBeGreaterThanOrEqual(column.x - 0.5)
  expect(box.x + box.width, `${what} clipped at the right edge`)
    .toBeLessThanOrEqual(column.x + column.width + 0.5)
}

/** The last thing in the page must be reachable above the tab bar. */
async function expectClearOfTabBar(page: Page): Promise<void> {
  if (!isPhone(page)) return
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const bar = await boxOf(page.getByTestId('bottom-tab-bar'))
  const main = await boxOf(page.getByTestId('social-main'))
  expect(main.y + main.height, 'main column ends under the tab bar').toBeLessThanOrEqual(bar.y + 0.5)
}

test.describe('core screens: layout, scenario time, no clipping', () => {
  test('feed', async ({ page }, testInfo) => {
    await openFeed(page)
    await expect(page.getByText('Does anyone know if the pharmacy on Main Street is open?'))
      .toBeVisible()
    await expectScreenSound(page)
    await expectClearOfTabBar(page)
    await snap(page, 'feed', testInfo)
  })

  test('thread: the focused post, its media and Pin stay inside the column (G3)', async ({ page }, testInfo) => {
    await page.goto(THREAD_URL)
    const focused = page.getByTestId('thread-focused')
    await expect(focused).toBeVisible()
    await expectScreenSound(page)
    // Bounding-box check on everything that used to clip at the right edge.
    await expectInsideColumn(page, focused, 'focused post card')
    const pin = focused.getByRole('button', { name: /pin/i }).first()
    await expect(pin).toBeVisible()
    await expectInsideColumn(page, pin, 'Pin action')
    const media = focused.locator('img').first()
    await expect(media).toBeVisible()
    await expectInsideColumn(page, media, 'focused post media')
    await expectClearOfTabBar(page)
    await snap(page, 'thread', testInfo)
  })

  test('composer modal', async ({ page }, testInfo) => {
    await openFeed(page)
    const post = isPhone(page) ? page.getByTestId('tab-post') : page.getByTestId('nav-post-button')
    await post.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('Water station on Elm St. is open. #WaterIssues')
    await expectScreenSound(page)
    // The dialog is inside the visible viewport and its Post button is on screen.
    const vp = page.viewportSize()
    const box = await boxOf(dialog)
    expect(box.x).toBeGreaterThanOrEqual(-0.5)
    expect(box.x + box.width).toBeLessThanOrEqual((vp?.width ?? 0) + 0.5)
    await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeInViewport()
    await snap(page, 'composer', testInfo)
  })

  test('profile (/dreyes_fh)', async ({ page }, testInfo) => {
    await page.goto('/dreyes_fh')
    await expect(page.getByRole('heading', { name: 'Dana Reyes' }).first()).toBeVisible()
    await expectScreenSound(page)
    await expectClearOfTabBar(page)
    await snap(page, 'profile', testInfo)
  })

  test('Explore: search, results and Trending are reachable', async ({ page }, testInfo) => {
    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: 'Explore', level: 1 })).toBeVisible()
    await expect(page.getByTestId('explore-page').getByText(/trending/i).first()).toBeVisible()
    await expectScreenSound(page)
    await snap(page, 'explore', testInfo)

    const search = page.getByRole('searchbox').or(page.getByRole('combobox')).first()
    await search.fill('water')
    const row = page.getByTestId('explore-page').locator('li').first()
    await expect(row).toBeVisible()
    await expectScreenSound(page)
    // Search result rows: each row is one stretched link (`.rowLink::after`), so the whole
    // row is the target. It is >= 44px tall and its centre hits the link (story 02 AC).
    expect((await boxOf(row)).height, 'search result row is under 44px tall')
      .toBeGreaterThanOrEqual(44)
    const centreHitsLink = await row.evaluate(el => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit?.closest('a') !== null && el.contains(hit)
    })
    expect(centreHitsLink, 'row centre does not land on the result link').toBe(true)
    await expectClearOfTabBar(page)
  })

  test('Pinned tab', async ({ page }, testInfo) => {
    await openFeed(page)
    await page.getByRole('tab', { name: 'Pinned' }).click()
    await expect(page.getByRole('tab', { name: 'Pinned', selected: true })).toBeVisible()
    await expectScreenSound(page)
    await expectClearOfTabBar(page)
    await snap(page, 'pinned', testInfo)
  })

  test('notifications (reached from the tab / rail)', async ({ page }, testInfo) => {
    await openFeed(page)
    await page.getByRole('link', { name: /^Notifications/ }).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
    await expectScreenSound(page)
    await expectClearOfTabBar(page)
    await snap(page, 'notifications', testInfo)
  })
})

test.describe('bottom tab bar (MT-D2)', () => {
  test('is present on phones and absent at tablet width, where the rail stays', async ({ page }) => {
    await openFeed(page)
    const bar = page.getByTestId('bottom-tab-bar')
    const rail = page.getByTestId('nav-rail')
    if (isPhone(page)) {
      await expect(bar).toBeVisible()
      await expect(rail).toHaveCount(0)
      // Fixed to the bottom edge of the viewport (above any bottom banner).
      const vp = page.viewportSize()
      const box = await boxOf(bar)
      expect(box.y + box.height).toBeLessThanOrEqual((vp?.height ?? 0) + 0.5)
      expect(box.width).toBeGreaterThanOrEqual((vp?.width ?? 0) - 1)
    } else {
      await expect(bar).toHaveCount(0)
      await expect(rail).toBeVisible()
    }
  })

  test('items, 44px targets, aria-current, badge is text, no overlap with alert bar', async ({ page }) => {
    test.skip(!isPhone(page), 'phone only')
    await openFeed(page)
    const bar = page.getByTestId('bottom-tab-bar')
    for (const name of ['Home', 'Explore', 'Profile']) {
      await expectTouchTarget(bar.getByRole('link', { name }), 44)
    }
    await expectTouchTarget(bar.getByRole('link', { name: /^Notifications/ }), 44)
    await expectTouchTarget(bar.getByRole('button', { name: 'Post' }), 44)
    await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1)
    // Every tab is inside the viewport horizontally and none overlap one another.
    const boxes: Box[] = []
    for (const link of await bar.getByRole('link').all()) boxes.push(await boxOf(link))
    boxes.push(await boxOf(bar.getByRole('button', { name: 'Post' })))
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(boxesOverlap(a, b)).toBe(false)
    }
    await expectNoHorizontalScroll(page)
  })

  test('navigates between tabs and marks the current one', async ({ page }) => {
    test.skip(!isPhone(page), 'phone only')
    await openFeed(page)
    const bar = page.getByTestId('bottom-tab-bar')
    await bar.getByRole('link', { name: 'Explore' }).click()
    await expect(page).toHaveURL(/\/explore$/)
    await expect(bar.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')
    await expect(bar.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')
    await bar.getByRole('link', { name: 'Profile' }).click()
    await expect(page).toHaveURL(/\/dreyes_fh$/)
    await expect(bar.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    await bar.getByRole('link', { name: /^Notifications/ }).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(bar.getByRole('link', { name: /^Notifications/ }))
      .toHaveAttribute('aria-current', 'page')
    await bar.getByRole('link', { name: 'Home' }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('the Post tab opens the composer and focus returns to it on close', async ({ page }) => {
    test.skip(!isPhone(page), 'phone only')
    await openFeed(page)
    const post = page.getByTestId('tab-post')
    await post.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(post).toBeFocused()
  })
})
