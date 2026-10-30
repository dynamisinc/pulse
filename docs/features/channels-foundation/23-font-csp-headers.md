# Story: Host CSP — `font-src 'self'` for self-hosted skin fonts (PP-3)

**Feature:** Channels foundation  ·  **Epic:** E4/E3/E6 shared (platform prerequisite, hosted under E1)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** NWS-002 (fonts), NFR-004 (CSP), D3-P3, COR-066  ·  **Design decisions:** D3-P3 (register fidelity), Q-10 (self-host fonts)  ·  **Issue:** #789
**Stack:** backend (SPA host / header config)  ·  **World:** platform  ·  **Wave:** 1 (combined **CW1**; merged before F13's fonts in CW2)  ·  **Effort:** S
**Added by:** the 10/29 follow-up pass (Tom's decision to fold platform prerequisite **PP-3** into the foundation). The `/display/*` header half of PP-3 is **deferred** with the Deferred `/display/:token` route; kiosk-lite is `/portal?display=1`.

## Context
Foundation 13 (`registerSkinFonts`) and the news/weather/portal skins self-host OFL `woff2` families, lazily per mounted scope (Q-10). A Content-Security-Policy that blocks fonts would silently drop every
skin to system stacks and lose D3-P3 register fidelity. This story makes the SPA host's CSP allow same-origin fonts (and nothing third-party) so the fonts load, and keeps the rest of the policy no weaker than it is today.

## Acceptance Criteria
- [x] **Font source allowed.** Given a response for the SPA shell, when the headers are inspected, then the Content-Security-Policy includes `font-src 'self'` and no third-party font origin (no `fonts.googleapis.com`, `fonts.gstatic.com` or CDN).
- [x] **Nothing else loosened.** Given the policy before and after, then no other directive is weakened (no new `unsafe-*`, no widened `default-src`/`script-src`/`style-src`); a header test pins the full expected policy so a later loosening fails.
- [x] **Fonts actually load.** Given a same-origin `woff2` under the SPA's static path, when a skin registers it via `registerSkinFonts`, then the browser loads it with no CSP violation report (verified in a header/integration test or a documented manual check).
- [x] **Host-relative and subdomain safe (COR-008).** Given the app served on the apex host or a per-exercise subdomain, then `'self'` covers both and no absolute host is hard-coded in the policy.
- [x] **Deferred half recorded.** Given the doc set, then the `/display/*` `Referrer-Policy: no-referrer` + `Cache-Control: no-store` headers are listed as deferred (post-December), not built here.

## Out of Scope
The `/display/*` headers and route (deferred); the font files and `registerSkinFonts` (F13 and each channel's skin); `Referrer-Policy`/other header hardening unrelated to fonts; a nonce/hash CSP rewrite.

## Technical Notes
Staff-invisible platform config. Files: the SPA host / header configuration (`backend-host`; the builder locates where static headers are set — no CSP exists in the repo today, so this story establishes the baseline and must not
break the dev server on 5198 or inline Vite assets) and its test. Orchestrator-applied seam if the config file is shared. Fallback if it slips: fonts fall back to system stacks (E4-Q4 default reversed). See
`implementation.md` § Platform prerequisites and F13 AC "Fonts".

## Dependencies
None. Must merge before F13's font loading is exercised (CW2) — hence CW1. Can run with 01, 02, 21.

## Implementation notes (as built, 10/29)
**Where the policy lives.** The SPA is served by Azure Static Web Apps, so the headers are `globalHeaders` in
`src/frontend/public/staticwebapp.config.json`. Global headers reach every response, including
`navigationFallback` documents and the `/join` route rules (those add their own headers on top). The .NET API is a
separate origin that serves only API responses (`Program.cs` maps no static files or SPA fallback), so it gets no
document CSP here. `vite preview` reads the same `globalHeaders`, so a
production build can be checked locally. The dev server (5198) gets no CSP, because the React Refresh preamble is an
inline script. `build.assetsInlineLimit` never inlines a font, because `font-src 'self'` blocks `data:` fonts.

**Mode: split.** Before this story the host sent no CSP.
- **Enforced** `Content-Security-Policy`: `font-src 'self'; object-src 'none'; base-uri 'self'`. This covers AC1 and
  blocks every third-party font. The other two directives cannot affect the app (it has no plugins and no `<base>`).
- **Report-only** `Content-Security-Policy-Report-Only`, the full baseline: `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:;
  connect-src 'self' https: wss:; manifest-src 'self' blob:; worker-src 'self'; frame-src 'none'; object-src 'none';
  base-uri 'self'; form-action 'self'`. It soaks on UAT, where the real cross-origin API, SignalR and SAS media are
  exercised. No reporting endpoint exists yet, so violations show only in the browser console. Promotion is
  therefore gated on an explicit **manual UAT sweep**, not on "no reports": with devtools open, walk the participant
  feed (compose, media upload, link preview, video), the portal, the staff console and report, and the join/login
  forms (`form-action`), with a live SignalR connection. Promote only if the console shows no CSP messages.

**AC2 is measured against the prior state and the enforced header.** The host sent no CSP before this story, so
nothing is loosened. The enforced header has no `unsafe-*`. The one `unsafe-*` in the report-only baseline,
`style-src 'unsafe-inline'`, is accepted on purpose (see below), and the test pins it as the only one.

**Relaxations, and why.**
- `style-src 'unsafe-inline'`: emotion (MUI 9) injects `<style>` elements at runtime, and React `style` props are
  inline style attributes. A nonce/hash rewrite is out of scope.
- `connect-src https: wss:`: the API and its `/hubs/exercise` SignalR hub are a per-environment cross-origin host
  (`VITE_API_URL`). Naming that host would hard-code an absolute host (AC4, COR-008).
- `img-src`/`media-src https:`: post media are blob-storage SAS URLs, and link-preview images come from arbitrary https
  sites. `safeMediaUrl.ts` already restricts which URLs reach the DOM.
- `blob:`: upload previews and video-poster capture (img and media), and the generated brand PWA manifest
  (manifest-src).
- `img-src data:`: the brand `apple-touch-icon`.
- `script-src` is `'self'` only, with no `'unsafe-eval'`. zod 4 probes `new Function` for its JIT, so
  `core/config/zodConfig.ts` (imported first in `main.tsx` and by `core/telemetry/schema.ts`) sets
  `z.config({ jitless: true })` to keep that probe from tripping the policy.

**For the promotion change.** Add `frame-ancestors 'none'`. Browsers ignore it in a report-only header, so it is left
out of the baseline. Also add a `report-to` endpoint if one exists by then. When previewing against a local
`http://localhost` API, the report-only `connect-src` logs reports; that is expected. The service worker answers an
offline navigation with its cached `index.html`, which keeps the headers it was cached with, so a tightened policy
reaches an offline or stale-shell participant only after the worker updates.

**Manual check (AC3).** Production build with `VITE_USE_MOCK_DATA=true`, served by `vite preview`. Both headers were
present on the documents and on `/assets/*.woff2`. The browser console showed **no CSP messages (enforced or
report-only)** on the participant feed (`/home`) or on the staff console (`/staff/console`, mock staff session). The
self-hosted Figtree woff2 loaded. A `new FontFace(..., url(/assets/<file>.woff2))` (the call `registerSkinFonts` will
make) also loaded with no violation. The brand blob manifest, the data-URI touch icon, the videos and the service
worker all ran clean.

**Deferred (AC5).** The `/display/*` `Referrer-Policy: no-referrer` and `Cache-Control: no-store` headers are deferred
post-December, together with the `/display/:token` route (Q-35). They are not built here.
