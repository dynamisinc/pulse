# Story: Host CSP — `font-src 'self'` for self-hosted skin fonts (PP-3)

**Feature:** Channels foundation  ·  **Epic:** E4/E3/E6 shared (platform prerequisite, hosted under E1)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002 (fonts), NFR-004 (CSP), D3-P3, COR-066  ·  **Design decisions:** D3-P3 (register fidelity), Q-10 (self-host fonts)  ·  **Issue:** #789
**Stack:** backend (SPA host / header config)  ·  **World:** platform  ·  **Wave:** 1 (combined **CW1**; merged before F13's fonts in CW2)  ·  **Effort:** S
**Added by:** the 10/29 follow-up pass (Tom's decision to fold platform prerequisite **PP-3** into the foundation). The `/display/*` header half of PP-3 is **deferred** with the Deferred `/display/:token` route; kiosk-lite is `/portal?display=1`.

## Context
Foundation 13 (`registerSkinFonts`) and the news/weather/portal skins self-host OFL `woff2` families, lazily per mounted scope (Q-10). A Content-Security-Policy that blocks fonts would silently drop every
skin to system stacks and lose D3-P3 register fidelity. This story makes the SPA host's CSP allow same-origin fonts (and nothing third-party) so the fonts load, and keeps the rest of the policy no weaker than it is today.

## Acceptance Criteria
- [ ] **Font source allowed.** Given a response for the SPA shell, when the headers are inspected, then the Content-Security-Policy includes `font-src 'self'` and no third-party font origin (no `fonts.googleapis.com`, `fonts.gstatic.com` or CDN).
- [ ] **Nothing else loosened.** Given the policy before and after, then no other directive is weakened (no new `unsafe-*`, no widened `default-src`/`script-src`/`style-src`); a header test pins the full expected policy so a later loosening fails.
- [ ] **Fonts actually load.** Given a same-origin `woff2` under the SPA's static path, when a skin registers it via `registerSkinFonts`, then the browser loads it with no CSP violation report (verified in a header/integration test or a documented manual check).
- [ ] **Host-relative and subdomain safe (COR-008).** Given the app served on the apex host or a per-exercise subdomain, then `'self'` covers both and no absolute host is hard-coded in the policy.
- [ ] **Deferred half recorded.** Given the doc set, then the `/display/*` `Referrer-Policy: no-referrer` + `Cache-Control: no-store` headers are listed as deferred (post-December), not built here.

## Out of Scope
The `/display/*` headers and route (deferred); the font files and `registerSkinFonts` (F13 and each channel's skin); `Referrer-Policy`/other header hardening unrelated to fonts; a nonce/hash CSP rewrite.

## Technical Notes
Staff-invisible platform config. Files: the SPA host / header configuration (`backend-host`; the builder locates where static headers are set — no CSP exists in the repo today, so this story establishes the baseline and must not
break the dev server on 5198 or inline Vite assets) and its test. Orchestrator-applied seam if the config file is shared. Fallback if it slips: fonts fall back to system stacks (E4-Q4 default reversed). See
`implementation.md` § Platform prerequisites and F13 AC "Fonts".

## Dependencies
None. Must merge before F13's font loading is exercised (CW2) — hence CW1. Can run with 01, 02, 21.
