# Story: PWA: per-exercise brand manifest

**Feature:** Phones and tablets  ·  **Epic:** E1 (shell)  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** COR-066, COR-030, XC-002, NFR-001  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
A participant adding the exercise to their home screen must see the exercise's fiction (its brand name and icon), never
"Pulse by Dynamis". The brand tokens (`name`, `colors`, optional `logo`) already reach the client via `useBrandConfig()`
(`participant-shell/brandTokens.ts`). **Chosen design: frontend only.** Build the web app manifest at runtime from those
tokens and point `<link rel="manifest">` at a blob URL; no new backend route. Participant world.

## Acceptance Criteria
- [x] Given an exercise brand resolves, when the participant shell mounts, then `<link rel="manifest">` points to a generated manifest whose `name` and `short_name` come from the brand name, `theme_color` and `background_color` from brand colors, `display: "standalone"`, and `start_url`/`scope` are **absolute same-origin URLs** (blob manifests cannot resolve relative ones).
- [x] Given a brand with a same-origin or CORS-safe logo, then it is used for 192 and 512 icons; given no usable logo, then a generated PNG (initial on `colors.primary`, contrast-screened) is used. In **no** case does the manifest, `apple-touch-icon`, `apple-mobile-web-app-title` or `<title>` contain "Pulse", "Dynamis" or the Pulse favicon once a brand has resolved.
- [x] Given the brand has not resolved (join/sign-in before a session, or fetch failure), then the head stays brand-neutral (no manifest advertising a fictional or Pulse name) and installability is simply not offered; the page never invents a brand (fail closed, as `brandTokens.ts`).
- [x] Given the participant switches exercise or signs out, then the previous blob URL is revoked and the head tags are reset; a cached brand from another exercise is never reused (XC-001/002; React Query key includes `exerciseId`).
- [x] Given a staff route (`/staff/*`), then no participant manifest or brand tags are present (two-worlds rule).
- [x] Given the manifest is produced, then a Vitest unit test covers `buildManifest()` (names, absolute URLs, icon fallback, no-leak assertion over the serialized JSON) and a Playwright check reads the live `<link rel="manifest">` after sign-in. *(Vitest and Playwright (`e2e/pwa-manifest.phone.spec.ts`) done)*
- [x] If review concludes a backend brand-metadata route is unavoidable (for example the logo cannot be fetched cross-origin or iOS requires server-rendered tags), stop and raise it: it is a Brief C1 rule 1 coordination item (frontend-only wave, Session A owns migrations) and out of this story. *(No backend route needed: logo is drawn via canvas when same-origin/CORS-safe, else falls back to the generated icon; iOS tags are set dynamically. Real-iOS check still manual.)*
- [ ] User guide: `docs/guide/participant-guide.md` "Add to home screen" section (name/icon are the exercise's), and `docs/guide/getting-started.md` planner note that the brand name/logo/colors set the installed app's name and icon.

## Out of Scope
Service worker (10), install prompt UI (11), offline, push, a backend route, planner UI to upload a separate "app icon" (parked:
today the brand logo is the source).

## Technical Notes
New `features/pwa/manifest/*` plus `features/pwa/PwaRoot.tsx` which the orchestrator mounts inside `BrandThemeProvider` in
`App.tsx` in the **wiring commit** (orchestrator-owned file; do not edit it here). `index.html` keeps its neutral head; do not
add a static `manifest.webmanifest`. iOS ignores much of the manifest and uses `apple-touch-icon`/`apple-mobile-web-app-*`
tags, set dynamically before install; verify on a real iOS Safari as a manual check. See `implementation.md` story 09.

## Dependencies
none for build. Wiring commit for mounting.

## Tests
`features/pwa/manifest/buildManifest.test.ts`, `ManifestHead.test.tsx`, and `e2e/pwa-manifest.spec.ts`. Manual: Chrome Android
Lighthouse installability and iOS "Add to Home Screen" name/icon check.

## Real-device checklist (MT-D7, Tom)
- [ ] Android Chrome: install produces a **WebAPK** (Settings > Apps shows the installed app under the exercise brand name, not as a plain shortcut). If it only creates a shortcut, this becomes the C1 backend-manifest item.
- [ ] iOS Safari: Share > Add to Home Screen shows the **brand icon and name** (not Pulse). If not, this becomes the C1 backend-manifest item.
- [ ] Android: confirm the blob-URL manifest and `data:` icons still produce a WebAPK rather than a shortcut (Chrome sometimes downgrades installs whose manifest is not a normal URL).
- [ ] Manifest/icon verification on both platforms: home-screen icon is the brand logo or generated initial (no Pulse favicon), label is the brand short name, splash/theme colour is the brand primary.
- [ ] Install exercise A, then exercise B on the same device: B installs with B's brand (manifest `id` is per exercise: `/?pwa=<exerciseId>`).

## Known limitations
- Pre-sign-in (join / sign-in pages) the static `index.html` head applies: iOS Share > Add to Home Screen from there gets the static title, description and author. MT-D4 means that page is not offered for install. While branded, the title, description, author, theme-color and icon are overridden and restored on sign-out.
