/**
 * e2e/media-viewer.phone.spec.ts
 * ---------------------------------------------------------------------------
 * Media grid, full-screen viewer, video controls and composer attach preview on
 * phones and the tablet (mobile-tablet story 04; NFR-001, NFR-008, NFR-004,
 * COR-053). Runs at 360 / 390 / 768 against the frontend mock seams (no backend).
 *
 * Covered:
 *  - every post media grid (1-4 images) stays inside the viewport, tiles keep an
 *    aspect (no collapse) and are >= 44x44 tap targets;
 *  - the viewer fills the viewport, Close / Previous / Next are >= 44px and fully
 *    on screen, Escape closes and focus returns to the opener tile; the viewer is
 *    a labelled modal dialog and the page's viewport meta does not disable zoom;
 *  - the EXERCISE bands are visible and inside the picture in the grid, the viewer
 *    (portrait AND landscape) and the composer preview;
 *  - video: nothing auto-plays, Mute / Expand / Play are >= 44px;
 *  - the composer attach preview: Remove is a 44px target; a disallowed file type
 *    still shows the existing validation error (no new upload path);
 *  - scenario time only: no real wall-clock date anywhere.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { boxOf, boxesOverlap, expectNoHorizontalScroll, expectNoWallClock, expectTouchTarget } from './kit'

async function openFeed(page: Page): Promise<void> {
  await page.goto('/home')
  await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
  await expect(page.getByTestId('media-grid').first()).toBeVisible()
}

/** The first grid in the feed that holds `count` images. */
function gridWith(page: Page, count: number): Locator {
  return page.locator(`[data-testid="media-grid"][data-count="${count}"]`).first()
}

/** The EXERCISE bands sit inside `host` and are rendered (not clipped to nothing). */
async function expectBandsInside(host: Locator): Promise<void> {
  const bands = host.getByTestId('exercise-bands').first()
  await expect(bands).toBeVisible()
  const h = await boxOf(host)
  for (const id of ['exercise-band-top', 'exercise-band-bottom']) {
    const band = bands.getByTestId(id)
    await expect(band).toBeVisible()
    const b = await boxOf(band)
    expect(b.height, `${id} collapsed`).toBeGreaterThan(4)
    expect(b.x, `${id} left edge cropped`).toBeGreaterThanOrEqual(h.x - 0.5)
    expect(b.x + b.width, `${id} right edge cropped`).toBeLessThanOrEqual(h.x + h.width + 0.5)
    expect(b.y, `${id} top cropped`).toBeGreaterThanOrEqual(h.y - 0.5)
    expect(b.y + b.height, `${id} bottom cropped`).toBeLessThanOrEqual(h.y + h.height + 0.5)
  }
}

test.describe('media grid', () => {
  for (const count of [1, 2, 3, 4]) {
    test(`${count} image(s): no overflow, 44px tiles, bands visible, alt present`, async ({ page }) => {
      await openFeed(page)
      const grid = gridWith(page, count)
      await grid.scrollIntoViewIfNeeded()
      const vw = page.viewportSize()?.width ?? 0
      const g = await boxOf(grid)
      expect(g.x).toBeGreaterThanOrEqual(0)
      expect(g.x + g.width, 'grid overflows the viewport').toBeLessThanOrEqual(vw)
      const tiles = grid.getByTestId('media-tile')
      await expect(tiles).toHaveCount(count)
      for (let i = 0; i < count; i++) {
        const tile = tiles.nth(i)
        const t = await boxOf(tile)
        expect(t.width, `tile ${i} width`).toBeGreaterThanOrEqual(44)
        expect(t.height, `tile ${i} height`).toBeGreaterThanOrEqual(44)
        await expect(tile.locator('img')).toHaveAttribute('alt', /\S/)
      }
      await expectTouchTarget(tiles.first(), 44)
      await expectBandsInside(tiles.first())
      await expectNoHorizontalScroll(page)
      await expectNoWallClock(page)
    })
  }
})

