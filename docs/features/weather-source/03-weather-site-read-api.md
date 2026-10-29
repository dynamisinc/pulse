# Story: Weather site read API (site, zone, widget summary)

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-001, WX-002, WX-003, WX-004, WX-021  ·  **Design decisions:** D4-009, D4-010  ·  **Issue:** —
**Stack:** fullstack (backend + one TS contract file)  ·  **World:** participant (read)  ·  **Wave:** 4  ·  **Effort:** M

## Context
The foundation's generic list/permalink reads (F06) return published items; the Weather Desk site needs a **resolved view at scenario time**: the current forecast and conditions per zone, and which
products are active. This story adds two E6 read endpoints that resolve "what is true now" using the server scenario clock, which is how the timeline **snaps** on a time jump (WX-002) without E6 owning a scheduler.

## Acceptance Criteria
- [ ] **Site endpoint.** `GET /api/weather/site?zone={slug}` (default zone when omitted; unknown zone = 404) returns `{ zone, zones[], nowScenarioTime, conditions, forecast: { issuedScenarioTime, periods[], discussion?, uncertaintyNote?, permalink }, products: [ { summary, payload, state } ] }`, built through the foundation participant projector and kind `ProjectPayload` (no second projection path), behind `RequireChannelEnabled("weather")`.
- [ ] **Resolution at scenario time.** Given published items, then the "current" forecast per zone is the most recent `forecast` whose `PublishedScenarioTime <= now` and is not retracted; items published with a scenario time **after** `now` (a backward jump) are excluded, so the site always reflects the exercise clock; a retracted forecast falls back to the previous one.
- [ ] **Product state.** Each product carries `state` = pending | active | expired | cancelled computed server-side from `effective`/`expires` against `IExerciseClock` and the supersession chain (same table as the TS `productState` in 01); `products` lists active + pending first (warning before watch before advisory, then newest), then up to 10 expired/cancelled for context, each with `permalink`; retracted products return only the tombstone shape.
- [ ] **Forecast evolution (WX-003).** Given two forecasts for a zone at scenario times T1 < T2, when `now` is between them the site shows T1's content and after T2 shows T2's; the earlier forecast stays readable at its permalink; the endpoint never blends or interpolates.
- [ ] **Widget summary (WX-021).** `GET /api/weather/summary` returns `{ zone: { slug, name }, conditions, activeWarningCount, activeAlertCount, top: { headline, permalink, productType } | null }` for the default zone (or `?zone=`), where `top` is the highest-severity active product and `headline` is the stored string verbatim (D4-010).
- [ ] **Isolation, scenario time (XC-001/002, COR-053).** The resolved exercise comes only from the host session; no `exerciseId` in URL/body; all instants are `scenarioTime` strings; no origin, acting human, wall clock, draft/scheduled item or `delivery` block appears; cross-exercise data is unreachable; both routes are added to the F20 isolation suite.
- [ ] **Burst-safe.** The endpoints are single bounded queries (≤ 3 per call, indexed on `(ExerciseId, ChannelId, Kind, Status)`), safe to refetch on every `ContentPublished` for the weather channel.

## Out of Scope
Computing real meteorology, interpolating forecasts, per-user zone preference persistence (client-side only), the portal widget layout (E3; story 10 ships the tile + hook). Alert history (F10).

## Technical Notes
`src/Pulse.WebApi/Features/Weather/Read/**` (service, endpoints, DTO records under `Features/Weather/Contracts` additions are *new files* here, not edits to 01's). Reuse `IExerciseClock`, the F06 projector, `IWeatherZoneCatalog`. The TS mirror of these DTOs (types, guards, fixtures) is this story's one frontend file set, `features/weather/contract/site.ts` + `site.fixtures.ts` + `zones.ts` and the shared `features/weather/hooks/useZones.ts` (read hook over `GET /api/weather/zones`; additive to 01's folder, new files only), so 08/10 build on mock fixtures behind the axios client until the route is live.

## Dependencies
01, 02, F06 (projector, read services), F08 (gate), F04 (published data). Can run with 04, 05, 06, F15, F16, F17, F18.
