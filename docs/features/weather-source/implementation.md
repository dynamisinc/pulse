# Implementation: Weather source (E6)

> The bridge between planning and orchestration (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Phase/release: December release (Tom, 10/21).**
> Built **on** `docs/features/channels-foundation/` (stories `F01…F20`; contracts `FC-1…FC-9` are referenced by name and not redefined here). E6 registers kind descriptors, a channel mount, kind editors and skin
> tokens; it edits **no** foundation file. Every foundation gap E6 found is **resolved** in the foundation or the platform (§ Foundation follow-ups — resolved); the combined cross-feature wave view is in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md) (weather waves = combined waves; **story 10 is pulled from wave 5 into CW4** behind 03's types/fixtures PR so the portal can hard-import it in CW5).

Backend root: `src/Pulse.WebApi/Features/Weather/` (new; `Contracts`, `Kinds`, `Zones`, `Read`, `Delivery`, `Timeline`, `Seed`). Entity: `src/Pulse.WebApi/Data/Entities/WeatherZone.cs`.
Frontend root: `src/frontend/src/features/weather/` (`contract`, `skin`, `components`, `pages`, `hooks`, `widget`, `staff`, `testing`). Staff editors live under `features/weather/staff/`, registered into F17's slot.

## What E6 deliberately does NOT build (owned by the foundation)
Content table and lifecycle (F01/F04), scheduler and time-jump rules (F05), permalinks/list/preview reads (F06/F07), outlet registry + the Weather Desk outlet with paired `@WeatherDesk` (F03), alert source and
`IAlertRaiser` (F10), alert bar live wiring and history (F11), channel router/enablement (F12/F08), realtime (F09), skin mechanism (F13), primitives (F14), data hooks + view telemetry (F15), content injects (F16),
authoring shell (F17), paired post machinery (F18). WX-012 is therefore F16 + F17 + the kinds being eligible.

## Decisions recorded
| Decision | Where |
|---|---|
| **D4-010 / C-2:** every `warning` raises `emergency` regardless of hazard, "for now"; watch → `advisory`; advisory → `info`; E6 passes severity, F10 maps nothing; one pinned class, one pinned test; graded mapping parked | story 04, 14 |
| **D4-011 / C-3:** handle `@WeatherDesk`, brand "The Weather Desk"; post default = headline verbatim, editable pre-publish console-side | 04, 11 |
| **Timeline = scheduled content**, not a second scheduler; "current" is resolved at read time against scenario time so a time jump **snaps** without un-publishing anything | 03, 05 |
| **Zones are labels, not geometry;** own exercise-scoped entity (not packed into outlet categories) | 02 |
| **Warnings force the alert on;** only watch/advisory may opt out (`delivery.raiseAlert`) | 01, 04 |
| **Headline is one stored string**, never transformed in data or presentation | 01, 04, 07, 14 |
| **Weather is staff-authored only** (D4-011 #9): no participant composer, no participant write route anywhere in E6 | 11, 12 |

## Per-story tech notes
| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 | Payload records + async validators (`ValidatePayloadAsync`) + sanitizer profile reuse; two `IContentKindDescriptor` impls (incl. `ResolvePublishOptions` reading the `delivery` block) registered by `AddWeather()`; TS mirror with guards and a pure `productState`; fictional fixtures. Defines `IWeatherZoneCatalog` (impl in 02). | `Features/Weather/Contracts/**`, `Features/Weather/Kinds/**`, `features/weather/contract/**` (except `site.ts`, `zones.ts`, `timeline.ts`) | payload types, descriptors, `productState`, `IWeatherZoneCatalog` |
| 02 | `ZoneService` (mirrors `OutletService`) over the `WeatherZone` entity that F01's **M1** creates (Q-28) + routes + `IWeatherZoneCatalog` impl; **no migration**. | `Features/Weather/Zones/**` | `/api/weather/zones*`, catalog impl |
| 03 | `WeatherReadService`: resolve-at-scenario-time queries through the F06 projector; site + summary endpoints; TS DTO mirror, fixtures and `useZones`. | `Features/Weather/Read/**`, `features/weather/contract/{site,zones}.ts`, `features/weather/hooks/useZones.ts*` | `/api/weather/{site,summary}`, `WeatherSiteDto`, `WeatherSummaryDto`, `useZones` |
| 04 | `WeatherAlertSeverityMap`, `WeatherDeliveryPlanner` (alert + post plan from the payload `delivery` block, stale-on-jump guard), `WeatherPublishedObserver` (replace/clear on upgrade/cancel/retract/correct). | `Features/Weather/Delivery/**` | `WeatherAlertSeverityMap` |
| 05 | Staff read model over weather `ContentItem`s + issue-update helper through `CreateDraftAsync`; filters copied from `InjectEndpoints`. | `Features/Weather/Timeline/**`, `features/weather/contract/timeline.ts` | `/api/weather/timeline`, `issue-update` |
| 06 | `registerChannel('weather')`, routes, `OutletSkinScope` with the final Weather Desk tokens, mobile-first layout, not-found. | `features/weather/{index.ts, WeatherChannel.tsx, skin/**, routes/**}` | `registerChannel` call, `weatherDeskTokens` |
| 07 | Presentational product components styled by CSS variables; no fetching. | `features/weather/components/product/**` | `SeverityChip`, `IbwGrid`, `ProductText`, `ProductTimes`, `ProductStateBanner`, `ProductImagery` |
| 08 | Site page: React Query over `/site` (mock until live) + stream merge + clock-driven state. | `features/weather/pages/WeatherHomePage.tsx`, `features/weather/components/site/**`, `features/weather/hooks/useWeatherSite.ts*` | — |
| 09 | Permalink page over F15's `useContentItem` + payload guard; tombstone; telemetry. | `features/weather/pages/ProductPage.tsx`, `features/weather/hooks/useWeatherProduct.ts*` | — |
| 10 | `useWeatherSummary` + `WeatherWidgetTile` (`size: 'standard' \| 'display'`, portal R-W1) for E3 to mount. | `features/weather/widget/**`, `features/weather/hooks/useWeatherSummary.ts*` | `WeatherWidgetTile`, `useWeatherSummary` (**the E3 integration contract**) |
| 11 | COBRA editors in F17's editor slot + delivery-options block + live participant preview. | `features/weather/staff/{register.ts, ProductEditor.tsx, ForecastEditor.tsx, deliveryOptions/**}` | kind editor registrations |
| 12 | COBRA timeline list over `/timeline` with now marker and live clock. | `features/weather/staff/timeline/**` | staff-registry entry (orchestrator wires) |
| 13 | COBRA zone admin over `/api/weather/zones`. | `features/weather/staff/zones/**` | staff-registry entry (orchestrator wires) |
| 14 | E6 additions to the F20 kit + cross-surface headline and NWS-identity scans. | `Pulse.WebApi.Tests/Weather/Conformance/**`, `features/weather/testing/**`, `e2e/weather/**` | — |
| 15 | Stretch seed through the funnel only; idempotent by `ExternalSource: 'pulse-sample'`. | `Features/Weather/Seed/**` | `POST /api/weather/seed-sample-timeline` |

## Reuse map
- **Isolation:** `IExerciseScoped` + `PulseDbContext` central filter/write guard for `WeatherZone`; participant routes behind `RequireChannelEnabled("weather")` (F08); `ExerciseContext.CurrentExerciseId` in the scheduler's background scope (F05 owns; story 04 runs inside it); frontend `core/exerciseContext`.
- **Clock:** `IExerciseClock.CurrentScenarioTime(exerciseId)` for all "now" resolution (story 03, 04, 05); frontend `core/clock` (`useScenarioTime`, `formatScenarioTime`), the shell `scenarioNow`; `ScenarioDateline` from F14.
- **Publishing:** `IContentPublishService` only (never write `ContentItem`); `IContentPublishedObserver`; `IAlertRaiser`; `IPairedSocialPoster`; `IContentKindDescriptor`; `IContentPermalinks`/`contentPermalink()`.
- **Sanitizer/media:** `PostSanitizer` plain profile (no fork); `Features/Media/*`, `core/media`, `ExerciseBands`, `isWatermarkRequired`, `WatermarkSlot`, `ContentMedia` (watermark slot reserved on all weather imagery).
- **Participant frontend:** F12 `registerChannel`, F13 `OutletSkinScope`/tokens, F14 primitives (`LiveRegionAnnouncer`), F15 hooks (`useContentItem`, `useContentViewTelemetry`), F09 `useChannelStream`, `useCoarsePointer`, `usePrefersReducedMotion`, shared axios client `core/services/api.ts`, `core/utils/validateEnv.ts`, React Query. **No COBRA and no default MUI look on any participant path;** FontAwesome only; MUI 9 `sx`-only.
- **Staff frontend:** COBRA `@/theme/styledComponents`, F17 `ContentAuthoringShell` + `registerContentKindEditor`, `features/staff/staffRouteRegistry`, `EngineCockpitStaffAuthorizationFilter` / `EngineCockpitControllerRoleFilter` (backend), `InjectEndpoints` pattern.
- **Telemetry:** F04/F10 emit `content_published`, `alert_issued`; F15 emits `article_view` / `content_dwell` with `payload.kind` and (additive) `payload.productType`; `weather_zone_changed` and the `article_view` `productType` key are registered by foundation story 02 / passed via F15's `extraPayload` (FC-6b).

## Wave Plan (DAG-ready)
Waves are numbered on the **same axis as the foundation** (F-Wave 1…5); "Depends-on" lists foundation stories as `F##`. An E6 story never starts before every dependency is merged, but within a wave the listed stories have
disjoint file footprints and fan out in parallel.

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Contract + kinds | fullstack | `Features/Weather/{Contracts,Kinds}/**`, `features/weather/contract/**` (not `site/zones/timeline`) | F01, F02 | F03, F04, F08, F09, F10, F13, F14 | 2 | M |
| 02 Zone model + API | backend | `Features/Weather/Zones/**` (entity + migration are F01's M1) | 01, F01 (M1 has `WeatherZone`), F08 | 07, F05, F06, F07, F11, F12 | 3 | M |
| 07 Product components | frontend | `features/weather/components/product/**` | 01, F14 | 02, F05, F06, F07, F11, F12 | 3 | M |
| 03 Site read API | fullstack | `Features/Weather/Read/**`, `features/weather/contract/{site,zones}.ts`, `features/weather/hooks/useZones.ts*` | 01, 02, F06, F08 | 04, 05, 06, F15, F16, F17, F18, F19 | 4 | M |
| 04 Warning delivery | backend | `Features/Weather/Delivery/**` | 01, F04 (FC-7a options), F05, F10, F18 (post ACs) | 03, 05, 06, F15, F16, F17, F19 | 4 | M |
| 05 Staff timeline API | backend | `Features/Weather/Timeline/**`, `features/weather/contract/timeline.ts` | 01, F04, F05, F07 | 03, 04, 06, F15, F16, F17, F18, F19 | 4 | S |
| 06 Mount + skin | frontend | `features/weather/{index.ts,WeatherChannel.tsx,skin/**,routes/**}` | F08, F12, F13 (`registerSkinTokens`), F14 | 03, 04, 05, F15, F16, F17, F18, F19 | 4 | M |
| 08 Site home | frontend | `features/weather/pages/WeatherHomePage.tsx`, `features/weather/components/site/**`, `features/weather/hooks/useWeatherSite.ts*` | 06, 07, 03 (types/mocks), F09, F15 | 09, 10, 11, 12, 13, 15 | 5 | L |
| 09 Permalink page | frontend | `features/weather/pages/ProductPage.tsx`, `features/weather/hooks/useWeatherProduct.ts*` | 06, 07, 01, F06, F15 | 08, 10, 11, 12, 13, 15 | 5 | M |
| 10 Widget tile | frontend | `features/weather/widget/**`, `features/weather/hooks/useWeatherSummary.ts*` | 07, 03 (types/mocks), F09, F15 | 08, 09, 11, 12, 13, 15 | 5 | S |
| 11 Staff editors | frontend | `features/weather/staff/{register.ts,ProductEditor.tsx,ForecastEditor.tsx,deliveryOptions/**}` | 01, 07, 03 (`useZones`), F17 (`ownsDeliveryOptions`); 05 follow-up actions (mock until live) | 08, 09, 10, 13, 15 (**not 12: 12 waits for 11**) | 5 | L |
| 12 Staff timeline panel | frontend | `features/weather/staff/timeline/**` | 05 (mock until live), **11 (explicit serial edge: starts after 11 merges)**, F09, F17 | 08, 09, 10, 13, 15 | 5 | M |
| 13 Staff zone admin | frontend | `features/weather/staff/zones/**` | 02 (mock until live), 03, F17 | 08, 09, 10, 11, 12, 15 | 5 | S |
| 15 Sample seed (stretch) | backend | `Features/Weather/Seed/**` | 01, 02, 04, F03, F04, F05, F07 | 08–13 | 5 | S |
| 14 Conformance | testing | `Pulse.WebApi.Tests/Weather/Conformance/**`, `features/weather/testing/**`, `e2e/weather/**` | 01–13, F20 | — | 6 | M |

`Stack` tells the orchestrator which builder to spawn and which Gate-0 command to run. The backend exists; a frontend story against a real E6 route waits for that route's story (serial edges: **03 → 08/10**, **05 → 12**,
**02 → 13**; the DTO types/fixtures in 03/05 are the seam, so 08/10/12/13 can build on mocks behind the axios client until the route lands). Effort: S ≈ a focused sitting, M ≈ one to two, L ≈ two to three.

### Integration seam (orchestrator-owned — never a wave story)
| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | `AddWeather()` (descriptors, services, observer, catalog) / `MapWeather()` added by the orchestrator in the same PR as each backend story (01, 02, 03, 04, 05, 15) with a `WebApplicationFactory<Program>` wiring test each (routes mapped, descriptors registered, services resolve). |
| Participant composition | `features/channels/routing/registry.ts` via story 06's own `registerChannel('weather')` call | The router file is F12's; the orchestrator adds the one import of `features/weather` so the registration runs. No `App.tsx` edit by any E6 builder. |
| Widget re-export | `features/weather/index.ts` | 06 owns it; the orchestrator adds the `export * from './widget'` line after story 10 merges. |
| Staff registry | `features/staff/staffRouteRegistry` and the F17 editor registry | Orchestrator adds entries for 12, 13 and imports `features/weather/staff/register.ts` (story 11). |
| Migration order | `src/Pulse.WebApi/Migrations/*` | The foundation [migration ledger](../channels-foundation/implementation.md#migration-ledger): **M1 (F01) carries `WeatherZone`** (Q-28, Tom 10/29); this feature adds no migration. Only press 06's M2 follows M1. |

## Foundation follow-ups — resolved
All eight were folded into the foundation (or the platform) in the December consolidation pass; **none remains open and no fallback is needed** (the outlet-categories zone store, the observer-based alert/post path and the hand-edited token file are all dropped). Source of truth:
[`channels-foundation/implementation.md` § Follow-up resolution ledger](../channels-foundation/implementation.md#follow-up-resolution-ledger).
| # | Gap | Resolved in |
|---|---|---|
| FU-1 | A `WeatherZone` migration against the "only F01/F16" rule | **Folded into F01's M1** (Q-28, Tom 10/29); weather 02 owns the service/API only. |
| FU-2 | Alert + `@WeatherDesk` post on timed issuance (no dialog); meaning of `DefaultAlertMapping` | **FC-7a** + `IContentKindDescriptor.ResolvePublishOptions` (story 01 reads the `delivery` block); `DefaultAlertMapping` is a dialog suggestion only. F01 (`PublishOptionsJson`), F04, F05, F16 apply it. |
| FU-3 | Async, scoped payload validation (zones, supersession) | **FC-7** `ValidatePayloadAsync(json, PayloadValidationContext)` (F02/F04); story 01 implements it. |
| FU-4 | Final `weather-desk` token values; `ext.weather` | **FC-8a** `registerSkinTokens` + `registerSkinExtension` (F13), `ext.weather` allowlisted by F03; story 06 registers from `features/weather/skin/`. |
| FU-5 | Multi-alert stacking/rotation in the one bar | **F11** AC (two- and five-alert ordering, rotation, a11y); story 14 still asserts the data side. |
| FU-6 | F17's generic alert/post controls vs weather's locked options | **FC-8** `registerContentKindEditor(kind, component, { ownsDeliveryOptions: true })` (F17); story 11 registers with it. |
| FU-7 | Telemetry vocabulary: `weather_zone_changed`, `article_view.payload.productType` | **FC-6b**, applied once in **F02**; `productType` via F15 `extraPayload`. |
| FU-8 | Single Weather Desk outlet; idempotent default outlets | **F03** AC: exactly one `weather-desk` outlet, "add default outlets" idempotent. |
Cross-channel request **R-W1** (portal) is applied in story 10 (`size='display'`, no links, no `aria-live`, any participant scope).

## Slip candidates (December scope guard)
Ordered by what to cut first if December tightens. None are on the critical path of "a warning authored, scheduled, firing the bar + post, readable on the site".
1. **15 Sample seed** (stretch, demo convenience).
2. **12 Timeline panel** — fallback: F17's status list filtered to the weather channel is the timeline for December (loses the now marker and per-zone grouping). 05's read model can slip with it, except `issue-update`.
3. **05 issue-update helper** — fallback: the editor clones/edits manually (11); the cost is re-keying zones/IBW on upgrade and cancel.
4. **10 Widget tile** — only needed if E3's portal lands for December; pilot mode (login lands on Social) needs no widget.
5. **13 Zone admin** — fallback: the F03 "add default outlets" action creates a single default zone through the zone API; multi-zone authoring (WX-004) slips.
Parked beyond December (not stories): graded per-hazard severity mapping (C-2), interactive/zone-polygon maps and radar loops as data, VTEC/UGC/SAME codes, rolling auto-evolving forecasts, hourly graphs, marine/aviation products, per-recipient alerting, Cadence-pushed weather (E9), E8 drafting of products.
**Map/graphics call:** WX-013 is satisfied by image/video media on products and forecasts with the watermark slot; there is no map component in December.

## Open questions for Tom
Consolidated and de-duplicated in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md#6-open-questions-for-tom): Q1 → Q-24, Q2 → Q-25, Q3 → Q-26, Q4 → Q-11, Q5 → Q-27, Q6 → Q-28, Q7 → Q-29, Q8 → Q-30, Q9 → Q-31. Defaults below are what the stories assume.
| # | Question | Default assumed |
|---|---|---|
| Q1 | Confirm D4-010 #6 "for now": **every warning forces the emergency band**, and a warning **cannot** be published without its alert (only watch/advisory may opt out). Advisory product → `info` band, watch → `advisory`. | Yes to all; warnings force the alert on. |
| Q2 | `@WeatherDesk` post default when issuing: **checked** for watch/warning (the D4 storyboard shows four simultaneous surfaces) or **unchecked** like press cross-post (D4-004)? Text defaults to headline verbatim either way. | Checked for watch/warning (editable, can uncheck), unchecked for advisory and forecasts. |
| Q3 | Backward scenario-time jump: foundation never un-publishes. The site excludes products/forecasts published "after now" and the timeline flags them, but alert-bar entries and permalinks of such items stay. Acceptable, or should a rewind be unsupported for weather? | Acceptable; documented behaviour. |
| Q4 | D4 is desktop-only (STORY-UPDATES §D "mobile pass deferred"). Build 06–10 mobile-first from the tokens with no mockup, or hold for a design pass? | Build mobile-first; design reviews the result before release. |
| Q5 | The advisory hue is not in D4 (only warning `#8b0000`, watch `#2e6b4f`). Proposed AA amber `#8a4b00` (white-text contrast ≈ 6.8:1) with `faCircleInfo`. OK? | Yes, pending design confirmation. |
| Q6 | Zones as their own table (**decided with Q-28, Tom 10/29: own table, in F01's M1**) — and should a default zone be auto-created with the Weather Desk outlet? | Own table; no auto-create beyond story 15's sample. |
| Q7 | D4-009 says **monospace** product text, while the evidence cites "Public Sans product type". Monospace for the product body (furniture, IBW values as plain sans) and Public Sans/plain sans for chrome? | Monospace for `ProductText` only. |
| Q8 | Units and locale: US customary (°F, mph, inches) with US-style hazard vocabulary — any non-US exercises in December? | US customary only. |
| Q9 | The epic's §5 Open questions ends mid-sentence ("1. Should the weather timeline …"; the file is truncated). Is there a lost question to restore? | None assumed; timeline = scheduled content (this feature's decision). |