test.describe('media viewer', () => {
  test('opens full-bleed, controls are 44px and on screen, Escape returns focus', async ({ page }) => {
    await openFeed(page)
    const grid = gridWith(page, 3)
    const opener = grid.getByTestId('media-tile').nth(1)
    await opener.scrollIntoViewIfNeeded()
    await opener.click()

    const viewer = page.getByTestId('media-viewer')
    await expect(viewer).toBeVisible()
    await expect(viewer).toHaveAttribute('role', 'dialog')
    await expect(viewer).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByTestId('media-viewer-status')).toContainText(/Image 2 of 3: \S/)

    const vp = page.viewportSize() ?? { width: 0, height: 0 }
    const v = await boxOf(viewer)
    expect(v.width).toBeGreaterThanOrEqual(vp.width - 1)

    for (const id of ['media-viewer-close', 'media-viewer-prev', 'media-viewer-next']) {
      const control = page.getByTestId(id)
      await expectTouchTarget(control, 44)
      const c = await boxOf(control)
      expect(c.x, `${id} off the left edge`).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width, `${id} off the right edge`).toBeLessThanOrEqual(vp.width)
      expect(c.y + c.height, `${id} off the bottom`).toBeLessThanOrEqual(vp.height)
      expect(c.y, `${id} off the top`).toBeGreaterThanOrEqual(0)
    }

    // The picture and its EXERCISE bands are on screen and uncropped.
    const frame = page.getByTestId('media-viewer-image-frame')
    const f = await boxOf(frame)
    expect(f.x).toBeGreaterThanOrEqual(0)
    expect(f.x + f.width).toBeLessThanOrEqual(vp.width)
    await expectBandsInside(frame)

    // Paging announces the next item.
    await page.getByTestId('media-viewer-next').click()
    await expect(page.getByTestId('media-viewer-status')).toContainText(/Image 3 of 3: \S/)

    // Focus is trapped inside the dialog.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="media-viewer"]')))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    await expect(opener).toBeFocused()
    await expectNoWallClock(page)
  })

  test('Back closes the viewer, stays on /home, focus returns to the tile', async ({ page }) => {
    await openFeed(page)
    const opener = gridWith(page, 2).getByTestId('media-tile').first()
    await opener.scrollIntoViewIfNeeded()
    await opener.click()
    await expect(page.getByTestId('media-viewer')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('media-viewer')).toBeHidden()
    await expect(page).toHaveURL(/\/home$/)
    await expect(opener).toBeFocused()

    // Close pops its own entry: a following Back leaves the page's own history alone
    // (about:blank / previous), it must not re-open or close anything else.
    await opener.click()
    await expect(page.getByTestId('media-viewer')).toBeVisible()
    await page.getByTestId('media-viewer-close').click()
    await expect(page.getByTestId('media-viewer')).toBeHidden()
    await expect(page).toHaveURL(/\/home$/)
    await expect(opener).toBeFocused()
  })

  test('landscape: controls stay on screen and the bands stay visible', async ({ page }) => {
    await openFeed(page)
    const opener = gridWith(page, 2).getByTestId('media-tile').first()
    await opener.scrollIntoViewIfNeeded()
    await opener.click()
    await expect(page.getByTestId('media-viewer')).toBeVisible()

    const vp = page.viewportSize() ?? { width: 0, height: 0 }
    await page.setViewportSize({ width: vp.height, height: vp.width })
    const lw = vp.height
    const lh = vp.width
    for (const id of ['media-viewer-close', 'media-viewer-prev', 'media-viewer-next']) {
      const control = page.getByTestId(id)
      await expectTouchTarget(control, 44)
      const c = await boxOf(control)
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width).toBeLessThanOrEqual(lw)
      expect(c.y + c.height, `${id} below the fold in landscape`).toBeLessThanOrEqual(lh)
    }
    const frame = page.getByTestId('media-viewer-image-frame')
    const f = await boxOf(frame)
    expect(f.height, 'picture collapsed in landscape').toBeGreaterThan(40)
    expect(f.y + f.height).toBeLessThanOrEqual(lh)
    await expectBandsInside(frame)
    await page.getByTestId('media-viewer-close').click()
    await expect(page.getByTestId('media-viewer')).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('the page does not disable pinch-zoom', async ({ page }) => {
    await openFeed(page)
    const content = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(content ?? '').not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0+)?(?![\d.])/i)
  })
})

