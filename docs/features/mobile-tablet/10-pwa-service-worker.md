# Story: PWA: service worker (app shell only)

**Feature:** Phones and tablets  ·  **Epic:** E1 (shell)  ·  **Phase:** 2  ·  **Status:** Built, pending wiring + real-device check (MT-D7)
**Requirements:** XC-001, NFR-004, NFR-003 (degraded modes)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Installability and a fast, resilient shell on flaky venue Wi-Fi need a service worker. Scope is deliberately small: cache
the **app shell only** (hashed static assets plus `index.html`). No exercise data, no API, no media, no SignalR. Offline cache
and "missed while offline" is PDF-02 #525, a follow-up. Participant world mechanism; invisible to the fiction.

## Acceptance Criteria
- [x] Given a production build, when a participant loads the app, then a hand-written worker (`public/sw.js`, no new dependency) precaches `index.html` and the hashed `/assets/*` bundle, and a second load with the network cut still renders the shell (then the normal "can't reach server" states). _(Built + harness-tested: install precaches the stamped list; offline navigation falls back to the cached shell. Not yet exercised in a real browser: no Playwright offline spec, needs the App.tsx wiring.)_
- [x] Given any request to `/api/*`, `/hubs/*`, uploaded/exercise media, `/join*`, `/staff/*` or any non-GET, then the worker does not cache or respond (network-only passthrough), so no exercise data is stored on the device (XC-001) and join tokens are never cached.
- [x] Given a new deploy, then the cache is versioned, old caches are deleted on activate, and the participant is offered an update (or it applies on next launch) without a forced reload during an exercise; a stale shell never calls a removed API shape without a recoverable error. _(Update applies on user "Refresh" or next launch. "Stale shell vs removed API shape" is not a worker concern; relies on the app's existing error states.)_
- [x] Given development (`npm run dev`) and tests, then the worker is not registered; registration happens only in production builds and only from the participant subtree, never on staff routes. _(`import.meta.env.PROD` gate + staff-path gate; unit-tested.)_
- [x] Given sign-out, then nothing in Cache Storage contains session or exercise data (assert the cache keys contain only static asset URLs). _(The worker only ever stores static shell URLs; asserted by key allow-list test. It stores nothing session-scoped, so there is nothing to purge on sign-out.)_
- [ ] Given the static host, then `sw.js` is served with `Cache-Control: no-cache` and the SPA navigation fallback does not swallow it (check `staticwebapp.config.json`; edit is orchestrator-owned and flagged). _(NOT DONE, orchestrator-owned: `navigationFallback.exclude` already excludes `*.js`, so `/sw.js` is not swallowed, but a `/sw.js` route with `Cache-Control: no-cache` must be added. See report.)_
- [x] Content security (NFR-004): the existing CSP (if any) permits `worker-src 'self'`; no `importScripts` of third-party code. _(No CSP exists in the repo; `staticwebapp.config.json` has none. If one is added it needs `worker-src 'self'`. No importScripts.)_
- [x] User guide: `docs/guide/troubleshooting.md` entry "app looks out of date / won't update on my phone". _(docs/guide/troubleshooting.md)_

## Out of Scope
Offline feed/media cache (PDF-02 #525), background sync, web push, caching staff surfaces, Workbox or `vite-plugin-pwa` (decide
later if offline lands).

## Technical Notes
Files: `public/sw.js`, `features/pwa/serviceWorker/*`; adds one `<ServiceWorkerRegistrar />` line to `features/pwa/PwaRoot.tsx` (created
in 09). `App.tsx`/`main.tsx` untouched by the builder; the single mount line is the orchestrator's wiring commit. See `implementation.md` story 10.

## Dependencies
Story 09 (`PwaRoot.tsx`).

## Tests
`features/pwa/serviceWorker/register.test.ts` (gating logic), `e2e/pwa-sw.spec.ts` against `vite preview` (offline reload, cache
key allow-list). Manual: Chrome DevTools Application tab.
