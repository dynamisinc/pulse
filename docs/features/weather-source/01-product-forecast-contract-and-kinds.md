# Story: Product and forecast payload contract, kind descriptors

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-010, WX-003, WX-013, WX-002  ·  **Design decisions:** D4-009, D4-011, C-2  ·  **Issue:** —
**Stack:** fullstack  ·  **World:** n/a (contract; consumed by both)  ·  **Wave:** 2  ·  **Effort:** M

## Context
The foundation's `ContentItem.PayloadJson` is kind-specific and validated by an `IContentKindDescriptor` (FC-1, FC-7). E6 registers two kinds on channel `weather`: **`weather_product`** (watch / warning /
advisory, WX-010) and **`forecast`** (per-zone conditions + periods, WX-001/003). This story defines their payload schemas, the validators and the participant-safe projection, plus matching TS types, guards,
a pure `productState()` and fixtures — the seam every other E6 story imports. Headline, dek, media and permalink are the foundation's (FC-2/FC-3); nothing here redefines them.

## Acceptance Criteria
- [ ] **`weather_product` payload.** Given a payload `{ productType: watch|warning|advisory, hazard, action: new|update|upgrade|cancel, supersedesContentId?, zoneSlugs[1..12], effectiveScenarioTime, expiresScenarioTime, ibw: { what, where, when, impacts }, actions: string[0..8], delivery }`, then `ValidatePayload` accepts it; `hazard` is from a closed list (tornado, severe_thunderstorm, flash_flood, flood, hurricane, tropical_storm, storm_surge, winter_storm, blizzard, ice_storm, extreme_heat, extreme_cold, high_wind, wildfire_smoke, dense_fog, other); `expires` must be after `effective`; `ibw` is **required** for `warning`, optional for `watch`/`advisory`; `supersedesContentId` is required for `update|upgrade|cancel` and must name a published weather product in the same exercise.
- [ ] **`forecast` payload.** Given `{ zoneSlug, current: { tempF, condition, conditionCode, windMph, windDir, humidityPct, observedScenarioTime }, periods[1..14]: { label, tempF|hiF+loF, condition, conditionCode, precipPct, windText, detail }, discussion?, uncertaintyNote? }`, then it validates; `conditionCode` is a closed icon vocabulary (clear, partly_cloudy, cloudy, rain, showers, thunderstorms, snow, sleet, fog, wind, hot, cold); `discussion` and `uncertaintyNote` are plain text (WX-003: a later forecast for the same zone may differ — the model never forbids it).
- [ ] **Zone existence.** Given a `zoneSlug`/`zoneSlugs` entry that is not a zone in the resolved exercise (via `IWeatherZoneCatalog`, interface owned here, implemented in story 02), then validation fails with a field-level error; a zone soft-deleted after publish never invalidates the published item.
- [ ] **Plain-text body policy (NFR-004).** Given `BodyHtml` (the product narrative) and every payload string, then the kind's `BodyPolicy` is **plain text**: tags are stripped, lengths are capped (narrative 4,000, each IBW field 1,000, action 300), control characters are removed, and a stored `<script>`/`onerror` payload round-trips as inert text. Allowed media: `image` and `video` (radar loops, cone graphics, snowfall maps — WX-013), no `document`.
- [ ] **Headline is verbatim data (D4-010).** Given a headline, then the descriptor preserves it byte-for-byte (trim only) — no case change, no truncation under 200 chars — so the alert, post, widget and page can all quote the stored string.
- [ ] **Participant-safe projection (XC-002).** Given `ProjectPayload`, then the output contains the structured product/forecast fields above and **never** the staff-only `delivery` block, `supersedesContentId` internals beyond the superseded product's permalink, or any planning note; an unknown payload key is dropped, not echoed.
- [ ] **Client contract.** `features/weather/contract/` exports TS types, runtime guards (fail closed), `weatherSeverityKey(product)`, the pure `productState(product, scenarioNow) → pending|active|expired|cancelled` (cancelled when a later published `cancel` product supersedes it), and fixtures for a watch, a warning, an upgrade, a cancel and two forecasts; fixtures are fictional (no real NWS/NOAA names, offices, FIPS) and contain no absolute URLs (FC-9.3).

## Out of Scope
Zone storage (02), alert/post side effects (04), read endpoints (03), rendering (07+), editors (11). No `severity` field is stored on the product: severity is derived from `productType` in one place (04, `WeatherAlertSeverityMap`). No VTEC, UGC or SAME codes.

## Technical Notes
Backend: `src/Pulse.WebApi/Features/Weather/Contracts/**` and `Features/Weather/Kinds/**` (descriptors registered by `AddWeather()`, orchestrator-owned composition). Frontend: `src/frontend/src/features/weather/contract/**`.
Reuse `PostSanitizer` plain profile (do not fork), `ChannelVocabulary` (`weather_product`, `forecast`). Units are US customary (°F, mph); see Q8. Delivery block shape (staff-only): `{ raiseAlert: bool, post: { enabled: bool, text?: string } }` — consumed by story 04.
Both descriptors implement the foundation's **async** `ValidatePayloadAsync(json, PayloadValidationContext)` (scoped services, exercise-scoped context; weather FU-3 resolved in F02/F04), which is how zone existence (`IWeatherZoneCatalog`) and `supersedesContentId` (a published weather product in the same exercise) are checked for every caller, including a raw API call. The descriptors also implement `ResolvePublishOptions(item)` returning the payload's `delivery` block as `PublishOptions` (FC-7a, FU-2 resolved) and mark their editors `ownsDeliveryOptions`.

## Dependencies
F02 (frozen contracts, `IContentKindDescriptor`), F01 (entities). Can run with F03, F04, F08, F09, F10, F13, F14.

## Tests
`Pulse.WebApi.Tests/Weather/Kinds/**` (validator tables, sanitizer corpus, projection leak test) and `features/weather/contract/*.test.ts` (guards, `productState` table across effective/expires/cancel).
