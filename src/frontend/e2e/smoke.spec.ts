/**
 * e2e/smoke.spec.ts
 * ---------------------------------------------------------------------------
 * Harness smoke + role-seam isolation (mobile-tablet story 01; XC-001).
 *
 *  - the app boots against the mock seams with no backend;
 *  - a PARTICIPANT session asking for /staff/console never sees staff content
 *    (it stays in the participant world), proving the role seam does not leak;
 *  - the same seam with the `controller` role does reach the staff console
 *    (so the guard above is meaningful, not a dead route).
 */
import { test, expect } from '@playwright/test'
import { expectNoHorizontalScroll, signInAs } from './kit'

test('boots on the mock participant session and shows the feed', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('a participant cannot load /staff/console content', async ({ page }) => {
  await signInAs(page, 'participant')
  await page.goto('/staff/console')
  // Staff console chrome and the controller launcher never render for a participant.
  await expect(page.getByText(/run sheet|inject|controller console/i)).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Channel navigation' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/staff\/console/)
})

test('the controller role seam reaches the staff console', async ({ page }) => {
  await signInAs(page, 'controller')
  await page.goto('/staff/console')
  await expect(page).toHaveURL(/\/staff\/console/)
  await expect(page.getByRole('navigation', { name: 'Channel navigation' })).toHaveCount(0)
})
