#!/usr/bin/env node
/**
 * capture.mjs — repeatable screenshots for the Pulse user guide
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *   Starts a Pulse frontend dev server on MOCK DATA (see ./serve.mjs), drives a
 *   headless Chromium through every screen listed in SHOTS below, and writes one
 *   PNG per shot to docs/guide/img/ (repo-relative). Every image shows canned
 *   mock data (the fictional "Coastal Surge (Mock Exercise)" / Fairhaven water
 *   scenario) — never real exercise content, and no backend is needed.
 *
 * WHY ITS OWN DEV SERVER (port 5199, not your `npm run dev` on 5198)
 *   In plain mock mode the session is always the participant Dana Reyes and the
 *   staff sign-in has no mock, so staff consoles are unreachable. serve.mjs adds
 *   a dev-only Vite plugin that lets the browser choose the mock session's role
 *   (and, for two shots, a mock alert / pause overlay) via localStorage. Nothing
 *   in src/ is edited.
 *
 * USAGE (from the repo root; needs src/frontend/node_modules installed)
 *   cd tools/guide-screenshots
 *   npm install                      # once: installs playwright-core only
 *   node capture.mjs                 # all shots
 *   node capture.mjs roster day-word # only these (names without .png)
 *   node capture.mjs --list          # print the shot names
 *   GUIDE_SHOTS_URL=http://localhost:5199 node capture.mjs
 *                                    # reuse an already running `node serve.mjs`
 *   CHROMIUM_PATH=/path/to/chrome node capture.mjs
 *                                    # default: /opt/pw-browsers/chromium, else
 *                                    # whatever playwright-core resolves
 *
 * ADDING A SHOT
 *   Append an entry to SHOTS: { name, role, path, viewport?, storage?, act?, crop? }.
 *   `act(page)` performs the clicks; `crop(page)` (optional) returns a Locator or
 *   an array of Locators whose union (+ padding) is captured instead of the full
 *   viewport. Then run `node capture.mjs <name>` and LOOK at the PNG.
 *
 * Not part of CI. Not a test suite: a failed shot is logged and the run goes on;
 * the exit code is non-zero if any shot failed.
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, ROLE_STORAGE_KEY } from './serve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '../../docs/guide/img')

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }
/** Taller desktop window for CROPPED console panels, so each panel shows more rows. */
const DESKTOP_TALL = { width: 1440, height: 1150 }

/** Hides dev-only scaffolding that would never appear for a real user. */
const HIDE_DEV_CHROME_CSS = `
  /* Cross-exercise switcher: only appears because the mock staff user has 3 exercises. */
  section[aria-labelledby="exercise-switcher-heading"] { display: none !important; }
  /* "Simulate degraded (dev)" engine button — DEV builds only. */
  [data-testid="engine-degraded-simulate"] { display: none !important; }
  /* Blinking caret / smooth scroll make captures flaky. */
  * { caret-color: transparent !important; scroll-behavior: auto !important; }
`

/** Hide the evaluator's DEV-only "exercise state" toggle strip. */
async function hideEvaluatorDevStrip(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('p, span, h6')) {
      if (/^DEV\s+—\s+EXERCISE STATE/i.test(el.textContent?.trim() ?? '')) {
        el.parentElement.style.display = 'none'
      }
    }
  })
}

/** Open the controller's persona picker and pick Fulton County EM. */
async function openPersonaDock(page) {
  await page.getByRole('button', { name: /^PERSONAS/ }).click()
  await page.locator('[data-testid="command-palette"]').getByText('Fulton County EM').first().click()
  await page.getByRole('button', { name: 'Close post-as-persona panel' }).waitFor()
}

const ALERT = {
  id: 'guide-alert-1',
  severity: 'emergency',
  message: 'Boil water order: Fairhaven Zones 2-4. Do not drink tap water unless boiled.',
  scenarioTime: '2033-09-04T10:30:00-04:00',
}

/**
 * The shot list. `name` is the output file (without .png) that docs/guide/*.md
 * reference — do not rename without updating the docs.
 */
