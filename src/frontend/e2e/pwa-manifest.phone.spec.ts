/**
 * e2e/pwa-manifest.phone.spec.ts — PWA brand manifest once wired (mobile-tablet 09).
 * ---------------------------------------------------------------------------
 * MT-D4: the app is installable only after sign-in. On the participant feed
 * (mock session, brand resolved) the head carries a Blob-URL web manifest whose
 * name/short_name are the exercise brand, never "Pulse" or "Dynamis"
 * (fiction, D0). On /login there is no manifest at all.
 *
 * The service worker registers in production builds only, so it is not
 * exercised here (dev server); its logic is unit-tested in features/pwa.
 */
import { test, expect, type Page } from '@playwright/test'

interface ManifestShape { name?: string, short_name?: string, display?: string, id?: string }

async function readManifest(page: Page): Promise<ManifestShape | null> {
  return page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) return null
    const res = await fetch(link.href)
    return (await res.json()) as ManifestShape
  })
}

test('the signed-in participant feed offers a brand manifest with no Pulse/Dynamis leak', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
  await expect.poll(() => page.locator('link[rel="manifest"]').count()).toBe(1)
  const manifest = await readManifest(page)
  expect(manifest).not.toBeNull()
  expect(manifest?.display).toBe('standalone')
  expect(manifest?.name).toBeTruthy()
  for (const field of [manifest?.name, manifest?.short_name]) {
    expect(field ?? '').not.toMatch(/pulse|dynamis/i)
  }
  expect(await page.title()).not.toMatch(/pulse|dynamis/i)
  expect(manifest?.id ?? '').toContain('pwa=')
})

test('the sign-in page offers no manifest (installable only after sign-in, MT-D4)', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('textbox', { name: 'Sign-in name' })).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
})
