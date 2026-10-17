/**
 * e2e/burst-legibility.phone.spec.ts   @perf
 * ---------------------------------------------------------------------------
 * Burst legibility on a mid-range phone (mobile-tablet story 07; NFR-002,
 * SOC-071, NFR-001, COR-053). 390x844 touch Chromium, CPU throttled 4x via CDP
 * (`Emulation.setCPUThrottlingRate`), 120 posts/min streamed through the mock
 * feed-arrival seam (`postStore.appendPost`, see helpers/burst.ts).
 *
 * MT-D6 thresholds (accepted, adjustable by Tom, change them HERE only):
 *   - no single long task over 200 ms
 *   - p95 frame time <= 50 ms
 *
 * SHAPE. The feed does not insert arrivals under a reading user (D1-005): they
 * buffer behind the sticky `NewPostsPill`, which carries an aggregate count and
 * a throttled (3 s) polite live region. So the burst is run with the reader
 * scrolled mid-feed, the realistic worst case, and we assert:
 *   1. the two MT-D6 thresholds over the whole run,
 *   2. scroll anchoring (the post under the finger does not move, no rows inserted),
 *   3. the pill shows an aggregate and the live region is aggregated, not per post,
 *   4. a post rendered after the burst is loaded still passes the scenario-time guard.
 *
 * DURATION. Real time, not accelerated: BURST_SECONDS (default 60 s, = 120 posts)
 * rather than the story's 10 minutes. The path is steady-state (bounded buffer of
 * 200, count-only renders), so 60 s exercises it; a 10-minute soak is a manual run:
 *   BURST_SECONDS=600 npx playwright test --grep @perf
 *
 * Run alone:  GUIDE_SHOTS_PORT=5314 npx playwright test --grep @perf
 * Skip it:    npx playwright test --grep-invert @perf
 * Phone-390 only; other projects skip (the budget is defined for this profile).
 */
import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalScroll, expectNoWallClock } from './kit'
import {
  injectBurst, installProbes, readProbe, startProbe, throttleCpu,
} from './helpers/burst'

/** MT-D6 (feature.md Decisions). */
const MAX_LONG_TASK_MS = 200
const MAX_P95_FRAME_MS = 50
const CPU_THROTTLE = 4
const RATE_PER_MIN = 120
const BURST_SECONDS = Number(process.env.BURST_SECONDS ?? 60)
/** NewPostsPill speaks at most once per SPOKEN_THROTTLE_MS (3 s). */
const SPOKEN_THROTTLE_S = 3

/**
 * Set to true only if a threshold run FAILS and a fix is pending: flips the
 * threshold test to test.fail so the suite stays green while the numbers are
 * reported. TODO(mobile-tablet story 07): remove when the app meets MT-D6.
 */
const KNOWN_THRESHOLD_FAILURE = false

async function anchorTop(page: Page): Promise<{ id: string, top: number }> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-feed-post-id]'))
    const row = rows.find(r => {
      const b = r.getBoundingClientRect()
      return b.top > 60 && b.bottom < window.innerHeight
    })
    if (!row) throw new Error('no fully visible feed row to anchor on')
    return { id: (row.textContent ?? '').slice(0, 60), top: row.getBoundingClientRect().top }
  })
}