const SHOTS = [
  // ---------------------------------------------------------------- participant
  {
    name: 'participant-join',
    role: 'participant',
    viewport: MOBILE,
    // `slow-` tokens make the mock wait ~1.5 s, so the "Signing you in…" state is visible.
    path: '/join/slow-guide-demo',
    waitUntil: 'domcontentloaded',
    act: async page => { await page.getByText(/Signing you in/i).waitFor() },
    settleMs: 150,
  },
  {
    name: 'participant-signin-word',
    role: 'participant',
    viewport: MOBILE,
    path: '/login',
    act: async page => {
      await page.getByRole('textbox', { name: 'Sign-in name' }).fill('dreyes')
      await page.getByRole('textbox', { name: "Today's word" }).fill('harbor lantern')
    },
  },
  { name: 'participant-feed', role: 'participant', viewport: MOBILE, path: '/home' },
  {
    name: 'participant-thread',
    role: 'participant',
    viewport: MOBILE,
    path: '/i/status/post-fx-thread-root',
  },
  {
    name: 'participant-composer',
    role: 'participant',
    viewport: MOBILE,
    path: '/home',
    act: async page => {
      // The feather "Post" button in the left rail opens the compose sheet.
      await page.getByRole('button', { name: 'Post', exact: true }).first().click()
      await page.getByRole('heading', { name: 'New post' }).waitFor()
      await page.keyboard.type('Line at the Elm St. water station is about 20 min now. Bring your own jugs! #WaterIssues')
    },
  },
  {
    name: 'participant-alert-bar',
    role: 'participant',
    viewport: MOBILE,
    path: '/home',
    storage: { 'pulse.guideShots.alerts': JSON.stringify([ALERT]) },
    act: async page => { await page.getByText('EMERGENCY').first().waitFor() },
  },
  {
    name: 'participant-holding-page',
    role: 'participant',
    viewport: MOBILE,
    path: '/home',
    storage: {
      'pulse.guideShots.overlay': JSON.stringify({ state: 'pause', register: 'out-of-fiction', message: '' }),
    },
    act: async page => { await page.getByText(/Exercise paused/i).first().waitFor() },
  },

  // ---------------------------------------------------------------- staff
  { name: 'staff-sign-in', role: 'participant', path: '/staff/login' },
  { name: 'console-overview', role: 'controller', path: '/staff/console' },
  {
    name: 'post-as-persona',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await openPersonaDock(page)
      await page.getByLabel('Post as Fulton County EM').fill(
        'Boil-water advisory remains in effect for Zones 2-4. Bottled water at the Elm St. fire station until 6 PM. #WaterIssues',
      )
    },
  },
  {
    name: 'run-sheet',
    role: 'controller',
    path: '/staff/console',
    viewport: DESKTOP_TALL,
    crop: page => page.locator('[data-testid="console-slot-run-sheet"]'),
  },
  {
    name: 'live-world',
    role: 'controller',
    path: '/staff/console',
    viewport: DESKTOP_TALL,
    crop: page => page.locator('[data-testid="console-slot-live-world"]'),
  },
  {
    name: 'takedown',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await page.getByRole('button', { name: 'Take down post by Tom Brandt' }).first().click()
      await page.getByText('Take down this post?').waitFor()
      await page.getByLabel('Real-world reference').check()
    },
  },
  {
    name: 'white-noise',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await page.locator('[data-testid="noise-level-low"]').click()
      await page.waitForTimeout(6000) // let the mock post a little noise
    },
    crop: page => [
      page.locator('[data-testid="noise-level-group"]'),
      page.getByText('White noise', { exact: true }),
      page.getByText(/in pool/),
      page.getByText(/posts\/min/),
    ],
    pad: 30,
  },
  {
    name: 'freeze-controls',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await page.getByRole('button', { name: /Pause control/ }).click()
      await page.getByText('PAUSE TIERS').waitFor()
    },
  },
  {
    name: 'review-queue',
    role: 'controller',
    path: '/staff/console',
    viewport: DESKTOP_TALL,
    crop: page => page.locator('[data-testid="review-queue-column"]'),
  },
  {
    name: 'persona-edit',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await openPersonaDock(page)
      await page.getByRole('button', { name: 'Edit persona' }).click()
      await page.getByRole('heading', { name: 'Edit persona' }).waitFor()
    },
  },
  {
    name: 'media-library',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await openPersonaDock(page)
      await page.getByRole('button', { name: 'From library' }).click()
      await page.getByText(/of \d+ selected/).waitFor()
    },
  },
  {
    name: 'export-report',
    role: 'controller',
    path: '/staff/console/report',
    act: async page => {
      // The controller's printable exercise report (opened from the console's "Exercise report"
      // button). Wait for the report sheet's charts and post record to render from mock data.
      await page.getByRole('button', { name: /Print/ }).first().waitFor()
      await page.waitForTimeout(800)
    },
  },
  { name: 'exercise-management', role: 'planner', path: '/staff/exercises' },
  { name: 'exercise-settings', role: 'planner', path: '/staff/plan' },
  {
    name: 'practice-mode',
    role: 'planner',
    path: '/staff/plan',
    act: async page => {
      await page.getByRole('button', { name: 'Practice / sandbox' }).click()
      await page.getByRole('heading', { name: 'Practice / sandbox', level: 2 }).scrollIntoViewIfNeeded()
    },
  },
  {
    name: 'roster',
    role: 'planner',
    path: '/staff/participant-admin',
    act: async page => {
      await page.getByRole('button', { name: 'Add participant' }).evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.mouse.wheel(0, -60)
    },
  },
  {
    name: 'join-cards',
    role: 'planner',
    path: '/staff/participant-admin',
    act: async page => {
      await page.getByRole('button', { name: 'Print all cards' }).click()
      await page.getByRole('heading', { name: 'Print cards' }).waitFor()
    },
  },
  {
    name: 'day-word',
    role: 'planner',
    path: '/staff/participant-admin',
    viewport: DESKTOP_TALL,
    act: async page => {
      // Generate today's word so the panel shows the set state (the mock starts with none).
      await page.getByRole('button', { name: 'Generate a word' }).click()
      await page.getByText("Today's word is set").waitFor()
    },
    crop: page => page.getByRole('heading', { name: "Today's word" }).locator('xpath=ancestor::*[contains(@class,"MuiPaper-root") or self::section][1]'),
  },
  {
    name: 'msel-import',
    role: 'controller',
    path: '/staff/console',
    act: async page => {
      await page.getByRole('button', { name: 'Import from Excel' }).click()
      // The mock never reads the file: any .csv/.xlsx gets the canned Fairhaven MSEL preview.
      await page.locator('input[type=file]').last().setInputFiles({
        name: 'fairhaven-msel.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('Inject #,Title\nINJ-001,Example\n'),
      })
      await page.getByRole('button', { name: 'Preview' }).click()
      await page.getByText(/Preview ready/).waitFor()
    },
  },
]

