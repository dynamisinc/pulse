# Implementation: Exercise Portal ("[City] Today") and TTX display mode

> The bridge between planning and orchestration (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Phase/release: December release (Tom, 10/21).**
> Foundation contracts are referenced by name (`FC-n`, story `F##`) from [`../channels-foundation/implementation.md`](../channels-foundation/implementation.md) and **never redefined**.
> The portal's own small contract set is `PC-1..PC-6` below; story 02 freezes it. Changing a `PC-n` after E3 Wave 1 needs the orchestrator (additive only).
> Every foundation/platform gap the portal found is **resolved** (§ Foundation follow-ups — resolved); the combined cross-feature wave view is in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md) (E3-1 = CW2 for 01/02, E3-2 = CW3, E3-3 = CW4 except **12 moves to CW5** behind weather 10, **16 moves to CW5** behind F17, E3-4 = CW5 except **21, which can start in CW4** (all its dependencies are merged by CW3), E3-5 = CW6). **Re-scoped 10/29 (Tom): kiosk-lite only (Q-35) — stories 05, 08 and 20 are Deferred (post-December), 18/19 are re-scoped to kiosk-lite and 01 shrank to S because its schema is folded into F01's M1 (Q-28).**

Backend root: `src/Pulse.WebApi/Features/Portal/` (new; `Contracts/`, `Data/`, `Config/`, `Resources/`, `Seed/`; the Deferred `Display/Sessions/` and `Display/Control/` are not created in December). Entities: `src/Pulse.WebApi/Data/Entities/`.
Frontend roots: `src/frontend/src/features/portal/` (participant: `contract/ mocks/ skin/ masthead/ layout/ modules/ alerts/ resources/ kiosk/ testing/`);
staff: `features/controller/portalSetup/`, `features/controller/topStoriesBoard/` (`features/controller/display/` is Deferred). E3 imports `features/channels/` and never edits it.

---

## Portal contracts (frozen by story 02)

### PC-1 Vocabulary (`Features/Portal/Contracts/PortalVocabulary.cs`, `features/portal/contract/vocabulary.ts`)
| Name | Values |
|---|---|
| `PortalModuleId` | `topStories` (news) · `socialStream` (social) · `trending` (social) · `pressLatest` (press) · `weather` (weather). Each maps to exactly one source `ChannelId`; a module is **available** only when its source channel is enabled (F08). Additive registry (`registerPortalModule`, PC-5). |
| `PortalLayoutKey` | `anchor` only in December (hero left + right rail). `band` / `grid` are parked (D2-003). |
| `DisplayMode` | **Deferred (post-December, Q-35):** `pinned` (one target held) · `playlist` (ordered targets, auto-cycle); a one-shot **show-next** interrupt overlays either. Not built in December. |
| `DisplayTargetKind` | **Deferred (post-December, Q-35):** `portal` · `feed` · `content` · `post` · `alerts`. December's kiosk-lite shows the `portal` composition only. |
| Limits | ≤ 25 resources; (playlist ≤ 20 items, dwell 5-120 s and ≤ 10 displays are Deferred); masthead name ≤ 60 chars; `ModulesJson` / `SkinOverridesJson` ≤ 4 KB. |

### PC-2 Entities (`Data/Entities/`, `IExerciseScoped`, behind the `PulseDbContext` central filter + write guard; **created by foundation F01's M1** (Q-28, Tom 10/29) — this feature adds no migration)
| Entity | Columns (beyond `Id`, `ExerciseId`) |
|---|---|
| `PortalConfig` (0..1 per exercise; absent row = defaults) | `PortalName?` · `CityName?` · `Tagline?` · `LogoMediaId?` · `LayoutKey` · `ModulesJson` (ordered `[{id, enabled}]`) · `SkinOverridesJson?` (the FC-3b token subset, validated) · `Version` |
| `PortalResource` | `Title` · `Summary?` · `BodyHtml?` (sanitized at write) · `MediaAssetId?` · `SortOrder` · `Visible` · `DeletedAt?` · `Version` |
| `PortalDisplay` — **Deferred (post-December, Q-35): not created in M1** | `Name` · `TokenHash` (unique, `SessionTokens.Hash`) · `TokenProtected?` (Data Protection copy, reprintable, EL-5) · `Generation` · `RevokedAt?` · `Mode` · `PinnedTargetJson?` · `PlaylistJson?` · `DwellSeconds` · `ShowNextJson?` · `StateVersion` · `LastSeenWallClock?` · `CreatedWallClock` · `ActingHumanId` |