test.describe('burst legibility @perf', () => {
  test.beforeEach(({ browserName: _b }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'phone-390', 'phone-390 profile only')
  })
  test.setTimeout((BURST_SECONDS + 90) * 1000)

  test(`120 posts/min for ${BURST_SECONDS}s at 4x CPU throttle: MT-D6, anchoring, aggregation`, async ({ page }) => {
    test.fail(KNOWN_THRESHOLD_FAILURE, 'TODO(story 07): feed misses MT-D6; see PR numbers')
    await installProbes(page)
    await page.goto('/join/demo-e2e-token')
    await expect(page.getByRole('tab', { name: 'All Posts' })).toBeVisible()
    await throttleCpu(page, CPU_THROTTLE)

    // Build a scrollable feed: stream a quick batch, tap the pill to load it.
    await injectBurst(page, 1200, 4, 'warm')
    const pill = page.getByTestId('new-posts-pill')
    await expect(pill).toBeVisible()
    await pill.click()
    await expect(pill).toHaveCount(0)
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)

    // Warm-up pass (W-001): a short mid-feed burst exercises the arrival path so Vite's
    // lazy transforms and the JIT are warm before the measured run; then clear it.
    await injectBurst(page, RATE_PER_MIN, 6, 'warm-arrival')
    await expect(pill).toBeVisible()
    await pill.click()
    await expect(pill).toHaveCount(0)
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)

    // Reader is mid-feed. Record the anchor, then burst.
    const scrollBefore = await page.evaluate(() => window.scrollY)
    const rowsBefore = await page.locator('[data-feed-post-id]').count()
    const anchorBefore = await anchorTop(page)
    await startProbe(page)
    const injected = await injectBurst(page, RATE_PER_MIN, BURST_SECONDS)
    const metrics = await readProbe(page)

    // Report the numbers (they go in the PR description).
    console.log(`[burst] profile=phone-390 cpu=${CPU_THROTTLE}x posts=${injected} ` +
      `longTaskMax=${metrics.longTaskMaxMs.toFixed(1)}ms longTasks=${metrics.longTaskCount} ` +
      `frameP95=${metrics.frameP95Ms.toFixed(1)}ms frameMax=${metrics.frameMaxMs.toFixed(1)}ms ` +
      `frames=${metrics.frameCount} announcements=${metrics.announcements.length} ` +
      `(${[...new Set(metrics.announcements)].join(' | ')})`)

    expect(injected).toBe(Math.round(BURST_SECONDS * RATE_PER_MIN / 60))
    expect(metrics.longTaskObserved, 'longtask PerformanceObserver registered').toBe(true)
    expect(metrics.frameCount, 'rAF sampler ran').toBeGreaterThan(BURST_SECONDS)

    // 2. Scroll anchoring: nothing moved under the reader, no rows inserted.
    expect(await page.evaluate(() => window.scrollY), 'scroll position was yanked').toBe(scrollBefore)
    const anchorAfter = await anchorTop(page)
    expect(anchorAfter.id).toBe(anchorBefore.id)
    expect(Math.abs(anchorAfter.top - anchorBefore.top), 'visible post jumped').toBeLessThanOrEqual(1)
    expect(await page.locator('[data-feed-post-id]').count(), 'rows were inserted under the reader').toBe(rowsBefore)

    // 3. Pill aggregates; live region aggregated (NFR-001, SOC-071).
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText(injected > 99 ? '99+ new posts' : `${injected} new posts`)
    const spoken = metrics.announcements
    expect(spoken.length, 'at least one announcement').toBeGreaterThan(0)
    expect(spoken.length, 'live region announced per post, not aggregated')
      .toBeLessThanOrEqual(Math.ceil(BURST_SECONDS / SPOKEN_THROTTLE_S) + 2)
    expect(spoken.length).toBeLessThan(injected / 2)
    for (const s of spoken) expect(s).toMatch(/^\d+\+? new posts?$/)
    await expectNoHorizontalScroll(page)

    // 1. MT-D6 thresholds.
    expect(metrics.longTasksOver200, `long task ${metrics.longTaskMaxMs.toFixed(0)}ms > ${MAX_LONG_TASK_MS}ms`)
      .toBe(0)
    expect(metrics.longTaskMaxMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS)
    expect(metrics.frameP95Ms, `p95 frame ${metrics.frameP95Ms.toFixed(1)}ms`)
      .toBeLessThanOrEqual(MAX_P95_FRAME_MS)

    // 4. Load the burst: a rendered burst post is scenario-time, DOM stays bounded.
    await pill.click()
    await expect(page.getByText(/Burst update \d+:/).first()).toBeVisible()
    await expectNoWallClock(page)
    await expect(page.getByText(/Sep 4, 2033/).first()).toBeVisible()
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length)
    console.log(`[burst] after load: rows=${await page.locator('[data-feed-post-id]').count()} domNodes=${domNodes}`)
  })
})
