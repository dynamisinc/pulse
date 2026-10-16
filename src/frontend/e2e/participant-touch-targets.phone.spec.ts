/**
 * e2e/participant-touch-targets.phone.spec.ts
 * ---------------------------------------------------------------------------
 * Participant touch targets on a COARSE pointer at 360 / 390 / 768 (mobile-tablet
 * story 18; NFR-001, WCAG 2.5.8, D0 4.6). One run per Playwright project (= viewport),
 * against the frontend mock seams, no backend.
 *
 * Per screen x viewport, each control below must be a >= 44px target (`expectTouchTarget`
 * hit-tests a 44x44 square around it, so a 43px control FAILS) and its measured box must be
 * >= 44 x 44 (real layout space, not an invisible slop that neighbours could intercept):
 *   - post action row (Reply, Repost, Like, Pin) on feed, thread, profile, hashtag, Pinned;
 *   - composer modal: Add photos/video, Add emoji, Post;
 *   - thread reply composer: Add photos/video, Add emoji, Reply;
 *   - DetailHeader Back (thread, profile, hashtag);
 *   - profile Followers button.
 * Adjacent action-row targets must not overlap, nothing scrolls sideways at 360, and the
 * composer toolbar stays inside the viewport.
 *
 * EXEMPTIONS (not asserted here, by design):
 *   - inline text links in running prose (author names, hashtags, "Sign in here.")  WCAG 2.5.8
 *     inline exception;
 *   - media viewer controls (story 04), alert bar (story 05), channel nav and bottom tab bar
 *     (story 17 / 02, asserted in their own specs);
 *   - the participant Sign out control (story 02, asserted in participant-screens);
 *   - the profile "Following" count, which is plain text and not a control;
 *   - read-only/inert action counts (not interactive).
 *
 * Focus ring (NFR-001): the focus-visible outline is unchanged by this story; the targets
 * grow as real layout space, so no clip container can hide it (asserted for Back / Post).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { boxOf, boxesOverlap, expectNoHorizontalScroll, expectTouchTarget } from './kit'

const THREAD_URL = '/i/status/post-fx-thread-root'
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) <= 599

/** A control is a >= 44px target by hit test AND by its real box. */
async function expectTarget(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} is not rendered`).toBeVisible()
  // Centre it: a fixed bottom tab bar would otherwise cover a control scrolled to the edge.
  await locator.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await expectTouchTarget(locator, 44)
  const box = await boxOf(locator)
  expect(box.width, `${what} is ${Math.round(box.width)}px wide`).toBeGreaterThanOrEqual(44)
  expect(box.height, `${what} is ${Math.round(box.height)}px tall`).toBeGreaterThanOrEqual(44)
}

/** The four action-row targets of one card, each 44px, none overlapping its neighbour. */
async function expectActionRow(card: Locator, what: string): Promise<void> {
  const row = card.getByTestId('post-actions').first()
  const buttons = [
    row.getByRole('button', { name: /^Reply/ }),
    row.getByRole('button', { name: /^Repost/ }),
    row.getByRole('button', { name: /^Like/ }),
    row.getByRole('button', { name: /^Pin/ }),
  ]
  const boxes = []
  for (const [i, b] of buttons.entries()) {
    await expectTarget(b, `${what} action ${['Reply', 'Repost', 'Like', 'Pin'][i]}`)
    boxes.push(await boxOf(b))
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      expect(boxesOverlap(a, b), `${what}: adjacent action targets overlap`).toBe(false)
    }
  }
}

async function expectComposerTools(scope: Locator, submit: string, what: string): Promise<void> {
  await expectTarget(scope.getByRole('button', { name: /^Add photos/ }), `${what} Add photos/video`)
  await expectTarget(scope.getByRole('button', { name: /^Add emoji/ }), `${what} Add emoji`)
  await expectTarget(scope.getByRole('button', { name: submit, exact: true }), `${what} ${submit}`)
}

async function expectBackFocusRing(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: /^Back/ }).first()
  await back.focus()
  const outline = await back.evaluate(el => getComputedStyle(el).outlineStyle)
  expect(outline, 'Back focus ring missing').not.toBe('none')
}

test.describe('participant touch targets (coarse pointer)', () => {
  test('feed: every card action row', async ({ page }) => {
    await page.goto('/home')
    const cards = page.getByTestId('social-feed-region').getByRole('article')
    await expect(cards.first()).toBeVisible()
    await expectActionRow(cards.first(), 'feed card 1')
    await expectActionRow(cards.nth(1), 'feed card 2')
    await expectNoHorizontalScroll(page)
  })

  test('thread: focused post action row, Back, reply composer', async ({ page }) => {
    await page.goto(THREAD_URL)
    const focused = page.getByTestId('thread-focused')
    await expect(focused).toBeVisible()
    await expectActionRow(focused, 'thread focused post')
    await expectTarget(page.getByRole('button', { name: /^Back/ }).first(), 'thread Back')
    await expectBackFocusRing(page)
    await page.getByRole('textbox', { name: /reply/i }).fill('On my way.')
    const composer = page.getByRole('textbox', { name: /reply/i }).locator('xpath=ancestor::*[contains(@class,"composer")][1]')
    await expectComposerTools(composer, 'Reply', 'reply composer')
    await expectNoHorizontalScroll(page)
  })

  test('thread: the enlarged focused post stays clear of the first reply (SG-005)', async ({ page }) => {
    await page.goto(THREAD_URL)
    const focused = page.getByTestId('thread-focused')
    await expect(focused.locator('img').first()).toBeVisible()
    // The transform does not take layout space, so the VISUAL bottom (getBoundingClientRect)
    // must still sit above the next sibling's top.
    const gap = await focused.evaluate(el => {
      const next = el.nextElementSibling
      return next ? next.getBoundingClientRect().top - el.getBoundingClientRect().bottom : 999
    })
    expect(gap, 'focused post touches the content below it').toBeGreaterThanOrEqual(12)
  })

  test('composer modal: Add photos/video, Add emoji, Post, no overflow', async ({ page }) => {
    await page.goto('/home')
    const open = isPhone(page) ? page.getByTestId('tab-post') : page.getByTestId('nav-post-button')
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('Water station on Elm St. is open.')
    await expectComposerTools(dialog, 'Post', 'composer')
    const vp = page.viewportSize()
    for (const name of [/^Add photos/, /^Add emoji/]) {
      const box = await boxOf(dialog.getByRole('button', { name }))
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(vp?.width ?? 0)
    }
    const post = dialog.getByRole('button', { name: 'Post', exact: true })
    const postBox = await boxOf(post)
    expect(postBox.x + postBox.width, 'Post overflows the viewport').toBeLessThanOrEqual(vp?.width ?? 0)
    await dialog.getByRole('textbox').focus()
    for (let i = 0; i < 10 && !(await post.evaluate(el => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab')
    }
    await expect(post).toBeFocused()
    expect(await post.evaluate(el => getComputedStyle(el).outlineStyle), 'Post focus ring missing')
      .not.toBe('none')
    await expectNoHorizontalScroll(page)
  })

  test('profile: action rows, Back, Followers', async ({ page }) => {
    await page.goto('/dreyes_fh')
    await expect(page.getByRole('heading', { name: 'Dana Reyes' }).first()).toBeVisible()
    await expectTarget(page.getByRole('button', { name: /^Back/ }).first(), 'profile Back')
    const followers = page.getByTestId('follower-count')
    await expectTarget(followers, 'profile Followers')
    await expectActionRow(page.getByRole('article').first(), 'profile card')
    await expectNoHorizontalScroll(page)
  })

  test('hashtag feed: action rows and Back', async ({ page }) => {
    await page.goto('/hashtag/WaterIssues')
    const card = page.getByRole('article').first()
    await expect(card).toBeVisible()
    await expectTarget(page.getByRole('button', { name: /^Back/ }).first(), 'hashtag Back')
    await expectActionRow(card, 'hashtag card')
    await expectNoHorizontalScroll(page)
  })

  test('Pinned tab: action row of a pinned card', async ({ page }) => {
    await page.goto('/home')
    const cards = page.getByTestId('social-feed-region').getByRole('article')
    await expect(cards.first()).toBeVisible()
    await cards.first().getByTestId('post-actions').getByRole('button', { name: /^Pin/ }).click()
    await page.getByRole('tab', { name: 'Pinned' }).click()
    const pinned = page.getByRole('article').first()
    await expect(pinned).toBeVisible()
    await expectActionRow(pinned, 'pinned card')
    await expectNoHorizontalScroll(page)
  })
})
