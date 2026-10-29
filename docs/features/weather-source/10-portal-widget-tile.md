# Story: Portal weather widget tile and summary hook

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-021, WX-011, COR-053  ·  **Design decisions:** D4-010, D2-008  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** S

## Context
WX-021: the portal widget (PRT-003) shows current conditions + active-alert count and links to the site; D4-010 says it **swaps its forecast tile for the warning tile**, carrying the same headline string (the
fourth simultaneous appearance). The portal itself is E3's. E6 ships the data hook and a self-contained presentational tile that E3 mounts; E6 never edits portal files and the tile is usable only inside a
participant skin scope.

## Acceptance Criteria
- [ ] **Hook.** Given `useWeatherSummary(zone?)`, then it returns the `GET /api/weather/summary` data (mock fixtures until live), refetches on weather-channel `ContentPublished|Revised|Retracted` and on clock changes, and fails closed on a malformed response (tile renders nothing, not a broken box).
- [ ] **Forecast tile (no active alert).** Given `top = null`, then `WeatherWidgetTile` shows zone name, current temperature, condition icon **and** text, and "No active alerts" with a link to `/weather`.
- [ ] **Warning tile (D4-010).** Given an active product, then the tile swaps to the warning tile: `SeverityChip`, the headline **verbatim**, active-alert count, and a link to the product permalink; a watch uses the watch chip; the active count never reads colour-only.
- [ ] **Skin-agnostic and isolated.** Given the tile is mounted by E3 inside the portal's skin scope, then it styles from skin CSS variables (falling back to the Weather Desk tokens if none), imports no COBRA and no default MUI look, and (`size='standard'` only) exposes `aria-live="polite"` for changes (emergency announcement stays with the alert bar); the hook resolves data only via the host session.
- [ ] **Display size for the kiosk (portal R-W1).** Given `<WeatherWidgetTile size="display" />`, then it renders large type for a 1920×1080 screen, **no links and no focusable element**, and **no `aria-live`** (the kiosk's shell alert bar is the only announcer, so there is no double announcement), keeps the severity chip as icon + text + color, still swaps to the warning tile with the same verbatim headline, and works inside **any** participant scope (portal, kiosk) by styling from skin CSS variables and falling back to the Weather Desk tokens when none are present; `size` defaults to `'standard'` and the default behavior is unchanged.
- [ ] **Mobile-first and accessible.** The tile is full-width at 320 px, links are >= 44 px on coarse pointers, the severity chip meets 4.5:1, and axe is clean; it reserves no watermark (no imagery) but never hides the shell chrome.
- [ ] **Contract for E3.** The tile's props, hook name and the data-test ids are exported from `features/weather/widget/index.ts` (the orchestrator adds the one re-export line to 06's `features/weather/index.ts`) and documented in this feature's `implementation.md` (the integration contract the E3 decomposer consumes).

## Out of Scope
The portal widget grid/placement and any portal landing logic (E3); a multi-zone carousel; widget settings; edits to `features/portal`.

## Technical Notes
Files: `src/frontend/src/features/weather/{widget/WeatherWidgetTile.tsx, hooks/useWeatherSummary.ts*}`. Props: `{ zone?: string; size?: 'standard' | 'display' }` (the `display` size is portal request R-W1, applied here). Depends on `features/weather/contract/site.ts` (story 03) types. If E3 lands first it mounts the tile via its own widget registry; E6 does nothing portal-side.

## Dependencies
07 (chip), 03 (types/fixtures; route may be mock), F09 (stream), F15. Can run with 08, 09, 11, 12, 13.
