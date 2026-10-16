/**
 * features/pwa/PwaRoot.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 09 composition point for the PWA identity (later stories
 * 10 service worker / 11 install prompt each add ONE line here).
 *
 * WIRING (orchestrator, App.tsx): mount ONCE inside `<BrandThemeProvider>` in
 * the `participantSurface`, e.g.
 *     <BrandThemeProvider><PwaRoot /><ShellLayout>...</ShellLayout></BrandThemeProvider>
 * That subtree only renders for a signed-in participant/PIO (after
 * `ParticipantLandingGuard`), which is exactly MT-D4: no manifest on join /
 * sign-in. As belt and braces it also refuses to run on `/staff/*` paths and
 * until the exercise brand has really resolved (`useResolvedBrandConfig`, which
 * has NO default-brand fallback), so it never advertises a placeholder or Pulse
 * identity.
 *
 * Story 10 adds the service-worker registrar (production-only) inside a shared bottom `PwaDock`
 * (stories 10/11 banners stack there). Same gates: resolved brand, never on `/staff/*`.
 *
 * Story 11 adds `<InstallPrompt />` (Android banner / iOS sheet) in the same dock.
 *
 * No telemetry (MT-D5). No backend route.
 */
import { useResolvedBrandConfig } from '@/features/participant-shell/brandTokens'
import { ManifestHead } from './manifest/ManifestHead'
import { isStaffPath } from './isStaffPath'
import { PwaDock } from './dock/PwaDock'
import { InstallPrompt } from './install/InstallPrompt'
import { ServiceWorkerRegistrar } from './serviceWorker/ServiceWorkerRegistrar'

export function PwaRoot() {
  const brand = useResolvedBrandConfig()
  const onStaff = isStaffPath(window.location.pathname)
  const participantBrand = onStaff ? undefined : brand
  return (
    <>
      <ManifestHead brand={participantBrand} />
      {participantBrand && (
        <PwaDock>
          <ServiceWorkerRegistrar />
          <InstallPrompt brandName={participantBrand.name} />
        </PwaDock>
      )}
    </>
  )
}
