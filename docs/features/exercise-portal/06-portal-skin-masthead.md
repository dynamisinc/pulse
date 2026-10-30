# Story: Portal skin, masthead and dateline

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-002, COR-053, COR-066, NFR-001, NFR-008  ·  **Design decisions:** D2-001, D2-002 (broadcast direction only), D2-008  ·  **Issue:** #771
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
The portal is an **aggregator brand**, deliberately distinct from Pulse (D1) and every outlet (D3) (D2-001): Libre Franklin, station-blue masthead, gold "TODAY", red accent. This story builds the portal's token set (the FC-3b token schema, **broadcast** direction), the scope that applies it inside the portal's route subtree only, and the masthead: the templated name, optional logo, tagline and the scenario-time dateline.

## Acceptance Criteria
- [ ] **Token set and scope.** Given `portalTokens` (FC-3b `OutletSkinTokens`, `schemaVersion: 1`), when `PortalSkinScope` mounts, then it applies CSS custom properties and a portal MUI theme **inside its subtree only**; nothing is applied above `ShellLayout`; the module imports no COBRA theme and no `@/theme/styledComponents` (a static import test), and no default MUI look reaches the page (D0 §2).
- [ ] **Per-exercise brand.** Given `PortalDto.skinOverrides` and `masthead.logo`, then they are merged over `portalTokens` through the schema validator and an invalid or out-of-allowlist override falls back to the default tokens; the CANNOT list is not addressable (no key reaches slot order, scenario-time source, watermark slot or the a11y floor).
- [ ] **Masthead.** Given a `PortalDto`, then the masthead renders `name` (default `"[City] Today"`, never the exercise name), the logo with its `alt`, and the tagline; with no logo the name alone renders cleanly; the masthead is not a link out of the portal.
- [ ] **Dateline (COR-053).** Given the shell's `scenarioNow`, then the dateline shows the current scenario date and time in the exercise time zone via `ScenarioDateline`, advances without a refetch, is never labeled "scenario time", and the module contains no `Date.now()` / `toLocale*` (a lint/scan test).
- [ ] **Slot for alerts.** Given the masthead, then it exposes an `alertsEntry` slot (filled by story 14) and reserves a watermark slot for its hero area (NFR-008); it never renders its own alert bar (the shell hosts the one bar).
- [ ] **Mobile and a11y.** Given 320 px width, then the masthead collapses to one line plus dateline without horizontal scroll; contrast is ≥ 4.5:1 for text and 3:1 for UI in the default tokens (a computed test); the masthead is a `banner`-compatible region with a single `h1`, and axe is clean.

## Out of Scope
Digital and print visual directions (D2-002, parked), the `band` / `grid` layouts, the world-state mood (13), the layout grid (07), per-skin art beyond tokens.

## Technical Notes
Files: `features/portal/skin/**`, `features/portal/masthead/**`. Mount with F13's token-object `<SkinScope scopeId="portal" tokens>` (not an outlet; FU-4a resolved) and register the portal tokens with `registerSkinTokens('portal', …)` + `registerSkinExtension('portal', …)` from this folder — no private scope, no F13 edit; `ScenarioDateline` (F14), `core/clock`. Fonts use F13's `registerSkinFonts` (self-hosted woff2 or system fallback; no third-party font CDN at runtime; CSP via PP-3).

## Dependencies
02, F13 (`SkinScope`, `registerSkinTokens`), F14. Can run with 03, 04, 07.
