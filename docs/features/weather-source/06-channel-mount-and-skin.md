# Story: Weather channel mount, route shell and Weather Desk skin

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-001, NFR-001, NFR-008, COR-053  ·  **Design decisions:** D3-P1/P2, D4-009, D4-012, D7-001  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** M

## Context
The channel's frame: it registers itself with the foundation router, mounts under `/weather`, and wraps everything in the Weather Desk skin through `OutletSkinScope` — the one place E6 decides what the channel
*looks* like. Institutional, dense, plain; a government data site, not a consumer app and not enterprise chrome. Pages (08, 09) fill the routes this story declares.

## Acceptance Criteria
- [ ] **Registration.** Given `registerChannel('weather', …)` at `features/weather/index.ts`, then the F12 router mounts the channel at `/weather` only when the channel is enabled (F08 guard); routes are `/weather` (site, default zone), `/weather/zones/:zoneSlug`, `/weather/:outletSlug/:contentSlug` (FC-4); an unknown path inside the channel renders the participant-world not-found, not a COBRA/MUI default page.
- [ ] **Skin tokens (FC-3b).** Given `weather-desk` tokens, then `palette` includes the AA-adjusted severity hues (`warning #8b0000`, `watch #2e6b4f`, advisory per Q5) and a neutral institutional ground; `type` uses a plain sans for chrome and a monospace stack for product text; `ext.weather` supplies the severity icon set (FontAwesome) and `breaking.vocabulary` is unused; every text/background pair in the token file is checked >= 4.5:1 (3:1 for large text) by a unit test (NFR-001).
- [ ] **Scope, not leak.** Given the channel is mounted, then the theme applies only inside the route subtree (`OutletSkinScope`); the shell chrome and alert bar above are unchanged; a static test forbids `@/theme/*` / COBRA imports and default-look MUI components anywhere under `features/weather` participant folders (D0 §2).
- [ ] **Layout is mobile-first.** Given a 320 px viewport, then the channel is one column with no horizontal scroll (product text wraps), touch targets are >= 44 px on coarse pointers, and at >= 900 px a two-column site layout (conditions/forecast + alerts rail) is available; reduced-motion respected.
- [ ] **Watermark and chrome (NFR-008).** Given `isWatermarkRequired(chromeConfig)`, then the channel layout reserves the `WatermarkSlot` for imagery regions and never removes the shell's exercise chrome (chrome and watermark never both off).
- [ ] **Fictional identity.** The masthead shows the outlet name/tagline from `useOutlets` ("The Weather Desk"), never a real agency name or seal; the logo comes from the outlet media; a missing logo falls back to a text wordmark.

## Out of Scope
The pages' content (08, 09), cross-channel nav (shell-owned), the alert bar (shell-owned), outlet admin. Any custom font served from a third-party CDN.

## Technical Notes
Files: `src/frontend/src/features/weather/{index.ts, WeatherChannel.tsx, skin/**, routes/**}`. The token values live in `features/weather/skin/weatherDeskTokens.ts` and are registered with `registerSkinTokens('weather-desk', …)` from this folder (replacing F13's stub) and the `ext.weather` schema with `registerSkinExtension('weather', …)` (FU-4 resolved, FC-8a); no F13 file is edited. MUI 9 `sx`-only; FontAwesome only; no `@mui/icons-material`.

## Dependencies
F12 (router, `registerChannel`), F13 (skin system, `registerSkinTokens`, `weather-desk` stub), F08 (enablement), F14 (`WatermarkSlot`). Can run with 03, 04, 05, F15.
