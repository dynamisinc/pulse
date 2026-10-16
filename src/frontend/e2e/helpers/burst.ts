/**
 * e2e/helpers/burst.ts
 * ---------------------------------------------------------------------------
 * Burst driver + main-thread probes for the burst-legibility spec
 * (mobile-tablet story 07; NFR-002, SOC-071).
 *
 * THE SEAM (no production code touched). Under mock data the feed's arrival
 * source is the in-tab `postStore` (`feedStreamSource.makeMockArrivalSource`):
 * `postStore.appendPost` is exactly what a SignalR frame becomes in the mock
 * world, and everything downstream (`toParticipantView`, `useFeedStream`'s
 * bounded buffer, `NewPostsPill`) is the real code path. The Vite dev server
 * (tools/guide-screenshots/serve.mjs) serves source modules by URL, so the page
 * can `import()` the SAME module instance the app uses and append to it.
 * That is dev-server-only: a production build has no such URL.
 *
 * Probes are installed with `addInitScript` (before app code) so the PerformanceObserver
 * sees every long task, and sample into `window.__burstProbe`.
 */
import type { CDPSession, Page } from '@playwright/test'

const POST_STORE_URL = '/src/features/social/services/postStore.ts'
const PERSONA_ID = 'persona-fairhavenwater'

interface ProbeState {
  longTasks: number[]
  frames: number[]
  announcements: string[]
  active: boolean
  longTaskObserved: boolean
}

export interface BurstMetrics {
  /** Longest main-thread task (ms) seen since `resetProbe`. */
  readonly longTaskMaxMs: number
  readonly longTaskCount: number
  /** Tasks over the 200 ms MT-D6 budget. */
  readonly longTasksOver200: number
  readonly frameCount: number
  readonly frameP95Ms: number
  readonly frameMaxMs: number
  /** Non-empty text updates observed inside the pill's polite live region. */
  readonly announcements: readonly string[]
  /** The longtask PerformanceObserver registered (else a clean run proves nothing). */
  readonly longTaskObserved: boolean
}

/** Throttle the CPU of a Chromium page (4 = a mid-range phone, MT-D6). */
export async function throttleCpu(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  return cdp
}

/** Install long-task / frame / live-region probes before the app boots. */
export async function installProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Probe {
      longTasks: number[]
      frames: number[]
      announcements: string[]
      active: boolean
      longTaskObserved: boolean
    }
    const probe: Probe = {
      longTasks: [], frames: [], announcements: [], active: false, longTaskObserved: false,
    }
    ;(window as unknown as { __burstProbe: Probe }).__burstProbe = probe
    try {
      new PerformanceObserver(list => {
        if (!probe.active) return
        for (const e of list.getEntries()) probe.longTasks.push(e.duration)
      }).observe({ type: 'longtask', buffered: false })
      // Set only after observe() succeeded; the spec asserts it so an unsupported
      // browser cannot pass with a silent "no long tasks".
      probe.longTaskObserved = true
    } catch { /* leaves longTaskObserved false; the spec fails loudly */ }
    let last = 0
    const tick = (t: number) => {
      if (probe.active && last !== 0) probe.frames.push(t - last)
      last = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const startObserver = () => {
      new MutationObserver(records => {
        if (!probe.active) return
        const seen = new Set<Element>()
        for (const r of records) {
          const node = r.target instanceof Element ? r.target : r.target.parentElement
          // Only the pill's own polite region counts as an announcement (S-002).
          const region = node?.closest('[data-testid="new-posts-live"]')
          if (!region || seen.has(region)) continue
          seen.add(region)
          const text = (region.textContent ?? '').trim()
          if (text !== '') probe.announcements.push(text)
        }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
    }
    if (document.documentElement) startObserver()
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true })
  })
}

/** Zero the probe buffers and start recording. */
export async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p = (window as unknown as { __burstProbe: ProbeState }).__burstProbe
    p.longTasks.length = 0
    p.frames.length = 0
    p.announcements.length = 0
    p.active = true
  })
}

/** Stop recording and summarise. */
export async function readProbe(page: Page): Promise<BurstMetrics> {
  // Let the last frame / mutation records / long-task entries flush before deactivating.
  await page.waitForTimeout(150)
  return page.evaluate(() => {
    const p = (window as unknown as { __burstProbe: ProbeState }).__burstProbe
    p.active = false
    const frames = p.frames.slice().sort((a, b) => a - b)
    const idx = (q: number) => Math.min(frames.length - 1, Math.ceil(q * frames.length) - 1)
    const at = (q: number) => frames[idx(q)] ?? 0
    return {
      longTaskMaxMs: Math.max(0, ...p.longTasks),
      longTaskCount: p.longTasks.length,
      longTasksOver200: p.longTasks.filter(d => d > 200).length,
      frameCount: frames.length,
      frameP95Ms: at(0.95),
      frameMaxMs: frames[frames.length - 1] ?? 0,
      announcements: p.announcements.slice(),
      longTaskObserved: p.longTaskObserved,
    }
  })
}

/**
 * Stream `ratePerMin` posts per minute into the feed for `seconds` of REAL time.
 * (Time is not accelerated: a 10-minute run is the same code path, only longer;
 * the spec runs a shorter window and says so.) Resolves with the posts injected.
 * `injectBurst` returns once the run is over.
 */
export async function injectBurst(
  page: Page,
  ratePerMin: number,
  seconds: number,
  idPrefix = 'burst',
): Promise<number> {
  return page.evaluate(
    async ([url, personaId, rate, secs, prefix]) => {
      const mod = await import(/* @vite-ignore */ url as string) as {
        postStore: { appendPost(post: unknown): void }
      }
      const intervalMs = 60_000 / (rate as number)
      const total = Math.round(((secs as number) * 1000) / intervalMs)
      let n = 0
      await new Promise<void>(resolve => {
        const timer = setInterval(() => {
          n += 1
          const scenario = new Date(Date.UTC(2033, 8, 4, 15, 0, 0) + n * 1000).toISOString()
          mod.postStore.appendPost({
            id: `${prefix}-${n}`,
            exerciseId: 'ex-mock-0001',
            authorPersonaId: personaId,
            actingHumanId: 'human-burst',
            text: `Burst update ${n}: crews are reporting conditions on Elm St. #Burst`,
            counts: { reply: 0, repost: 0, like: 0 },
            createdWallClock: new Date().toISOString(),
            scenarioTime: scenario,
            origin: 'controller-as-persona',
          })
          if (n >= total) {
            clearInterval(timer)
            resolve()
          }
        }, intervalMs)
      })
      return n
    },
    [POST_STORE_URL, PERSONA_ID, ratePerMin, seconds, idPrefix] as const,
  )
}