/**
 * A 1 s, 64x36 VP8 clip. The bundled Chromium has no H.264, so the mock .mp4 would render
 * the "can't be played" state and hide the controls under test; serving a decodable
 * clip for the same URL exercises the real player (Chromium sniffs the container).
 */
const TINY_WEBM_BASE64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJGEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIw7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYh8jrBcUgwve5yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBQLqBJJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYh8jrBcUgwve2fIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAi+eBAKOmgQAAgLACAJ0BKkAAJAAARwiFhYiFhIgCAgAGjmITZ5mPLwD+aACjloEAyADRAQABEBAAGAAYWC/0AAiMAACjloEBkADRAQABEBAAGAAYWC/0AAiMAACjloECWADRAQABEBAAGAAYWC/0AAiMAACjloEDIADRAQABEBAAGAAYWC/0AAiMAAAcU7trkbuPs4EAt4r3gQHxggGf8IED'

test.describe('video', () => {
  test('does not auto-play and its controls are 44px', async ({ page }) => {
    await page.route('**/mock-media/video/water-update.mp4', route => route.fulfill({
      status: 200,
      contentType: 'video/webm',
      body: Buffer.from(TINY_WEBM_BASE64, 'base64'),
    }))
    await openFeed(page)
    const player = page.getByTestId('video-player').first()
    await player.scrollIntoViewIfNeeded()
    await expect(player).toBeVisible()
    await expect(player.locator('video')).toHaveCount(1)
    const state = await player.locator('video').evaluate((v: HTMLVideoElement) => ({
      paused: v.paused, autoplay: v.autoplay,
    }))
    expect(state).toEqual({ paused: true, autoplay: false })
    // Still not started a moment later (no deferred auto-start, with or without sound).
    await page.waitForTimeout(300)
    expect(await player.locator('video').evaluate((v: HTMLVideoElement) => v.paused || v.muted))
      .toBe(true)
    for (const id of ['video-mute-toggle', 'video-expand', 'video-play-toggle']) {
      const control = player.getByTestId(id)
      await expect(control).toBeVisible()
      await expectTouchTarget(control, 44)
    }
    const p = await boxOf(player)
    expect(p.x + p.width, 'player overflows').toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
    await expectBandsInside(player)
  })
})

test.describe('composer attach preview', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  async function openComposer(page: Page): Promise<Locator> {
    await page.goto('/home')
    await page.getByRole('button', { name: 'Post', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    return dialog
  }

  test('Remove is a 44px target inside the card; bands on the thumbnail', async ({ page }) => {
    const dialog = await openComposer(page)
    await dialog.getByTestId('composer-file-input').setInputFiles({
      name: 'flood.png', mimeType: 'image/png', buffer: PNG,
    })
    const card = dialog.getByTestId('composer-attachment')
    await expect(card).toBeVisible()
    await expect(card.getByText('Uploaded')).toBeVisible()
    const remove = card.getByRole('button', { name: /^(Remove|Cancel upload of) flood\.png/ })
    await expectTouchTarget(remove, 44)
    const c = await boxOf(card)
    const r = await boxOf(remove)
    expect(r.y).toBeGreaterThanOrEqual(c.y - 0.5)
    expect(r.y + r.height).toBeLessThanOrEqual(c.y + c.height + 0.5)
    expect(r.x).toBeGreaterThanOrEqual(c.x - 0.5)
    expect(r.x + r.width).toBeLessThanOrEqual(c.x + c.width + 0.5)
    // It never sits on top of the alt-text field.
    const alt = await boxOf(card.getByRole('textbox'))
    expect(boxesOverlap(r, alt), 'Remove overlaps the alt-text field').toBe(false)
    await expect(card.getByTestId('exercise-bands')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('a disallowed file type still shows the existing validation error', async ({ page }) => {
    const dialog = await openComposer(page)
    await dialog.getByTestId('composer-file-input').setInputFiles({
      name: 'notes.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ'),
    })
    await expect(dialog.getByRole('alert').first()).toBeVisible()
    await expect(dialog.getByTestId('composer-attachment')).toHaveCount(0)
  })
})
