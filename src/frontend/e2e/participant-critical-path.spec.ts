/**
 * e2e/participant-critical-path.spec.ts
 * ---------------------------------------------------------------------------
 * Participant critical path at 360 / 390 / 768 (mobile-tablet story 06;
 * XC-004, NFR-001, XC-001, COR-053). Runs once per Playwright project
 * (= viewport), against the frontend mock seams, no backend.
 *
 *   join link -> Social feed -> compose + post -> open thread -> reply
 *
 * Every step asserts what the participant SEES (role / label / text), that the
 * page never scrolls sideways, and that the primary actions are 44 px targets.
 * Telemetry (XC-004) is observed on the wire: the mock sink fires a
 * best-effort `POST /api/telemetry` per event, which we capture (no internals).
 *
 * KNOWN MOCK LIMITS (stated, not faked):
 *  - The join token is a mock-prefix token (`demo-...` signs in as Dana Reyes).
 *  - The mock installs no real exercise clock, so a fresh post is stamped
 *    "just now" and the telemetry `scenarioTime` equals the wall time; we assert
 *    the shape of both, not a 2033 scenario date. Pre-seeded posts DO show 2033.
 *  - There is no multi-exercise mock data, so cross-exercise isolation is
 *    exercised with an unknown thread id: the thread must fail closed.
 */
import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoWallClock, expectTouchTarget } from './kit'

const POST_TEXT = 'Water station on Elm St. is moving fast now. #WaterIssues'
const REPLY_TEXT = 'Thanks, heading there now.'

interface TelemetryEvent {
  eventType: string
  channel: string
  wallClockTime: string
  scenarioTime: string
  timeZone: string
  actor: { kind: string, personaId?: string, actingHumanId?: string, participantId?: string }
  origin?: string
  target?: { entityType: string, entityId: string }
}

/** Collect telemetry events the app posts, in order. */
function captureTelemetry(page: Page): TelemetryEvent[] {
  const events: TelemetryEvent[] = []
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/telemetry') {
      events.push(JSON.parse(req.postData() ?? '{}') as TelemetryEvent)
    }
  })
  return events
}

async function joinAndLand(page: Page): Promise<void> {
  await page.goto('/join/demo-e2e-token')
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
}

test.describe('participant critical path', () => {
  test('join link signs in and lands on the Social feed', async ({ page }) => {
    await joinAndLand(page)
    await expect(page.getByText('Does anyone know if the pharmacy on Main Street is open?'))
      .toBeVisible()
    // Pre-seeded posts carry scenario time (2033), never today's wall-clock date.
    await expect(page.getByText(/Sep 4, 2033/).first()).toBeVisible()
    await expectNoWallClock(page)
    await expectNoHorizontalScroll(page)
  })

  test('day-word sign-in lands on the Social feed', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('textbox', { name: 'Sign-in name' }).fill('dreyes')
    await page.getByRole('textbox', { name: "Today's word" }).fill('demo-word')
    await expectNoHorizontalScroll(page)
    await page.getByRole('button', { name: /^sign in/i }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('compose, post, open the thread and reply', async ({ page }) => {
    const telemetry = captureTelemetry(page)
    await joinAndLand(page)

    // --- Compose and post -------------------------------------------------
    const openComposer = page.getByRole('button', { name: 'Post', exact: true }).first()
    await expectTouchTarget(openComposer, 44)
    await openComposer.click()
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Post text' }).fill(POST_TEXT)
    const submit = dialog.getByRole('button', { name: 'Post', exact: true })
    await expectNoHorizontalScroll(page)
    await submit.click()

    await expect(dialog).toBeHidden()
    const feed = page.getByTestId('social-feed-region')
    const newest = feed.getByRole('article').first()
    await expect(newest).toContainText(POST_TEXT)
    await expect(newest).toContainText('Dana Reyes')
    await expect(newest).toContainText('@dreyes_fh')
    await expect(newest.getByRole('link').or(newest.getByText(/just now|2033/)).first())
      .toBeVisible()
    await expectNoWallClock(page)
    await expectNoHorizontalScroll(page)

    // --- Open the thread --------------------------------------------------
    await newest.getByRole('button', { name: /^Open post by Dana Reyes/ }).click()
    await expect(page).toHaveURL(/\/i\/status\/post-/)
    const focused = page.getByTestId('thread-focused')
    await expect(focused).toContainText(POST_TEXT)
    await expectNoHorizontalScroll(page)

    // --- Reply ------------------------------------------------------------
    const replyBox = page.getByRole('textbox', { name: /reply/i })
    await replyBox.fill(REPLY_TEXT)
    const send = page.getByRole('button', { name: 'Reply', exact: true })
    await send.click()
    await expect(page.getByText('Reply published.')).toBeVisible()
    await expect(page.getByText(REPLY_TEXT)).toBeVisible()
    // The parent's reply count went 0 -> 1 (its Reply action announces the count).
    await expect(page.getByRole('button', { name: 'Reply, 1', exact: true }).first())
      .toBeVisible()
    await expectNoHorizontalScroll(page)

    // --- Telemetry (XC-004) ----------------------------------------------
    for (const type of ['post', 'reply']) {
      const ev = telemetry.find(e => e.eventType === type)
      expect(ev, `a "${type}" telemetry event was emitted`).toBeDefined()
      if (!ev) continue
      expect(ev.channel).toBe('social')
      expect(ev.wallClockTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(ev.scenarioTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(ev.timeZone).toBeTruthy()
      // Actor = the persona AND the human behind the shared org account.
      expect(ev.actor).toMatchObject({ kind: 'persona', personaId: 'persona-dreyes_fh' })
      expect(ev.actor.actingHumanId).toBeTruthy()
      expect(ev.origin).toBe('participant')
      expect(ev.target?.entityId).toMatch(/^post-/)
    }
  })

  // The composer's Post button measures 71x34 and Reply is expected to be similar:
  // below the 44 px floor (NFR-001). Owned by mobile-tablet story 18 (Composer /
  // ReplyComposer). `test.fail` keeps the gap visible and turns RED the moment
  // it is fixed, so the annotation must then be removed.
  test('composer Post and thread Reply are 44px touch targets (story 18 gap)', async ({ page }) => {
    test.fail(true, 'story 18: Composer submit buttons are 71x34 CSS px')
    await joinAndLand(page)
    await page.getByRole('button', { name: 'Post', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await dialog.getByRole('textbox', { name: 'Post text' }).fill(POST_TEXT)
    await expectTouchTarget(dialog.getByRole('button', { name: 'Post', exact: true }), 44)
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()
    await page.getByTestId('social-feed-region').getByRole('article').first()
      .getByRole('button', { name: /^Open post by Dana Reyes/ }).click()
    await page.getByRole('textbox', { name: /reply/i }).fill(REPLY_TEXT)
    await expectTouchTarget(page.getByRole('button', { name: 'Reply', exact: true }), 44)
  })

  test('an unknown (other-exercise) thread fails closed with no content', async ({ page }) => {
    await joinAndLand(page)
    await page.goto('/i/status/post-belonging-to-another-exercise')
    await expect(page.getByText('Unable to load this thread.')).toBeVisible()
    // Nothing from the feed or any other thread leaks into the failed view.
    await expect(page.getByText('Does anyone know if the pharmacy')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: /reply/i })).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })
})