### PC-3 Wire shapes (the `DisplayStateDto` / `DisplayStaffDto` blocks below are **Deferred, post-December, Q-35**; camelCase; C# records in `Features/Portal/Contracts/`, TS types + runtime guards in `features/portal/contract/`). Participant DTOs never carry a token, hash, `version`, `actingHumanId`, wall clock, `lastSeen`, or another display's state (XC-002); all URLs are host-relative (FC-9.3).
```jsonc
// PortalDto — GET /api/portal  (participant; RequireChannelEnabled('portal'))
{ "masthead": { "name": "Atlanta Today", "tagline": "…|null", "logo": { /* ContentMediaDto (FC-3) */ } | null },
  "layoutKey": "anchor",
  "modules": [ { "id": "topStories", "channelId": "news" }, { "id": "socialStream", "channelId": "social" } ],   // ordered, enabled + available only
  "skinOverrides": { /* partial OutletSkinTokens (FC-3b) */ } | null,
  "hasResources": true }

// PortalResourceDto — GET /api/portal/resources, /{id}  (participant: Visible only)
{ "id": "guid", "title": "…", "summary": "…|null", "bodyHtml": "<sanitized>|null", "media": { /* ContentMediaDto */ } | null }

// DisplayStateDto — GET /api/display/state  (display session only; ETag = stateVersion)
{ "stateVersion": 12, "mode": "pinned|playlist", "dwellSeconds": 20,
  "items": [ { "kind": "content", "permalink": "/weather/weather-desk/tornado-warning-1" }, { "kind": "post", "postId": "guid" }, { "kind": "portal" } ],
  "showNext": { /* one item */ } | null }

// DisplayStaffDto — staff GET /api/displays
{ "id": "guid", "name": "Basement screen", "mode": "playlist", "items": [ … ], "dwellSeconds": 20, "showNext": null, "stateVersion": 12,
  "connected": true, "lastSeenWallClock": "…|null", "revoked": false, "generation": 2, "link": "https://<exercise-host>/display/<token>|null", "needsReissue": false }
```
*(Deferred, with the two blocks above.)* The `link` in `DisplayStaffDto` is **staff-only** and necessarily absolute (the easy-login `joinUrl` precedent, EL-6); it is built by the same builder and is exempt from F19's participant-DTO tripwire. It is never in a participant or display DTO.

### PC-4 Routes
**Participant API** (live session, resolved exercise scope, **no `exerciseId` in any URL or body**): `GET /api/portal` (behind `RequireChannelEnabled('portal')`), `GET /api/portal/resources`, `GET /api/portal/resources/{id}`.
**Display API — Deferred (post-December, Q-35):** `POST /api/auth/display { token }`, `GET /api/display/state`. December's kiosk-lite uses the existing `POST /api/auth/shared` (view-only code) and the ordinary participant routes.
**Staff API** (`EngineCockpitStaffAuthorizationFilter` + a controller/planner role filter, the `InjectEndpoints` / `RosterStaffRoleFilter` pattern; allowed for a disabled `portal` channel, like F08): `GET|PUT /api/portal/config` ·
`GET|POST|PUT|DELETE /api/portal/resources*` (+ `/reorder`) · (`/api/displays*` Deferred) ·
`POST /api/portal/filler/seed` (story 21).
**Participant UI routes** (inside the shell; FC-4 already lists `/portal`): `/portal` · `/portal/resources`. **Kiosk-lite:** `/portal?display=1` (an ordinary `/portal` route; `KioskGate` honors the parameter for read-only sessions only). `/display/:token` is **Deferred**.
These route families are listed in foundation FC-4 § "Channel-owned route families" (FU-3 resolved).

### PC-5 Frontend seams (`features/portal/`, barrel `index.ts`)
`contract/` (PC-3 types + guards) · `mocks/` (normal-day / Staged, incident-day, empty-subsets fixtures; kiosk-lite reuses them) · `layout/` (`PortalLayout`, `ModuleFrame`, **`registerPortalModule({ id, channelId, region, order, Component, DisplaySlide? })`**) ·
`skin/` (`portalTokens`, `PortalSkinScope`) · `alerts/` (`usePortalWorldState`, `AlertsEntry`) · `modules/<id>/` (one folder per module, each ending in a `register.ts`) · `kiosk/` (`KioskGate`, `useKioskMode`, `KioskFrame`, `board/KioskPortalBoard`; `useDisplayState` / `SlideRegistry` Deferred).
`ModuleFrame` provides `trackClick(moduleId, target)` so modules never emit telemetry themselves.