// ---------------------------------------------------------------------------

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'
  return undefined // let playwright-core resolve via PLAYWRIGHT_BROWSERS_PATH
}

/** Union bounding box of one or more locators, padded and clamped to the viewport. */
async function unionClip(page, locators, pad, viewport) {
  const boxes = []
  for (const l of [locators].flat()) {
    const box = await l.first().boundingBox()
    if (box) boxes.push(box)
  }
  if (boxes.length === 0) throw new Error('crop target not found')
  const x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad)
  const x1 = Math.min(viewport.width, Math.max(...boxes.map(b => b.x + b.width)) + pad)
  const y1 = Math.min(viewport.height, Math.max(...boxes.map(b => b.y + b.height)) + pad)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

async function captureShot(browser, baseUrl, shot) {
  const viewport = shot.viewport ?? DESKTOP
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport === MOBILE,
    hasTouch: viewport === MOBILE,
    reducedMotion: 'reduce',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  const storage = { [ROLE_STORAGE_KEY]: shot.role, ...(shot.storage ?? {}) }
  await context.addInitScript(entries => {
    try { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v) } catch { /* ignore */ }
  }, storage)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    await page.goto(baseUrl + shot.path, { waitUntil: shot.waitUntil ?? 'networkidle' })
    await page.addStyleTag({ content: HIDE_DEV_CHROME_CSS })
    if (!shot.waitUntil) {
      // Wait out skeletons/spinners: no MUI progress indicator and no aria-busy region.
      await page.waitForFunction(
        () => !document.querySelector('.MuiCircularProgress-root[role="progressbar"]:not([aria-valuenow]), [aria-busy="true"]'),
        null,
        { timeout: 10_000 },
      ).catch(() => {})
      await page.waitForTimeout(800)
    }
    if (shot.act) await shot.act(page)
    await page.waitForTimeout(shot.settleMs ?? 700)
    const file = path.join(OUT_DIR, `${shot.name}.png`)
    if (shot.crop) {
      const clip = await unionClip(page, shot.crop(page), shot.pad ?? 0, viewport)
      await page.screenshot({ path: file, clip })
    } else {
      await page.screenshot({ path: file })
    }
    console.log(`  ok    ${shot.name}.png${errors.length ? `  (page errors: ${errors.join(' | ')})` : ''}`)
    return true
  } catch (err) {
    console.error(`  FAIL  ${shot.name}: ${err.message.split('\n')[0]}`)
    return false
  } finally {
    await context.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    for (const s of SHOTS) console.log(s.name)
    return
  }
  const wanted = args.filter(a => !a.startsWith('--'))
  const unknown = wanted.filter(w => !SHOTS.some(s => s.name === w))
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} (see --list)`)
  const shots = wanted.length ? SHOTS.filter(s => wanted.includes(s.name)) : SHOTS

  mkdirSync(OUT_DIR, { recursive: true })
  const external = process.env.GUIDE_SHOTS_URL
  const server = external ? { url: external, close: async () => {} } : await startServer()
  console.log(`[guide-shots] ${server.url} -> ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}`)

  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    // Keep Chromium from phoning home (component updates, safe-browsing, etc.).
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  })
  let failed = 0
  try {
    for (const shot of shots) {
      if (!(await captureShot(browser, server.url, shot))) failed++
    }
  } finally {
    await browser.close()
    await server.close()
  }
  console.log(`[guide-shots] ${shots.length - failed}/${shots.length} captured`)
  if (failed) process.exitCode = 1
}

await main()
