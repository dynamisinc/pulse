/**
 * features/pwa/serviceWorker/ServiceWorkerRegistrar.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 10. Owns the service-worker registration lifecycle for the participant
 * subtree and renders the "update ready" banner when a new version is waiting. Mounted from
 * `PwaRoot` (so it inherits PwaRoot's gates: resolved brand, not a staff route, signed-in
 * participant subtree - MT-D4). Registration itself is production-only (`import.meta.env.PROD`)
 * and never on staff paths (see register.ts). Dismissing with "Later" hides the banner for this
 * page load only; the waiting worker applies on next launch anyway.
 */
import { useEffect, useState } from 'react'
import { registerServiceWorker, type SwController } from './register'
import { UpdateBanner } from './UpdateBanner'

export interface ServiceWorkerRegistrarProps {
  /** Test seam; defaults to production-only. */
  enabled?: boolean
}

export function ServiceWorkerRegistrar({
  enabled = import.meta.env.PROD,
}: ServiceWorkerRegistrarProps) {
  const [ctrl, setCtrl] = useState<SwController | undefined>()
  const [available, setAvailable] = useState(false)
  const [snoozed, setSnoozed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let current: SwController | undefined
    let unsub: (() => void) | undefined
    void registerServiceWorker({ enabled, pathname: window.location.pathname }).then(c => {
      if (cancelled || !c) {
        c?.dispose()
        return
      }
      current = c
      setCtrl(c)
      setAvailable(c.updateAvailable)
      unsub = c.subscribe(() => setAvailable(c.updateAvailable))
    })
    return () => {
      cancelled = true
      unsub?.()
      current?.dispose()
    }
  }, [enabled])

  if (!ctrl || !available || snoozed) return null
  return <UpdateBanner onRefresh={() => ctrl.applyUpdate()} onLater={() => setSnoozed(true)} />
}