### PC-6 Telemetry (XC-004 v0 envelope; the event-type strings are registered once by foundation story 02, FC-6b — this table owns the payload/target shapes). `channel` = `portal` unless stated
| `eventType` | Emitter | `target` | Notes |
|---|---|---|---|
| `portal_view` | client (17) | `{ entityType: 'portal' }` | once per mount per session; labeled session-level in E10 |
| `portal_module_click` | client (07 `trackClick`) | `{ entityType: 'portal_module', entityId: moduleId }` + `payload.contentId?` | one per link activation |
| `resource_view` | client (15) | `{ entityType: 'portal_resource', entityId }` | |
| `portal_config_changed` | server (03, written from 16) | `{ entityType: 'portal', entityId: portalConfigId }` | actor = the staff human; `payload.fields` (changed field names only, never values) |
| `display_command` | **Deferred** (server, 08) | `{ entityType: 'display', entityId: displayId }` | actor = the staff human; `payload.command` |
| `display_session_started` | **Deferred** (server, 05) | `{ entityType: 'display', entityId: displayId }` | **PRT-041:** actor is `{ kind: 'display', displayId }`; **no person attribution, no `actingHumanId`** (review finding D9); the display client emits nothing (no double count) |

---

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 | **No entities, no migration** (Q-28, Tom 10/29: `PortalConfig` and `PortalResource` are created by F01's M1; `PortalDisplay` does not exist, Q-35). Owns the `PortalLimits` guard, the AAR export query, the "absent row = defaults" rule and the isolation + schema-contract tests (a PC-2 drift fails the build). | `Features/Portal/Data/**`, `Pulse.WebApi.Tests/Portal/Data/**` | `PortalLimits`, PC-2 contract test |
| 02 | Contract-first: C# records, TS types + guards, fixtures (normal/Staged, incident, empty subsets; kiosk-lite reuses them), `PortalVocabulary` (no display vocabulary), interfaces `IPortalConfigService`, `IPortalResourceService` (`IDisplayService` and the display DTOs are Deferred); asserts the PC-6 event types exist (registered by F02). | `Features/Portal/Contracts/**`, `features/portal/contract/**`, `features/portal/mocks/**` | PC-1, PC-3, PC-5 names |
| 03 | `PortalConfigService`: default masthead resolution (`PortalName ?? "{CityName} Today" ?? fallback`), module list = stored order ∩ enabled channels (F08 `IChannelEnablement`), logo media ownership check, `skinOverrides` validated by F03's public `ISkinOverridesValidator`, `Version` concurrency. | `Features/Portal/Config/**` | `/api/portal`, `/api/portal/config` |
| 04 | `PortalResourceService`: CRUD, reorder, sanitize via the F04 rich-body profile, soft delete, participant read of `Visible` only. | `Features/Portal/Resources/**` | `/api/portal/resources*` |
| 05 | **Deferred (post-December, Q-35).** `DisplaySessionService`: token mint / hash / protect, `POST /api/auth/display`, rotate / revoke, staff list/create/link; needs PP-1; Tier-2 review. | — | — |
| 06 | `portalTokens` (broadcast direction, FC-3b `OutletSkinTokens`) + `PortalSkinScope` (a thin wrapper over F13's token-object `SkinScope`, registered with `registerSkinTokens('portal', …)`) + masthead (name, logo, tagline, scenario dateline via `ScenarioDateline`). | `features/portal/skin/**`, `features/portal/masthead/**` | `PortalSkinScope`, `PortalMasthead` (with `alertsEntry` slot) |
| 07 | Registry + `PortalLayout` (grid-template-areas, `anchor`), `ModuleFrame` (section heading, "See all →" link, empty/hidden handling, `trackClick`), test harness that renders any subset of modules. | `features/portal/layout/**` | `registerPortalModule`, `PortalLayout`, `ModuleFrame` |
| 08 | **Deferred (post-December, Q-35).** `DisplayControlService` + `DisplayStateEndpoint` (ETag), `show-next`, version bump, `LastSeen` heartbeat. | — | — |
| 09 | `useTopStories` over F15 `useContentList({channelId:'news', featured:true, limit:7})`; lead + grid; coalesced stream merge; filler appears as ordinary stories. | `features/portal/modules/topStories/**` | `TopStoriesModule`, `useTopStories` (also used by the kiosk-lite board, 19) |
| 10 | Compact read-only post list inside the social brand scope, burst coalescer, Pause control, trending chips — all from the `features/social` barrel (F21 / R-S1). | `features/portal/modules/socialStream/**` | `SocialStreamModule`, `useSocialExcerpt` (also used by the kiosk-lite board, 19) |
| 11 | `usePressLatest` over F15 `useContentList({channelId:'press', limit:5})`; letterhead-text rows. | `features/portal/modules/pressLatest/**` | `PressLatestModule` |
| 12 | Thin mount of weather 10's `WeatherWidgetTile` + `useWeatherSummary` in the rail; passes through skin variables. | `features/portal/modules/weather/**` | `WeatherModule` |
| 13 | `usePortalWorldState()` = highest active severity from the shell's `useAlerts()`; `WorldStateFrame` sets `data-world-state` and swaps a bounded set of CSS custom properties. No text. | `features/portal/alerts/worldState*` | `usePortalWorldState`, `WorldStateFrame` |
| 14 | `AlertsEntry` (bell icon + "Alerts" text + active count) linking to the shell's `/alerts`; no new history page. | `features/portal/alerts/AlertsEntry*` | `AlertsEntry` |
| 15 | `/portal/resources` page, `useResources`, non-news costume, `SanitizedBody`. | `features/portal/resources/**` | `ResourcesPage`, `ResourcesLink` |
| 16 | COBRA surface `/staff/portal-setup`: masthead form, module toggles + order, resources manager, preview-as-participant frame. | `features/controller/portalSetup/**` | surface component for the staff registry |
| 17 | `registerChannel({ id:'portal', pathPrefix:'/portal', landing })`, `PortalChannel` assembling skin > world-state > masthead > layout, `usePortal`, `portal_view`, loading / error shells, route focus + title. | `features/portal/PortalChannel.tsx`, `features/portal/hooks/usePortal.ts*`, `features/portal/index.ts`, `features/portal/modules/index.ts` is **orchestrator-owned** | `PortalChannel` |
| 18 | **Kiosk-lite frame (Q-35).** `KioskGate` (orchestrator-wired above `PortalChannel` at `/portal`; honors `?display=1` only for read-only sessions), `useKioskMode`, `KioskFrame` (kiosk variant: no chrome, no nav, alert bar kept, EXERCISE chip, large type, wake lock, silent refresh, neutral re-sign-in notice), consuming the shell's kiosk variant (PP-2: participant-shell/06 AC2 + the `isWatermarkRequired` kiosk clause, built outside this feature). **No new credential, no `/display/:token`, no identity change.** | `features/portal/kiosk/frame/**` | `KioskGate`, `KioskFrame`, `useKioskMode` |
| 19 | **Kiosk-lite board (Q-35).** `KioskPortalBoard`: one big-screen composition of the portal over the module hooks (lead + three, alert count, weather tile `size='display'`, trending), live in-place updates, burst coalescer, no auto-cycle. Playlist/pinned/show-next, `useDisplayState` and the per-kind renderers are Deferred. | `features/portal/kiosk/board/**` | `KioskPortalBoard` |
| 20 | **Deferred (post-December, Q-35).** COBRA surface `/staff/display`: displays list, link + QR, picker, show-next, playlist builder. | — | — |
| 21 | `FillerSeedService` + a versioned pack (`filler-pack.v1.json`): idempotent via `ExternalSource='pulse-filler-v1'` / `ExternalRef`, through `IContentPublishService`. | `Features/Portal/Seed/**` | `POST /api/portal/filler/seed` |
| 22 | COBRA board listing featured news by rank with the portal's current lead read-out; reorder via F07 `feature`. | `features/controller/topStoriesBoard/**` | surface component |
| 23 | Portal additions to the F20 kit: isolation, axe sweep, static scans, burst bench, subset matrix, alert end-to-end, kiosk-lite read-only. | `Pulse.WebApi.Tests/Portal/**`, `features/portal/testing/**`, `e2e/portal/**` | none |

## Reuse map
- **Foundation (FC-n):** FC-3 content / alert / media DTOs and runtime guards; FC-4 read routes (`featured=true` ordering, optional `outlet`, `limit`); FC-5 `ContentPublished|Revised|Retracted`, `AlertsChanged`; FC-7 `IChannelEnablement`,
  `RequireChannelEnabled`; FC-8 `useContentList`, `useChannelStream`, `useEnabledChannels`, `registerChannel`, `ChannelNotFound`, `OutletSkinScope` / token schema, `ScenarioDateline`, `WatermarkSlot`, `SanitizedBody`,
  `ContentMedia`, `LiveRegionAnnouncer`; FC-9 rules 1-10 (inherited in full).
- **Shell:** `participant-shell` (`ShellLayout`, the single alert bar host, `useAlerts`, `AlertsHistory` / `/alerts`, `ChannelNav`, `mountContract` `variant` incl. `kiosk` + `affordancesAvailable`, `OverlayLayer`,
  `BrandThemeProvider`, `isWatermarkRequired`), `ParticipantLandingGuard` / `landingSelection` (read-only sessions keep `all-posts` inside Social; the portal landing is F12's).
- **Social:** `PostCard` (barrel), `SocialBrandScope`, `useTrending` + `trendingTopics`, `useExploreBaseline` / feed store, `socialPaths` route helpers (all exported from the barrel by foundation story 21 / R-S1).
- **Identity / login (kiosk-lite):** the existing `POST /api/auth/shared` view-only login (`SharedReadOnlyLoginService`: `readonly` session, ephemeral identity, `actor.kind: 'system'`), `ReadOnlySessionWriteFilter`, the login page's "View-only code" tab — **reused unchanged, no identity edit**. (Easy-login `SessionTokens`, `/join/:token` handling, `PreAuthAllowlist`, link-card QR and `IsParticipantSignInAllowed` were for the Deferred display credential.)
- **Clock:** `core/clock` (`useScenarioTime`, `formatScenarioTime`), `GET /api/clock`, `ScenarioClockChanged`. **Media:** `Features/Media/*`, `core/media`, `ExerciseBands`. **Telemetry:** `core/telemetry` emitter + `KNOWN_TELEMETRY_EVENT_TYPES`, server sink.
- **Staff:** COBRA theme + `@/theme/styledComponents`, `staffRouteRegistry`, preview-as-participant frame (COR-041), `EngineCockpitStaffAuthorizationFilter`, `RosterStaffRoleFilter`-style role filter, F07 content API, F17 shell conventions.
- **Frontend plumbing:** shared axios client `core/services/api.ts`, `validateEnv.ts`, React Query (`core/services/queryClient.ts`), FontAwesome only (never `@mui/icons-material`), MUI 9 `sx`-only props, 2-space/no-semicolon lint.

## Wave Plan (DAG-ready)
`E3 wave` numbering starts when foundation Wave 2 is merged. Foundation story numbers are `F##`; channel stories are `news NN`, `press NN`, `weather NN`; `R-x` = a request (below). A frontend story against a real route
waits for that route's story (serial edge: PC-3/PC-4 and FC-3/FC-4 are the seam); until then it runs on the fixtures behind the axios client.

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Data model: limits guard + isolation tests (schema is F01's **M1**) | backend | `Features/Portal/Data/**`, `Pulse.WebApi.Tests/Portal/Data/**` (no entity, DbSet or migration: F01's) | F01 (M1 merged, with the folded portal tables) | 02 | 1 | S |
| 02 Wire contracts + fixtures | fullstack | `Features/Portal/Contracts/**`, `features/portal/contract/**`, `features/portal/mocks/**` | F02 | 01 | 1 | M |
| 03 Config API | backend | `Features/Portal/Config/**` | 01, 02, F03 (`ISkinOverridesValidator`), F08 | 04, 06, 07 | 2 | M |
| 04 Resources API | backend | `Features/Portal/Resources/**` | 01, 02, F04 (sanitizer profile), F08 | 03, 06, 07 | 2 | M |
| 05 Display sessions | backend | **Deferred (post-December, Q-35)** | (01, 02, F08, PP-1) | — | — | (L) |
| 06 Skin + masthead | frontend | `features/portal/skin/**`, `features/portal/masthead/**` | 02, F13 (`SkinScope`, `registerSkinTokens`), F14 | 03, 04, 07 | 2 | M |
| 07 Module frame + layout | frontend | `features/portal/layout/**` | 02, F08 (`useEnabledChannels`), F14 | 03, 04, 06 | 2 | M |
| 08 Display state + control API | backend | **Deferred (post-December, Q-35)** | (01, 02, 05, F06) | — | — | (M) |
| 09 Top Stories | frontend | `features/portal/modules/topStories/**` | 02, 07, F06 (mock until live), F09, F13, F14, F15 | 10-16 | 3 | L |
| 10 Social Stream + Trending | frontend | `features/portal/modules/socialStream/**` | 02, 07, **F21**, F15 | 09, 11-16 | 3 | L |
| 11 Press latest | frontend | `features/portal/modules/pressLatest/**` | 02, 07, F06, F15, press 01 (release summary; R-P1 applied there) | 09, 10, 12-16 | 3 | S |
| 12 Weather mount | frontend | `features/portal/modules/weather/**` | 07, **weather 10** (+ weather 03 types; `size` prop applied there) | 09-11, 13-16 | 3 | S |
| 13 World-state + alert placement | frontend | `features/portal/alerts/worldState*`, `features/portal/alerts/WorldStateFrame*` | 02, 06 (CSS variable names), F11 | 09-12, 14-16 | 3 | M |
| 14 Alerts entry + absorption | frontend | `features/portal/alerts/AlertsEntry*` | 02, F10, F11 | 09-13, 15, 16 | 3 | S |
| 15 Resources shelf | frontend | `features/portal/resources/**` | 02, 04 (route; mock until live), F14 | 09-14, 16 | 3 | M |
| 16 Console portal setup | frontend (staff) | `features/controller/portalSetup/**` | 03, 04, 07 (module ids), F17 | 09-15 | 3 | L |
| 17 Mount, landing, telemetry | frontend | `features/portal/PortalChannel.tsx`, `features/portal/hooks/usePortal.ts*`, `features/portal/index.ts` | 03, 06, 07, 13, 14, F12, F08, F15 (telemetry emitter), modules 09-12 registered (seam) | 18, 19, 21, 22 | 4 | L |
| 18 Kiosk-lite frame (`/portal?display=1`) | frontend | `features/portal/kiosk/frame/**` | 06, 07, **PP-2 = foundation 22** (#788; shell kiosk variant + watermark clause), F11, F12 | 17, 19, 21, 22 | 4 | M |
| 19 Kiosk-lite portal board | frontend | `features/portal/kiosk/board/**` | 09, 10, 11, 12 (hooks), 18 (frame contract, same wave: ship the `KioskFrame` props type first), F14, F15, F21, weather 10 | 17, 21, 22 | 4 | M |
| 20 Console display control | frontend (staff) | **Deferred (post-December, Q-35)** | (05, 08, F07, F17) | — | — | (L) |
| 21 Evergreen filler pack | backend | `Features/Portal/Seed/**` | 03 (seeds outlets via F03), F04, F05, F07 | 17-19, 22 | 4 | M |
| 22 Console Top Stories board | frontend (staff) | `features/controller/topStoriesBoard/**` | F07 (`feature`), F17 | 17-19, 21 | 4 | S |
| 23 Conformance | testing | `Pulse.WebApi.Tests/Portal/**`, `features/portal/testing/**`, `e2e/portal/**` | all above, F20 | — | 5 | M |

Notes on disjointness: 13 / 14 own distinct files in `features/portal/alerts/`; 18 / 19 own distinct subfolders of `kiosk/` (`frame/`, `board/`); **19 depends on 18's `KioskFrame` props type**, so 18 publishes `kiosk/frame/types.ts` first in the wave (or 19 starts against the type
declared in 02's contract fixtures). 17 depends on modules 09-12 only through the orchestrator-owned registration file, so it can start when 07 lands and test against the harness.

### Integration seam (orchestrator-owned — never a wave story)
| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | `AddPortal()` / `MapPortal()` added by the orchestrator in the same PR as each backend story (03, 04, 21; 01 adds only the guard, no routes); each ships a `WebApplicationFactory<Program>` wiring test (routes mapped, services resolve). |
| Migration order | `Migrations/*`, `PulseDbContextModelSnapshot.cs` | **E3 adds no migration** (Q-28, Tom 10/29): `PortalConfig` and `PortalResource` are created by foundation F01's **M1** ([ledger](../channels-foundation/implementation.md#migration-ledger)); `PortalDisplay` is Deferred. Only press 06's M2 follows M1. |
| Pre-auth allowlist | `PreAuthAllowlist`, `DefaultDenySessionGateTests`, `AnonymousAccessRegressionTests` | **Nothing changes in December**: kiosk-lite adds no anonymous route (the Deferred `POST /api/auth/display` was the only one). |
| Identity seam | `Features/Identity/**` | **None in December.** PP-1 (session purpose `display`, `TelemetryEnvelopeAuthority` actor kind) is Deferred with story 05; kiosk-lite reuses the existing `readonly` session. |
| Portal module registry | `features/portal/modules/index.ts` | One import line per module story's `register.ts` (09-12, 15); added by the orchestrator after each merges. |
| Channel registry | `features/channels/routing/registry.ts` | Story 17 adds one `registerChannel()` call at its mount point; the registry file is F12's. |
| Participant composition root | `src/frontend/src/App.tsx` / `createRoleAwareRoutes` | Orchestrator wires story 18's `KioskGate` as an element wrapping the `/portal` route (above `PortalChannel`; it is a no-op without `display=1`). `/portal` is still mounted by F12's `ChannelRouter`, not by App.tsx; there is **no** `/display/:token` route in December. |
| Staff route registry | `features/staff/staffRouteRegistry` | Orchestrator adds two entries: `portal-setup` (16) and `top-stories-board` (22). (`display` (20) is Deferred.) |
| Hosting headers | — | **None in December.** The `/display/*` `no-referrer` / `no-store` headers (PP-3's second half) were for the Deferred `/display/:token` route. |
| Shell kiosk variant | `participant-shell` `ShellLayout.tsx`, `chromeConfig.ts` | **PP-2 = foundation story 22** (#788), merged by end of CW4 before story 18 starts; not a portal story. |

---

## Foundation follow-ups — resolved
All nine follow-ups and the four channel requests were resolved in the December consolidation pass; **none remains open and the private-scope, stricter-allowlist, adapter-file and sequential-reorder fallbacks are dropped.** Source of truth:
[`channels-foundation/implementation.md` § Follow-up resolution ledger](../channels-foundation/implementation.md#follow-up-resolution-ledger) and [§ Platform prerequisites](../channels-foundation/implementation.md#platform-prerequisites).
| # | Gap | Resolved in |
|---|---|---|
| FU-1 | Three portal tables vs "only F01/F16 own migrations" | **Folded into F01's M1** (Q-28, Tom 10/29), minus `PortalDisplay` (Deferred, Q-35). Story 01 keeps the guard and tests only. |
| FU-2 | Telemetry vocabulary (`portal_*`, `resource_view`, `display_*`) | **FC-6b**, registered once by **F02**; story 02 asserts. |
| FU-3 | FC-4 additions (`/portal/resources`, `/api/portal*`; the Deferred `/display/:token`, `/api/display*`, `/api/displays*`) | **FC-4** "Channel-owned route families" + **F12** AC (channel owns sub-routes). |
| FU-4 | Token-object skin scope; reusable server-side override validator | (a) **F13** `SkinScope` + `registerSkinTokens`/`registerSkinExtension`; (b) **F03** public `ISkinOverridesValidator` (`ext.portal`). |
| FU-5 | `display` session purpose + actor kind (E1 identity) | **Platform prerequisite PP-1 — Deferred (post-December)** with the display credential. Verified: **kiosk-lite needs no identity change** (the shared view-only login already mints `readonly` sessions with an ephemeral identity). |
| FU-6 | Per-display realtime group | **PP-4**, parked; no display state exists in December. |
| FU-7 | participant-shell/06 AC2 kiosk chrome | **Platform prerequisite PP-2**, built as foundation story 22 (#788). Story 18 no longer edits `ShellLayout.tsx`. |
| FU-8 | Atomic multi-item featured reorder | **F07** `POST /api/content-items/feature/reorder`; story 22 uses it. |
| FU-9 | `isWatermarkRequired` true for `variant === 'kiosk'` | **PP-2**, foundation story 22 (#788) ships the helper clause; story 18 tests the frame. |

## Channel requests — resolved
| # | To | Request | Resolved in |
|---|---|---|---|
| R-S1 | Social (E2) | Barrel exports (`useTrending`, `SocialBrandScope`, route helpers), bounded recent-posts hook, read-only `PostCard` | **Foundation story 21** (new). Stories 10 and 19 depend on F21. |
| R-W1 | Weather (E6) | `WeatherWidgetTile size='display'`, no `aria-live` on display, any participant scope | **Applied in weather story 10** (new AC + props). |
| R-P1 | Press (E5) | Non-empty `dek`, org name as `outlet.name`, embargoed never listed | **Applied in press stories 01 (`ReleaseDek`, summary guarantees), 04, 05, 09, 15.** |
| R-N1 | News (E4) | Courtesy: hero `width`/`height`, authored-only kicker | Nothing to change: FC-3 `ContentMediaDto` already carries `width`/`height`; news never invents a kicker. |

## Conflicts found between the sources (decisions applied)
| # | Conflict | Decision applied |
|---|---|---|
| C-1 | D2 recommends visible top-level site-header links ("News · Pulse · Wire Room · Weather"); SHELL-CONTRACT says channels never render cross-channel nav and the shell owns the nav strip. | The shell's strip is the nav (PRT-020). The portal adds **in-content** "See all →" links in each module header, which are not navigation chrome (D7-compliant). Q-E3-3 asks Tom if a header link row is still wanted. |
| C-2 | D2-004 makes the emergency lead kicker read "● EMERGENCY · LIVE UPDATES" and "WATCH LIVE goes red". FC-9.5 / SOC-002: the platform adds no BREAKING-style chrome inside a channel. | Mood shift is **non-textual** (tint, under-rule, tokens); any kicker text is the lead story's own authored `kicker`. Q-E3-5. |
| C-3 | D2-005 says Trending "always renders"; trending is derived from social posts. | Trending hides when `social` is disabled (no data source); everything else in D2-005 holds (module + link hide together). |
| C-4 | D2-007 puts a real wall-clock schedule on the Resources shelf; COR-053 forbids wall clock in-fiction. | Resources is the sanctioned out-of-fiction surface: the platform renders **no** time there; the planner's authored text may contain real times. Q-E3-8. |
| C-5 | participant-shell/06 strips compliance chrome in kiosk; COR-031/NFR-008 forbid chrome **and** watermark both off. | Kiosk always draws the EXERCISE chip (PP-2, Q-E3-2 = DECEMBER-RELEASE Q-33). |
| C-6 | PRT-040 says "login-free"; every other participant route needs a session (XC-001). | **December (Q-35):** kiosk-lite is *not* login-free — the facilitator signs the screen in once with the existing shared view-only code, which yields a read-only session scoped to one exercise by host resolution. The revocable per-display bearer link (a "login-free" feel without anonymous data access) is Deferred. The epic's PRT-040 text is not edited; see DECEMBER-RELEASE A-13. |
| C-7 | PRT-004 says top stories are "controller-ordered with fallback to most-recent"; F06 orders `featured=true` that way across outlets already. | Composition only; no portal-side ordering logic beyond lead/grid split (story 09). |

## Schedule risk and cut order
Critical path (re-scoped 10/29): **F06/F13/F14/F15 → 07 → 09/10 → 17** for the portal, and **06/07 → PP-2 → 18 → 19 → 23** for kiosk-lite (no longer behind a new credential, a Tier-2 security review or the allowlist counts: stories 05, 08 and 20 are Deferred).
The riskiest pieces now: the burst-safe social excerpt (10), the dependency on a weather import (12), and PP-2 (the shell's kiosk variant) for 18.
**Cut order if the date forces it (first = cut first):**
1. **22** Top Stories board — F17's per-item pin satisfies PRT-004.
2. **21** filler starter pack — planners author `background` news in F17; the Staged portal is sparse but valid.
3. **12** weather mount — if weather 10 slips the module hides cleanly (a subset the layout already supports).
4. **PDF attachments** in 15 / 04 — resources are text and images; the PDF is a download-only link once press 02 (download-only) lands.
5. **Module order/toggle UI** in 16 — fixed order; channels still hide via enablement (PRT-003 "configurable" degrades to per-exercise on/off through exercise settings).
6. *(proposed)* **18 / 19 kiosk-lite** — the TV opens `/portal` in a normal browser instead; PP-2 and the kiosk board drop.
*(Applied 10/29, no longer cut candidates: the old items "playlist parts of 19/20" and "05/08 kiosk credential → kiosk-lite" — they are Deferred outright, Q-35.)*
**Not cuttable:** 01, 02, 03 (masthead), 06, 07, 09, 10, 13, 17, and the isolation / a11y / two-worlds / scenario-time / burst parts of 23. The portal-first-versus-kiosk-first question (Q-E3-11) is answered: portal first.


## Open questions for Tom
Consolidated and de-duplicated in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md#6-open-questions-for-tom): Q-E3-1 → Q-32, Q-E3-2 → Q-33, Q-E3-3 → Q-34, Q-E3-4 and Q-E3-11 → Q-35, Q-E3-5 → Q-36, Q-E3-6 → Q-11, Q-E3-7 → Q-37, Q-E3-8 → Q-38, Q-E3-9 → Q-39, Q-E3-10 → Q-40, Q-E3-12 → Q-41; conflicts C-1..C-7 → § 7 (Epic and design amendments flagged but not made) there. Defaults below are what the stories assume.
| # | Question | Default assumed |
|---|---|---|
| Q-E3-1 | Where does "[City]" come from? Exercises have a name and time zone but no city. | A `CityName` field in portal config (story 16). Unset: the masthead reads the neutral **"Local Today"** and the go-live checklist flags it. Never the exercise name (it would leak the exercise into the fiction). |
| Q-E3-2 | Kiosk and compliance chrome: shell/06 strips both banners in kiosk. A basement screen may be seen by non-participants. Keep banners, or strip them and rely on a permanent EXERCISE chip? | Strip banners (D2 "zero chrome"), **always** draw the EXERCISE chip (NFR-008). A per-exercise "keep banners on displays" flag is a one-line follow-up. |
| Q-E3-3 | Add D2's visible header link row (News · Pulse · Wire Room · Weather) in the portal despite SHELL-CONTRACT's "channels never render cross-channel nav"? | No: shell strip + in-module "See all →" links (C-1). |
| Q-E3-4 | **Decided (Q-35, Tom 10/29): kiosk-lite only** — the existing shared view-only login on `/portal?display=1`; no new credential. Original question: new revocable display link vs the shared login; expiry; screens per exercise. | **Kiosk-lite.** The new display link (no expiry until revoked, up to 10 displays) is Deferred, post-December. |
| Q-E3-5 | D2-004's "● EMERGENCY · LIVE UPDATES" kicker and red "WATCH LIVE": platform-generated text inside the fiction (C-2). Keep or drop? | Drop the text; keep a non-textual mood shift. Controllers carry the message in the lead story's own kicker. |
| Q-E3-6 | There is **no mobile design** for the portal (D2 deferred it) and none for the kiosk. Build mobile-first without a mockup? | Yes: single-column stack, specified in ACs; a mobile mockup pass is a follow-up. Kiosk is 16:9 at 1920×1080 only. |
| Q-E3-7 | Is COR-052 module advancement (exercise-clock/03, Not Started) in December? | No. The kiosk follows live content; a clock jump publishes scheduled items and the portal updates. Module stepping UI is exercise-clock's. |
| Q-E3-8 | Resources shelf: external links and real wall-clock text (D2-007)? | No external links (FC-9.3), text + images + (later) PDF; authored text may contain real times; the platform renders none. |
| Q-E3-9 | Top Stories scope: News only, or also featured press releases and weather warnings? | News only. Press and Weather have their own modules; a controller who wants a warning on the TV uses the kiosk. |
| Q-E3-10 | Who is the TTX "facilitator" role? | Controller or planner (the existing roles). No new role. |
| Q-E3-11 | **Decided (Q-35, Tom 10/29): portal first, kiosk-lite only.** | Portal first; kiosk-lite ships, the credential and remote control are post-December. |
| Q-E3-12 | Visual direction and layout: ship **broadcast + anchor** only (D2-002/003 had three of each)? | Yes. Print is parked (collides with the Courier-Ledger skin, D3 note). |
