/**
 * e2e/kit/layout.spec.ts
 * ---------------------------------------------------------------------------
 * Fixture proof for `expectTouchTarget` (kit, mobile-tablet story 04): the probe
 * snaps to device pixels, so a genuine 44px control at a fractional offset passes
 * while a 43px one still fails. Pure fixtures, no app.
 */
import { test, expect, type Page } from '@playwright/test'
import { expectTouchTarget } from './layout'

async function circle(page: Page, size: number): Promise<void> {
  await page.setContent(`<body style="margin:0"><button id="c" style="position:absolute;
    top:100.4px;left:50.3px;width:${size}px;height:${size}px;border-radius:999px;padding:0;
    border:0;background:#333"></button></body>`)
}

test.describe('expectTouchTarget', () => {
  test('a 44px circle at a fractional offset passes', async ({ page }) => {
    await circle(page, 44)
    await expectTouchTarget(page.locator('#c'), 44)
  })

  test('a 43px circle fails', async ({ page }) => {
    await circle(page, 43)
    await expect(expectTouchTarget(page.locator('#c'), 44)).rejects.toThrow(/not a 44px touch target/)
  })
})
