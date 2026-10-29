# Story: Weather widget mount

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-003, WX-021 (consumer side), WX-011, COR-053, XC-001, NFR-001  ·  **Design decisions:** D4-010, D2-005, D2-008  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** S

## Context
PRT-003 lists a Weather widget (E6). Weather story 10 ships a self-contained `WeatherWidgetTile` and `useWeatherSummary` and says E3 mounts it; per D4-010 the tile **swaps its forecast for the warning tile** and carries the same headline string as the alert bar, the `@WeatherDesk` post and the product page. This story is the portal-side mount only: registration, placement, skin pass-through and fail-closed behavior. It is a candidate to cut or slip (cut order 3): if weather 10 is late, the portal simply hides this module.

## Acceptance Criteria
- [ ] **Mount.** Given the registry, when `register.ts` registers `weather` (region `rail`), then `WeatherModule` renders weather 10's `WeatherWidgetTile` inside a `ModuleFrame` with the heading "Weather" and a "See all →" link to `/weather` only when `weather` is enabled.
- [ ] **Forecast to warning swap.** Given no active alert, then the forecast tile shows (zone, temperature, icon and text); given an active warning product, when `ContentPublished` arrives on the weather channel, then the tile swaps to the warning tile with the headline **verbatim** and a permalink, and swaps back when the product expires or is cancelled (verified with the weather 10 fixtures).
- [ ] **Fail closed.** Given a malformed or empty summary, an error, or `weather` disabled, then the module hides (07) and never shows a broken box.
- [ ] **Skin pass-through.** Given the portal skin scope, then the tile styles from the scope's CSS variables (falling back to the Weather Desk tokens per weather 10); the mount imports no COBRA and applies no default MUI look.
- [ ] **No double announcement.** Given the tile's own `aria-live="polite"`, then the module does not add a second live region, and emergency announcement stays with the shell's alert bar (D4-010).
- [ ] **Mobile and a11y.** Given 320 px, then the tile is full-width in stored order, links are ≥ 44 px on coarse pointers, the severity chip meets 4.5:1 and is never color-only, and axe is clean; no watermark is needed (no imagery) but chrome is never hidden by the tile.

## Out of Scope
The tile itself and the summary route (weather 10 / 03), multi-zone carousel, any alert raising.

## Technical Notes
Files: `features/portal/modules/weather/**` (+ `register.ts`). Imports `WeatherWidgetTile`, `useWeatherSummary` from `features/weather` (the orchestrator adds weather's `export * from './widget'` re-export, weather impl). R-W1 is **applied in weather story 10** (`size='display'`, no links, no `aria-live`); this story uses the default `standard` size, story 19 uses `display`.

## Dependencies
07, weather 10 (hard import, incl. `size` prop; + weather 03 types). Can run with 08-11, 13-16.
