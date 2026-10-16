# features/pwa

Participant-world PWA identity (mobile-tablet story 09 manifest; 10 service worker; 11 install prompt).

- `manifest/buildManifest.ts` pure brand -> Web App Manifest (absolute `start_url`/`scope`).
- `manifest/brandIcons.ts` 192/512 PNG icons: brand logo drawn via canvas if same-origin / CORS-safe,
  else a generated initial-on-`colors.primary` PNG. A cross-origin logo WITHOUT CORS headers falls back to the
  generated icon (using it would need a backend proxy route: Brief C1 rule 1, out of scope).
- `manifest/headTags.ts` reversible `<head>` mutation (manifest blob link, apple-* tags, theme-color, title, icon).
- `manifest/ManifestHead.tsx` effect owner; revokes the blob URL on brand change / unmount.
- `PwaRoot.tsx` the one mount point. Mount once inside `BrandThemeProvider` in `App.tsx` (orchestrator).

Rules: no manifest until the brand has resolved (fail closed), none on `/staff/*`, none on join/sign-in (MT-D4),
no install telemetry (MT-D5), never "Pulse"/"Dynamis" once branded. No backend route.

## Service worker (story 10)

- `public/sw.js` hand-written, no dependency. Caches the built shell ONLY (`/index.html` + hashed
  `/assets/*`); everything else (`/api`, `/hubs`, media, `/join*`, `/staff/*`, non-GET, cross-origin) is
  network-only passthrough. Offline navigation falls back to the cached shell (no separate offline page,
  so no stray product branding). Navigation responses are never stored.
- `vite.config.ts` `pulseSwStamp` stamps `__PULSE_BUILD_ID__` + the precache list into `dist/sw.js`, so
  each deploy changes the worker bytes; old `pulse-shell-*` caches are deleted on activate.
- `serviceWorker/register.ts` prod-only (`import.meta.env.PROD`), never `/staff/*`; update flow waits for
  the participant's "Refresh" (SKIP_WAITING), then reloads. `ServiceWorkerRegistrar` + `UpdateBanner`.
- `dock/PwaDock.tsx` shared bottom stack above `--pulse-chrome-bottom` + `--pulse-tabbar-height`.
- Hosting: `staticwebapp.config.json` must serve `/sw.js` with `Cache-Control: no-cache` (orchestrator-owned).

## Install prompt (story 11)

- `install/useInstallPrompt.ts` state machine (none | android | ios); `install/installEnv.ts` UA/standalone
  detection (iOS heuristic documented there) and per-exercise localStorage (`pulse:pwa:*:{exerciseId}`).
- `install/InstallPrompt.tsx` brand-skinned banner (Android, calls `prompt()` on tap) / non-modal sheet (iOS,
  from the 2nd visit). Hidden when standalone or dismissed; Escape dismisses; never steals focus. No telemetry (MT-D5).
