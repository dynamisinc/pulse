/**
 * e2e/participant-entry.phone.spec.ts
 * ---------------------------------------------------------------------------
 * Verified phone/tablet behavior of the participant ENTRY screens (mobile-tablet
 * story 03; NFR-001, COR-053, EL-7). Runs at every Playwright project: 360 / 390
 * phones and the 768 tablet.
 *
 * Covered:
 *  - join (/join/:token): the slow- token "Signing you in..." state, the generic
 *    failure (bad token) and the bare /join "no link" state; no horizontal scroll;
 *    the action is a >= 44px target; the token is in no visible text and not in
 *    the address bar;
 *  - sign-in (/login): no horizontal scroll, 44px controls (toggles, inputs,
 *    submit, staff link), the phone-keyboard input hints on the name and word
 *    fields, a visible error state with icon + text, submit reachable;
 *  - holding page: pause and EndEx overlays in both registers (and the Freeze
 *    path, which reuses the pause state) injected via the guide-shots `overlay`
 *    seam: message fully visible without page scroll, not covered by / not
 *    covering the compliance chrome, focus on the dialog, state carried by an
 *    icon + heading text, no wall-clock date.
 * The sign-out control's 44px target is mobile-tablet story 02, not asserted here.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  boxOf, boxesOverlap, expectNoHorizontalScroll, expectNoWallClock, expectTouchTarget,
  seedOverlay, signInAs,
} from './kit'

const SECRET_TOKEN = 'slow-e2e-secret-token-123'

test.describe('join page', () => {
  test('slow token: "Signing you in..." fits, the token is never visible', async ({ page }) => {
    await page.goto(`/join/${SECRET_TOKEN}`, { waitUntil: 'domcontentloaded' })
    const status = page.getByRole('status')
    await expect(status).toContainText('Signing you in')
    await expectNoHorizontalScroll(page)
    await expectNoWallClock(page)
    expect(await page.locator('body').innerText()).not.toContain(SECRET_TOKEN)
    expect(page.url()).not.toContain(SECRET_TOKEN)
  })

  test('bad token: one generic failure with icon + text and a 44px action', async ({ page }) => {
    await page.goto('/join/bad-e2e-token-456')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText("This link isn't working any more")
    await expect(alert.locator('svg')).toBeVisible()
    await expect(alert).toBeFocused()
    const action = page.getByRole('link', { name: /sign in/i }).first()
    await expectTouchTarget(action, 44)
    await expectNoHorizontalScroll(page)
    expect(await page.locator('body').innerText()).not.toContain('bad-e2e-token-456')
  })

  test('bare /join: guidance with a 44px Continue', async ({ page }) => {
    await page.goto('/join')
    await expect(page.getByRole('status')).toContainText('tap your link again')
    await expectTouchTarget(page.getByRole('link', { name: 'Continue' }), 44)
    await expectNoHorizontalScroll(page)
  })
})

test.describe('participant sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('no horizontal scroll; every control is a 44px target', async ({ page }) => {
    await expectNoHorizontalScroll(page)
    for (const name of ["Today's word", 'Password', 'View-only code']) {
      await expectTouchTarget(page.getByRole('button', { name, exact: true }), 44)
    }
    await expectTouchTarget(page.getByRole('textbox', { name: 'Sign-in name' }), 44)
    await expectTouchTarget(page.getByRole('textbox', { name: "Today's word" }), 44)
    await expectTouchTarget(page.getByRole('button', { name: 'Sign in', exact: true }), 44)
    await expectTouchTarget(page.getByRole('link', { name: 'Sign in here.' }), 44)
  })

  test('name and word fields carry phone-keyboard hints', async ({ page }) => {
    const name = page.getByRole('textbox', { name: 'Sign-in name' })
    const word = page.getByRole('textbox', { name: "Today's word" })
    for (const field of [name, word]) {
      await expect(field).toHaveAttribute('autocapitalize', 'none')
      await expect(field).toHaveAttribute('autocorrect', 'off')
      await expect(field).toHaveAttribute('inputmode', 'text')
      await expect(field).toHaveAttribute('spellcheck', 'false')
    }
    await expect(name).toHaveAttribute('autocomplete', 'username')
    await expect(name).toHaveAttribute('enterkeyhint', 'next')
    await expect(word).toHaveAttribute('autocomplete', 'off')
    await expect(word).toHaveAttribute('enterkeyhint', 'go')
  })

  test('the submit button is on screen once a field is focused', async ({ page }) => {
    await page.getByRole('textbox', { name: "Today's word" }).focus()
    const submit = page.getByRole('button', { name: 'Sign in', exact: true })
    const box = await boxOf(submit)
    const viewport = page.viewportSize()
    expect(box.y + box.height).toBeLessThanOrEqual((viewport?.height ?? 0) + 1)
    expect(box.y).toBeGreaterThanOrEqual(0)
  })

  test('a failed sign-in shows an icon + text error and no overflow', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Sign-in name' }).fill('someone-with-a-very-long-handle-xyz')
    await page.getByRole('textbox', { name: "Today's word" }).fill('nope')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText("wasn't recognized")
    await expect(alert.locator('svg')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})

interface OverlayCase {
  readonly label: string
  readonly state: 'pause' | 'endex'
  readonly register: 'in-fiction' | 'out-of-fiction'
  readonly testId: string
  readonly heading: string
}

const OVERLAYS: readonly OverlayCase[] = [
  { label: 'pause / in-fiction', state: 'pause', register: 'in-fiction', testId: 'pulse-overlay-pause-in-fiction', heading: "We'll be right back" },
  { label: 'pause (Freeze) / out-of-fiction', state: 'pause', register: 'out-of-fiction', testId: 'pulse-overlay-pause-out-of-fiction', heading: 'EXERCISE PAUSED' },
  { label: 'EndEx / in-fiction', state: 'endex', register: 'in-fiction', testId: 'pulse-overlay-endex-in-fiction', heading: 'This service is no longer available' },
  { label: 'EndEx / out-of-fiction', state: 'endex', register: 'out-of-fiction', testId: 'pulse-overlay-endex-out-of-fiction', heading: 'ENDEX' },
]

async function openOverlay(page: Page, c: OverlayCase): Promise<void> {
  await signInAs(page, 'participant')
  await seedOverlay(page, { state: c.state, register: c.register, message: '' })
  await page.goto('/home')
  await expect(page.getByTestId(c.testId)).toBeVisible()
}

test.describe('holding page overlays', () => {
  for (const c of OVERLAYS) {
    test(`${c.label}: readable, no scroll, chrome clear, focused, icon + text`, async ({ page }) => {
      await openOverlay(page, c)
      const dialog = page.getByTestId(c.testId)
      await expect(dialog.getByRole('heading', { name: c.heading })).toBeVisible()
      await expect(dialog).toBeFocused()

      // Fits without scrolling (page or the overlay itself).
      await expectNoHorizontalScroll(page)
      const fits = await dialog.evaluate(el => ({
        v: el.scrollHeight <= el.clientHeight, h: el.scrollWidth <= el.clientWidth,
      }))
      expect(fits).toEqual({ v: true, h: true })

      // The card sits between the compliance banners, not under them.
      const card = await boxOf(dialog.locator('h1'))
      for (const id of ['pulse-compliance-chrome-top', 'pulse-compliance-chrome-bottom']) {
        const chrome = page.getByTestId(id)
        await expect(chrome).toBeVisible()
        expect(boxesOverlap(card, await boxOf(chrome)), `${id} covers the message`).toBe(false)
        // ...and the chrome is on top of the overlay (not covered by it).
        const cb = await boxOf(chrome)
        const topmost = await page.evaluate(([x, y]) =>
          !!document.elementFromPoint(x as number, y as number)?.closest('[data-testid^="pulse-compliance-chrome"]'),
        [cb.x + cb.width / 2, cb.y + cb.height / 2])
        expect(topmost, `${id} is covered by the overlay`).toBe(true)
      }

      // State is carried by an icon as well as text (never colour alone).
      await expect(dialog.locator('svg')).toHaveCount(1)
      await expectNoWallClock(page)
    })
  }

  test('focus stays trapped on the overlay when Tab is pressed', async ({ page }) => {
    const first = OVERLAYS[0] as OverlayCase
    await openOverlay(page, first)
    const dialog = page.getByTestId(first.testId)
    await page.keyboard.press('Tab')
    await expect(dialog).toBeFocused()
  })
})
