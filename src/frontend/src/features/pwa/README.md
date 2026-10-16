# features/pwa

Participant-world PWA identity (mobile-tablet story 09; later 10 service worker, 11 install prompt).

- `manifest/buildManifest.ts` pure brand -> Web App Manifest (absolute `start_url`/`scope`).
- `manifest/brandIcons.ts` 192/512 PNG icons: brand logo drawn via canvas if same-origin / CORS-safe,
  else a generated initial-on-`colors.primary` PNG. A cross-origin logo WITHOUT CORS headers falls back to the
  generated icon (using it would need a backend proxy route: Brief C1 rule 1, out of scope).
- `manifest/headTags.ts` reversible `<head>` mutation (manifest blob link, apple-* tags, theme-color, title, icon).
- `manifest/ManifestHead.tsx` effect owner; revokes the blob URL on brand change / unmount.
- `PwaRoot.tsx` the one mount point. Mount once inside `BrandThemeProvider` in `App.tsx` (orchestrator).

Rules: no manifest until the brand has resolved (fail closed), none on `/staff/*`, none on join/sign-in (MT-D4),
no install telemetry (MT-D5), never "Pulse"/"Dynamis" once branded. No backend route.
