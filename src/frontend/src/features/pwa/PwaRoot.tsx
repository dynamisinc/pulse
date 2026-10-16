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
 * No telemetry (MT-D5). No backend route.
 */
import { useResolvedBrandConfig } from '@/features/participant-shell/brandTokens'
import { ManifestHead } from './manifest/ManifestHead'
import { isStaffPath } from './isStaffPath'

export function PwaRoot() {
  const brand = useResolvedBrandConfig()
  const onStaff = isStaffPath(window.location.pathname)
  return <ManifestHead brand={onStaff ? undefined : brand} />
}
