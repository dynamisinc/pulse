import { test } from '@playwright/test'
test('explore', async ({ page }) => {
  await page.goto('/join/abc-token')
  await page.waitForTimeout(3000)
  console.log('URL', page.url())
  console.log((await page.locator('body').innerText()).slice(0, 1500))
  await page.screenshot({ path: '/tmp/claude-0/-home-user-pulse/05010b10-4218-5429-9c43-7801e3f1ccb8/scratchpad/a.png' })
})
