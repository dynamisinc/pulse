/**
 * e2e/kit/session.ts
 * ---------------------------------------------------------------------------
 * Mock-session and mock-data seeding for e2e (mobile-tablet story 01).
 *
 * The guide-shots dev server (tools/guide-screenshots/serve.mjs) lets a page
 * pick the mock session role, the alert-bar content and the overlay through
 * `localStorage`. These helpers write those keys BEFORE the app boots
 * (`addInitScript`), so the very first render already sees them.
 *
 * Call them before `page.goto`.
 */
import type { Page } from '@playwright/test'

export const ROLE_KEY = 'pulse.guideShots.role'
export const ALERTS_KEY = 'pulse.guideShots.alerts'
export const OVERLAY_KEY = 'pulse.guideShots.overlay'

export type MockRole = 'participant' | 'pio' | 'controller' | 'evaluator' | 'planner' | 'orgAdmin'

/** Mirrors `Alert` in participant-shell AlertBar/alertTypes.ts (wire shape). */
export interface SeedAlert {
  readonly id: string
  readonly severity: 'info' | 'advisory' | 'emergency'
  readonly message: string
  readonly scenarioTime: string
}

/** Write raw localStorage entries before any page script runs. */
export async function seedStorage(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript(items => {
    try {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v)
    } catch { /* storage unavailable: the app falls back to the stock mock */ }
  }, entries)
}

/** Set the mock session role (stock mock = participant). Call before `goto`. */
export async function signInAs(page: Page, role: MockRole): Promise<void> {
  await seedStorage(page, { [ROLE_KEY]: role })
}

/** Inject alert-bar content. Call before `goto`. */
export async function seedAlerts(page: Page, alerts: readonly SeedAlert[]): Promise<void> {
  await seedStorage(page, { [ALERTS_KEY]: JSON.stringify(alerts) })
}

/** Inject a pause / EndEx overlay. Call before `goto`. */
export async function seedOverlay(page: Page, overlay: unknown): Promise<void> {
  await seedStorage(page, { [OVERLAY_KEY]: JSON.stringify(overlay) })
}
