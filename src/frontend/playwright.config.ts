/**
 * playwright.config.ts
 * ---------------------------------------------------------------------------
 * Browser e2e harness (mobile-tablet story 01). Chromium only, no backend.
 *
 * DEPENDENCY ON THE GUIDE-SHOTS SERVER: specs run against the frontend's mock
 * seams, and the role / alerts / overlay overrides those specs need
 * (`pulse.guideShots.*` localStorage keys) are provided by the dev-only Vite
 * plugin in `tools/guide-screenshots/serve.mjs`. We reuse that server rather
 * than forking the plugin, so e2e shares port 5199 with the screenshot tool.
 * `reuseExistingServer: true` means a `node serve.mjs` you already started is
 * used as is. If a mock seam is renamed in src/, serve.mjs fails loudly.
 *
 * Chromium: `CHROMIUM_PATH`, else /opt/pw-browsers/chromium when present (the
 * cloud dev container), else Playwright's own download (`npx playwright install
 * chromium`). Run with `npm run test:e2e` (see e2e/README.md).
 *
 * Projects = viewports. Phones are 360x800 and 390x844 (mobile emulation, touch);
 * the tablet is 768x1024 (touch). Specs that are phone-only skip the others. The
 * `controller-tablet` project runs only e2e/controller-tablet.spec.ts, which sets its own
 * four viewports.
 */
import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const BUNDLED_CHROMIUM = '/opt/pw-browsers/chromium'
const executablePath = process.env.CHROMIUM_PATH
  ?? (existsSync(BUNDLED_CHROMIUM) ? BUNDLED_CHROMIUM : undefined)

/** The spec that owns its four console viewports (see the `controller-tablet` project). */
const CONTROLLER_TABLET_SPEC = /controller-tablet\.spec\.ts$/

const PORT = Number(process.env.GUIDE_SHOTS_PORT ?? 5199)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    launchOptions: { ...(executablePath ? { executablePath } : {}) },
    contextOptions: { reducedMotion: 'reduce' },
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../../tools/guide-screenshots/serve.mjs',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { GUIDE_SHOTS_PORT: String(PORT) },
  },
  projects: [
    {
      name: 'phone-360',
      testIgnore: CONTROLLER_TABLET_SPEC,
      use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-390',
      testIgnore: CONTROLLER_TABLET_SPEC,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'tablet-768',
      testIgnore: CONTROLLER_TABLET_SPEC,
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    // Controller console at the four tablet viewports (mobile-tablet story 16). The spec sets
    // each viewport itself (per describe), so it runs ONCE here and is skipped by the projects
    // above; no existing spec is multiplied.
    {
      name: 'controller-tablet',
      testMatch: CONTROLLER_TABLET_SPEC,
      use: { viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
  ],
})
