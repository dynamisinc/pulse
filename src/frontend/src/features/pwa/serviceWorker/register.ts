/**
 * features/pwa/serviceWorker/register.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 10. Registers `/sw.js` and exposes the "update ready" flow as a
 * small framework-free controller (so the gating + update logic is unit-testable).
 *
 * GATING (all must hold, else `registerServiceWorker` returns undefined and touches nothing):
 *   - `enabled` (PwaRoot passes `import.meta.env.PROD`): never in `npm run dev` or tests;
 *   - the browser supports service workers;
 *   - the path is not a staff route (two-worlds: the participant shell only).
 *
 * UPDATE FLOW: a new worker installs and WAITS. We surface `updateAvailable`; only when the
 * participant taps "Refresh" do we post SKIP_WAITING and, once the new worker takes control,
 * reload (user-initiated, never forced mid-exercise). `controllerchange` caused by the very
 * first install (clients.claim) does NOT reload: we only reload after we asked for it.
 *
 * No telemetry (MT-D5 is install-only, but this is infrastructure; nothing is emitted).
 */
import { isStaffPath } from '../isStaffPath'

export const SW_URL = '/sw.js'

export interface SwController {
  /** Whether a new version is installed and waiting. */
  readonly updateAvailable: boolean
  /** Subscribe to changes of `updateAvailable`; returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Ask the waiting worker to take over; reloads once it has. */
  applyUpdate(): void
  /** Stop listening (unmount / sign-out). Does not unregister the worker. */
  dispose(): void
}

export interface RegisterOptions {
  enabled: boolean
  pathname: string
  /** Test seams. */
  container?: ServiceWorkerContainer | undefined
  reload?: () => void
}

export async function registerServiceWorker(
  opts: RegisterOptions,
): Promise<SwController | undefined> {
  const container =
    opts.container ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined)
  if (!opts.enabled || !container || isStaffPath(opts.pathname)) return undefined
  const reload = opts.reload ?? (() => window.location.reload())

  let reg: ServiceWorkerRegistration
  try {
    reg = await container.register(SW_URL, { scope: '/', updateViaCache: 'none' })
  } catch {
    return undefined // fail soft: the app works without a worker
  }

  let available = false
  let applying = false
  const listeners = new Set<() => void>()
  const set = (v: boolean) => {
    if (available === v) return
    available = v
    listeners.forEach(l => l())
  }

  const watch = (w: ServiceWorker | null) => {
    if (!w) return
    const check = () => {
      if (w.state === 'installed' && container.controller) set(true)
    }
    w.addEventListener('statechange', check)
    check()
  }
  if (reg.waiting && container.controller) set(true)
  watch(reg.installing)
  const onUpdateFound = () => watch(reg.installing)
  reg.addEventListener('updatefound', onUpdateFound)

  const onControllerChange = () => {
    if (applying) reload()
  }
  container.addEventListener('controllerchange', onControllerChange)

  const onVisible = () => {
    if (document.visibilityState === 'visible') void reg.update().catch(() => undefined)
  }
  document.addEventListener('visibilitychange', onVisible)

  return {
    get updateAvailable() {
      return available
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    applyUpdate() {
      const waiting = reg.waiting
      if (!waiting) return
      applying = true
      waiting.postMessage({ type: 'SKIP_WAITING' })
    },
    dispose() {
      reg.removeEventListener('updatefound', onUpdateFound)
      container.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
      listeners.clear()
    },
  }
}
