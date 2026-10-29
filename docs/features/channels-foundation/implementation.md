# Implementation: Channels foundation

> The bridge between planning and orchestration (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Phase/release: December release (Tom, 10/21).**
> The E4 / E5 / E6 / E3 decomposers reference the **named contracts below** (`FC-n`) instead of redefining them. Anything not named here is the
> channel's own. **Changing a frozen contract after Wave 1 needs the orchestrator** (additive changes only: new optional fields, new kinds, new events).
>
> **Consolidation pass (docs-only, 10/29):** the channel features' "foundation follow-ups" (news FU-1..9, press FU-1..9, weather FU-1..8, portal FU-1..9) were de-duplicated and folded in here
> *before* Wave 1 started, so every change below is made to the **unbuilt** contract, not a post-freeze amendment. Where each item landed is in
> [§ Follow-up resolution ledger](#follow-up-resolution-ledger); the one migration sequence is in [§ Migration ledger](#migration-ledger); items that belong to the platform, not this feature, are in
> [§ Platform prerequisites](#platform-prerequisites). The combined cross-feature view is [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md).

Backend root: `src/Pulse.WebApi/Features/Channels/` (new). Entities: `src/Pulse.WebApi/Data/Entities/`. Frontend shared root:
`src/frontend/src/features/channels/` (new). Channel features own their own folders (`features/news`, `features/press`, `features/weather`,
`features/portal`) and import the shared root.

---

## Frozen contracts

### FC-1 Vocabulary (one static class per side: `Features/Channels/Contracts/ChannelVocabulary.cs`, `features/channels/contract/vocabulary.ts`)
| Name | Values |
|---|---|
| `ChannelId` | `social | portal | news | press | weather` (the existing `ChannelCatalog` ids, unchanged). **Content channels** (own `ContentItem`s): `news`, `press`, `weather`. `portal` aggregates and owns none; evergreen filler (PRT-030/031) is `news` content with `background: true`. |
| `ContentKind` | `article` (news) · `release` (press) · `weather_product` (weather) · `forecast` (weather). **Additive-only registry**: a channel adds a kind by registering an `IContentKindDescriptor` (FC-7), never by editing the entity. |
| `ContentStatus` | `draft | scheduled | published | retracted`. Allowed: draft→scheduled · draft→published · scheduled→draft (unschedule) · scheduled→published (runner or publish-now) · published→retracted · retracted→published (restore). Anything else is 409. `published` stays `published` across `revise`. Delete is a soft delete (`DeletedAt`), orthogonal to status (XC-010). |
| `ContentOrigin` | `controller | participant | engine | inject`. `engine` items always land as `draft` (NWS-022). |
| `RevisionKind` | `edit` (pre-publish draft history, PRS-004) · `update` (visible "Updated 14:32", PRS-005) · `correction` (visible editor's note, NWS-013) · `silent_rewrite` (NWS-013's quiet lever: new content, **no note and no entry in the participant `revisions[]`**; staff-visible). **Updated stamp rule (news FU-1, D3-P4):** `update`, `correction` **and** `silent_rewrite` all move `updatedScenarioTime` (the "Updated 14:32" stamp) in the participant DTO and in `ContentRevised`; only `update`/`correction` add a `revisions[]` entry; `edit` never moves it. A revise carrying `touchUpdatedStamp: false` (payload-only change such as setting/clearing a breaking banner, news FU-2) moves nothing participant-visible. There is **no** fully-invisible edit option (E4-Q2 default). |
| `AlertSeverity` | `info | advisory | emergency` (frozen by the shell, `alertTypes.ts`). |
| `MediaRole` | `hero | inline | attachment`. `ContentMediaKind` = `image | video | document` (`document` reserved for E5 PDF; the media pipeline change is **press story 02's** (Q3 answered by the press decomposition). |
| Slugs | `[a-z0-9-]{1,80}`, derived from the headline, `-2` on collision, **immutable once first published** (NWS-011 permalink stability). Unique per `(ExerciseId, OutletId)` for content and `(ExerciseId, ChannelId)` for outlets. |

### FC-2 Entities (`Data/Entities/`, all `IExerciseScoped` with `Guid ExerciseId`; all soft-deleted via `DeletedAt`; all behind the `PulseDbContext` central filter + write guard)
| Entity | Columns (beyond `Id`, `ExerciseId`, `DeletedAt`) |
|---|---|
| `Outlet` | `ChannelId` · `Slug` · `Name` · `Tagline?` · `ParentOutletId?` (press org newsrooms are children of the Wire Room outlet; skin inherited) · `PairedPersonaId?` (the E2 account: NWS-004 / PRS-013 / WX-020) · `LogoMediaId?` · `CategoriesJson` · `SkinKey` · `SkinOverridesJson?` · `SortOrder` · `Enabled` · `Version` |
| `ContentItem` | `ChannelId` · `Kind` · `OutletId` · `Slug` · `Status` · `Headline` · `Dek?` · `Kicker?` · `Category?` · `BylineName?` · `BylinePersonaId?` · `BodyHtml` (sanitized at write) · `HeroMediaId?` · `PayloadJson` (kind-specific, validated by the kind descriptor) · `Background` (bool, PRT-031) · `FeaturedRank?` (PRT-004) · `ScheduledScenarioTime?` · `PublishedScenarioTime?` · `PublishedWallClock?` · `RetractedScenarioTime?` · `CreatedScenarioTime` · `CreatedWallClock` · `Origin` · `ActingHumanId` · `InjectId?` · `PairedPostId?` · `AlertId?` · `ExternalSource?` + `ExternalRef?` (Cadence seam, PDF-06; unique per exercise when set) · `UpdatedScenarioTime?` (the Updated stamp; set by `update`/`correction`/`silent_rewrite`, never by `edit`) · `PublishOptionsJson?` (staff-only; the `PublishOptions` persisted by `ScheduleAsync` / inject attach and replayed by the runner and inject fire, FC-7a) · `LastError?` (staff-only; set when a scheduled publish is refused, story 05) · `RevisionCount` · `Version` (concurrency token) |
| `ContentItemRevision` | `ContentItemId` · `Number` · `Kind` (`RevisionKind`) · `Note?` · `SnapshotJson` (the fields as they were) · `ScenarioTime` · `WallClock` · `ActingHumanId` · `Visible` (true for `update`/`correction`) |
| `ContentItemMedia` | `ContentItemId` · `MediaAssetId` · `Role` (`MediaRole`) · `SortOrder` · `Alt?` |
| `ChannelAlert` | `Severity` · `Headline` · `SourceChannel` (`ChannelId` or `system`) · `SourceContentId?` · `Href?` (host-relative path) · `IssuedScenarioTime` · `ExpiresScenarioTime?` · `ClearedScenarioTime?` · `Origin` · `ActingHumanId` · `Version` |

Migration **M1**, owned by story 01 (see [§ Migration ledger](#migration-ledger); story 16 owns M4 `InjectItem.ContentItemId`; channel-owned tables are M2/M3/M5 and are *not* defined here).

### FC-3 Wire shapes (camelCase JSON; C# `record`s in `Features/Channels/Contracts/`, TS types + runtime guards in `features/channels/contract/`)
Participant DTOs **never** carry `origin`, `actingHumanId`, wall clock, `status` other than `published|retracted`, `background`, `featuredRank`, `version`,
`injectId`, `externalRef` or draft/scheduled items (XC-002). All instants are **`scenarioTime` ISO strings** (same convention as `ParticipantPostDto.ScenarioTime`
and the alert `scenarioTime`), rendered with `formatScenarioTime` / `useScenarioTime` (COR-053).

```jsonc
// OutletRefDto — embedded in every content DTO
{ "id": "guid", "channelId": "news", "slug": "newsline-7", "name": "Newsline 7", "skinKey": "newsline7" }

// OutletDto — GET /api/outlets
{ "id": "guid", "channelId": "news", "slug": "newsline-7", "name": "Newsline 7", "tagline": "…",
  "parentOutletId": null, "pairedPersonaId": "guid|null", "logo": { /* ContentMediaDto */ } | null,
  "categories": ["Local", "Weather"], "skinKey": "newsline7", "skinOverrides": { /* partial OutletSkinTokens */ } | null,
  "homeRoute": "/news/newsline-7" }

// ContentMediaDto — reuses the existing media URL signing + dimensions; bands are drawn client-side (ExerciseBands)
{ "id": "guid", "kind": "image|video|document", "role": "hero|inline|attachment", "url": "signed-url", "posterUrl": "…|null",
  "contentType": "image/jpeg", "width": 1200, "height": 630, "durationSec": null, "alt": "…", "caption": "…|null" }

// ChannelContentSummaryDto — list rows (no body). `updatedScenarioTime` follows the Updated stamp rule in FC-1 (moves on update/correction/silent_rewrite).
// Channel projection guarantees (R-P1): kinds may derive a non-empty `dek` and must set `outlet.name` to the publishing brand (a press release's is the publishing org).
{ "id": "guid", "channelId": "news", "kind": "article", "outlet": { /* OutletRefDto */ }, "slug": "emergency-call-delays",
  "permalink": "/news/newsline-7/emergency-call-delays", "state": "published",
  "headline": "…", "dek": "…|null", "kicker": "…|null", "category": "…|null", "hero": { /* ContentMediaDto */ } | null,
  "publishedScenarioTime": "2026-…", "updatedScenarioTime": "…|null", "featured": false }

// ChannelContentDto — GET permalink; extends Summary
{ /* …Summary fields… */ "byline": { "name": "Staff", "personaId": "guid|null" } | null, "bodyHtml": "<sanitized>",
  "media": [ /* ContentMediaDto */ ], "revisions": [ { "number": 2, "kind": "update|correction", "scenarioTime": "…", "note": "…|null" } ],
  "pairedPostId": "guid|null", "alertId": "guid|null", "payload": { /* kind-specific participant-safe projection, FC-7 */ } }
// retracted item (XC-010 tombstone): only { id, channelId, kind, outlet, slug, permalink, state: "retracted", retractedScenarioTime }

// ChannelContentListDto — GET list
{ "items": [ /* Summary */ ], "nextCursor": "opaque|null" }

// ChannelContentStaffDto — staff GET: Summary + Content fields + staff-only
{ "status": "draft|scheduled|published|retracted", "origin": "controller", "actingHumanId": "…", "scheduledScenarioTime": "…|null",
  "publishedWallClock": "…|null", "background": false, "featuredRank": 1|null, "injectId": "…|null",
  "externalSource": "…|null", "externalRef": "…|null", "revisionCount": 3, "revisionLog": [ /* all kinds incl. edit, silent_rewrite */ ], "version": 7 }

// ContentWriteRequest — POST/PUT /api/content-items (PUT carries "version"; stale = 409)
{ "kind": "article", "outletId": "guid", "headline": "…", "dek": null, "kicker": null, "category": null, "bylineName": null, "bylinePersonaId": null,
  "bodyHtml": "<untrusted; sanitized server-side>", "heroMediaId": null, "media": [ { "mediaId": "guid", "role": "inline", "alt": "…" } ],
  "payload": { }, "background": false, "featuredRank": null, "scheduledScenarioTime": null, "externalSource": null, "externalRef": null, "version": 0 }

// AlertDto — GET /api/alerts, /api/alerts/history. Superset of the shell's existing Alert; extra keys are tolerated by the shell guard (additive only)
{ "id": "guid", "severity": "info|advisory|emergency", "message": "headline verbatim", "scenarioTime": "…",
  "href": "/weather/weather-desk/tornado-warning-1|null", "sourceChannel": "weather|null", "contentId": "guid|null", "expiresScenarioTime": "…|null" }
```

`OutletSkinTokens` (FC-3b; TS type + schema in `features/channels/skin/`, validated server-side as an opaque, size-capped, key-allowlisted JSON for `skinOverrides`):
`{ schemaVersion: 1, type{ mastheadFamily, hedFamily, dekFamily, bodyFamily, kickerFamily, hedCase }, palette{ accent, link, bg, surface, text, rule, breaking },
density{ spacingScale, ruleWeight, radius }, media{ cropAggression, captionStyle, playerTint }, breaking{ style, vocabulary }, byline{ format }, dateline{ format },
layout{ rail: boolean, homeLead: 'video-lead'|'text-lead'|'list-lead'|'clutter' }, clutter?: string[] /* The Scoop only; server rejects elsewhere */, ext?: { [ns]: unknown } }`.
This is the D3-P2 **CAN** list. The **CANNOT** list (slot order, scenario-time source, Pulse embed/link-card, watermark slot, share behavior, no-comments, a11y floor,
telemetry invisibility) is structurally unreachable: no token key addresses it. `ext` is the channel namespace (`ext.press` letterhead, `ext.weather` severity icons).

### FC-4 Routes
**Participant API** (live session, resolved exercise scope, **no `exerciseId` anywhere in a URL/body**; each is behind `RequireChannelEnabled(<channel>)`, FC-7):
| Route | Purpose |
|---|---|
| `GET /api/outlets?channel={id}` · `GET /api/outlets/{slug}` | outlet registry read (enabled outlets only) |
| `GET /api/channels/{channelId}/content?outlet={slug}&category=&featured=&limit=&cursor=` | published list, newest-first by `publishedScenarioTime`; `featured=true` orders by featured rank then recency (PRT-004 fallback) |
| `GET /api/channels/{channelId}/content/{outletSlug}/{contentSlug}` | permalink read; unknown / draft / scheduled / cross-exercise are all the **same 404** |
| `GET /api/link-previews?path=/news/…` | in-sim link-card data `{ title, description?, image?, sourceName, permalink }` for any content permalink; 404 for anything else (SOC-004, NWS-015) |
| `GET /api/alerts` · `GET /api/alerts/history` | active alerts (the shell's existing route, now real) / reverse-chron history (PRT-012) |

**Staff API** (live staff session; `EngineCockpitStaffAuthorizationFilter` on an empty-prefix group, controller-role filter on mutations — the `InjectEndpoints` pattern; staff verbs share paths with participant reads only where the verb differs):
`GET|POST /api/content-items` · `GET|PUT|DELETE /api/content-items/{id}` · `POST /api/content-items/{id}/{publish|schedule|unschedule|retract|restore|revise|feature}` · `POST /api/content-items/feature/reorder` `{ ids[] }` (atomic multi-item featured order, portal FU-8) ·
`POST|PUT|DELETE /api/outlets` (+`/reorder`) · `POST /api/alerts` · `POST /api/alerts/{id}/clear`. Mutations that publish or fire are rate-limited like `InjectFireRateLimiterPolicy`.

**Participant UI routes** (inside the participant shell; Social keeps `/` and its own sub-routes unchanged): `/portal` · `/news`, `/news/:outletSlug`, `/news/:outletSlug/:contentSlug` ·
`/press`, `/press/:outletSlug` (org newsroom), `/press/:outletSlug/:contentSlug` · `/weather`, `/weather/:outletSlug/:contentSlug` · `/alerts` (shell-level history, already the alert bar's
"Details" target). **A permalink is always `/{channelId}/{outletSlug}/{contentSlug}`** and is always host-relative (FC-9). Channels may add siblings under their own prefix
(`/weather/zones/:zoneSlug`, `/portal/resources`) but never under another channel's.

**Channel-owned route families (additive index, portal FU-3; the owning feature's `implementation.md` is authoritative for shapes):** press `/api/press/*` (E5 PC-3) · weather `/api/weather/*` (E6) ·
portal `/api/portal*`, `/api/displays*`, `GET /api/display/state` and the **anonymous** `POST /api/auth/display` (E3 PC-4; the one new `PreAuthAllowlist` entry, orchestrator seam) · the login-free SPA route
`/display/:token` lives **outside** the session shell and is **not** mounted by `ChannelRouter` (story 12 leaves it alone). None of these may carry an `exerciseId`.

### FC-5 Realtime events (existing hub, existing exercise group; frames to the staff group only once the exercise is not live-push-open, exactly like `PostReceived`)
Added as **default-interface no-op methods** on `IFeedBroadcaster` (story 02), implemented in `SignalRFeedBroadcaster` (story 09). Client event names:
| Event | Payload | When |
|---|---|---|
| `ContentPublished` | `ChannelContentSummaryDto` | item becomes `published` (publish-now, scheduled runner, restore) |
| `ContentRevised` | `{ id, channelId, permalink, updatedScenarioTime, revisions[], headline, dek }` (no body; client refetches the item) | `update` / `correction` / `silent_rewrite` |
| `ContentRetracted` | `{ id, channelId, permalink, retractedScenarioTime }` | retract (and soft delete of a published item) |
| `AlertsChanged` | `{ alerts: AlertDto[] }` (the full active set, so late/reconnecting clients converge) | alert raised, cleared, expired |
`ScenarioClockChanged` is unchanged and remains the only time source.

### FC-6 Telemetry (XC-004 v0 envelope; no schema change, vocabulary additions only; `channel` = the content item's channel)
| `eventType` | Emitter | `target` | Notes |
|---|---|---|---|
| `article_view` | client (story 15) | `{ entityType: 'content_item', entityId }` | existing vocabulary entry; used for **all** content kinds, `payload.kind` distinguishes. Session-level, labeled so in E10 (NWS-030). |
| `content_dwell` | client | same | best-effort; `payload.seconds` |
| `content_share` | server (share-out to Pulse, story 18 path) | same | |
| `content_published` | server (story 04) | same | every publish; `origin` + `injectId` carried; `actor.actingHumanId` is the human. For kind `release` by a participant the event is the existing **`press_release`** instead (never both). |
| `content_revised` / `content_retracted` | server | same | `payload.revisionKind` |
| `alert_issued` / `alert_cleared` | server (story 10) | `{ entityType: 'alert', entityId }` | |
Emitted in the same unit of work as the state change; the client emits nothing for server-side events (no double count).

**FC-6b Channel vocabulary — registered once, by story 02 (news FU-7, weather FU-7, portal FU-2, press PC-5).** One additive edit to `core/telemetry/schema.ts` (`KNOWN_TELEMETRY_EVENT_TYPES`) and the
server vocabulary constants covers every channel, so no channel story edits the shared list (the sink still accepts an unknown type, so ordering can never drop data). Names only; each channel's
payload/target shapes stay in its own `implementation.md`.
| Group | `eventType` values | Emitter / owner |
|---|---|---|
| Foundation | `content_dwell` · `content_published` · `content_revised` · `content_retracted` · `content_share` · `alert_issued` · `alert_cleared` · `outlet_action` · `content_schedule_failed` | F15 / F04 / F18 / F10 / F03 / F05 |
| E4 news | `content_video_play` · `content_video_progress` · `content_embed_open` | news 19 (client) |
| E5 press | `press_draft_created` · `press_embargo_set` · `press_embargo_cancelled` · `press_approval_requested` · `press_approval_approved` · `press_approval_returned` | press `PressTelemetry` (server) |
| E6 weather | `weather_zone_changed` | weather 02 (server) |
| E3 portal | `portal_view` · `portal_module_click` · `resource_view` · `portal_config_changed` · `display_command` · `display_session_started` | portal 07/15/17 (client), 03/08/16/05 (server) |
Additive payload key (no new event): `article_view.payload.productType` (weather), passed through `useContentViewTelemetry`'s `extraPayload` (story 15). The `actor.kind: 'display'` actor needed by
`display_session_started` is a **platform prerequisite** (PP-1), not a vocabulary entry.

### FC-7 Backend seams (interfaces in `Features/Channels/Contracts/`, implementations in the owning story)
| Name | Shape (summary) | Owner |
|---|---|---|
| `IContentPublishService` | `CreateDraftAsync · UpdateDraftAsync · PublishAsync(id, PublishOptions?{ pairedPost?, alert? }) · ScheduleAsync(id, scenarioTime, PublishOptions?) · UnscheduleAsync · RetractAsync · RestoreAsync · ReviseAsync(id, ReviseOptions{ kind, note?, fields, touchUpdatedStamp = true }) · SoftDeleteAsync` — **the one funnel**; every publisher (staff API, inject fire, scheduler, participant composer, engine) calls it; nobody writes `ContentItem` rows directly. **Callers may be staff or participant** (`origin` + `ActingHumanId` come from the caller's authenticated session, never a request body); authorization is the calling endpoint's, the funnel owns state machine, sanitization, scoping, stamping, telemetry (press FU-2) | 04 |
| `IContentKindDescriptor` | `Kind · ChannelId · ValidatePayloadAsync(json, PayloadValidationContext) → PayloadValidationResult · ProjectPayload(json) → participant-safe object · BodyPolicy (a **named** sanitizer profile) · AllowedMediaKinds · DefaultAlertMapping? (UI suggestion only) · ResolvePublishOptions(ContentItem) → PublishOptions? (default null)` — registered via DI by E4/E5/E6. Descriptors are **scoped** DI services; `PayloadValidationContext` carries the resolved exercise scope and the scoped `PulseDbContext`/services so a kind can check zone existence or supersession (weather FU-3). Sync-only validation is not offered | 02 (interface), channels (impls) |
| `ISanitizerProfileRegistry` | Named `BodyPolicy` profiles over `PostSanitizer` (never a fork). Built-ins shipped by 04: `plain`, `rich-basic` (p/br/strong/em/ul/ol/li/blockquote/h2–h4/`a[href]` with forced `rel`), `rich-tables` (rich-basic + table elements; the paste-from-Word survivor set press needs). A descriptor may `Register(name, policy)` an **additional** profile at DI time (news registers `article-rich`); an unknown profile name is a startup failure (news FU-8, press FU-5) | 04 |
| `IContentPublishGate` | `EvaluateAsync(ContentItem, PublishContext{ action, origin, actingHumanId }) → Allow(auditNote?) or Hold(reason)`; default pass-through. Called before `PublishAsync`/`ScheduleAsync` changes state; `Hold` = 409 `held`, state unchanged. `auditNote` is written to the `content_published` event as `payload.gateNote` (press records "controller bypass of pending approval" this way, FU-2). Channel gates that need participant paper trails (press `IReleaseApprovalGate`) stay channel-owned and call the funnel only after they pass | 04 |
| `IContentPublishedObserver` | `OnPublishedAsync(ContentItem)` / `OnRevisedAsync` / `OnRetractedAsync` — mirror of `IPostPublishedObserver`; E8 reaction hooks (PRS-022) and E10 attach here | 04 |
| `IAlertRaiser` | `RaiseAsync(AlertRaise{ severity, headline, href?, sourceChannel, sourceContentId?, expires? }) → AlertDto · ClearAsync(id)` — used by CTL-021 console flag, weather issuance (WX-011), news flash (NWS-012), publish options | 10 |
| `IPairedSocialPoster` | `PostLinkCardAsync(ContentItem, text?) → postId` via `PostIngestService` with the outlet's `PairedPersonaId` | 18 |
| `IInSimLinkResolver` | `ResolveAsync(path) → LinkPreview?` (content permalinks only; scoped) | 06 |
| `IChannelEnablement` + `RequireChannelEnabled(channelId)` endpoint filter | reads `Exercise.EnabledChannels` via the `ChannelCatalog`; disabled → the same 404 as unknown | 08 |
| `IContentPermalinks` | `For(channelId, outletSlug, contentSlug) → "/news/…"` (path only, FC-9) | 02 |
| `ISkinOverridesValidator` | Public server-side validator for any `OutletSkinTokens` subset: FC-3b key allowlist, `ext.<ns>` namespaces (`news`, `press`, `weather`, `portal`; flat scalar/string-array values, size-capped at 4 KB total), clutter rejection off the tabloid key, CANNOT-list rejection. Reused by `OutletService` and by the portal config API (portal FU-4b) | 03 |

**FC-7a Publish-options resolution (the "no dialog" path — weather FU-2, press FU-3).** A scheduled item, an inject-fired item and a staff "publish now" from a kind whose editor `ownsDeliveryOptions`
(FC-8) have no publish dialog to supply `PublishOptions`. The funnel therefore resolves options **first non-null wins, no merging**: (1) the options on the call · (2) `ContentItem.PublishOptionsJson`,
persisted by `ScheduleAsync`/inject attach and replayed by the runner and inject fire · (3) the kind's `ResolvePublishOptions(item)` (data-driven kinds, e.g. weather reads its payload `delivery` block) · (4) none.
`DefaultAlertMapping` is a **suggestion only** — the dialog (story 17) pre-fills from it; the funnel **never raises an alert from it** (so a breaking news article suggests an `advisory` entry but cannot raise one, E4-Q8).

### FC-8 Frontend seams (`features/channels/`, barrel `index.ts`)
`contract/` (TS types + guards for FC-3, vocabulary, `contentPermalink()`), `skin/` (`OutletSkinScope`, `SkinScope`, `useOutletSkin`, `SkinResetBoundary`, **`registerSkinTokens`**, `registerSkinExtension`,
`registerSkinFonts`; neutral + stub token files only in `skin/tokens/`), `primitives/` (`ScenarioDateline` + `registerDatelineFormat`, `WatermarkSlot`, `SanitizedBody`, `ContentMedia`, `LiveRegionAnnouncer`),
`data/` (`useOutlets`, `useContentList`, `useContentItem`, `useContentViewTelemetry`, `useChannelStream`), `routing/` (`ChannelRoute`, `ChannelNotFound`, channel registry `registerChannel()`),
`mocks/` (fixtures behind the axios client).
Staff side: `features/controller/content/` (story 17): `ContentAuthoringShell`, `registerContentKindEditor(kind, component, { ownsDeliveryOptions? })`.
Social side (story 21): the `features/social` barrel exports the read-only pieces channels consume (`useTrending`, `useRecentPublicPosts`, `usePostById`, `SocialBrandScope`, `PostCard` read-only,
`socialPostPath`, `socialProfilePath`, `openComposerWithLink`).

**FC-8a Skin registration (the one call; news FU-3/FU-4/FU-6b, press FU-1, weather FU-4, portal FU-4a).** A channel registers **from its own folder** with `registerSkinTokens(skinKey, tokens, { fonts? })`
as a module side effect of its channel import (`registerOutletSkin` / `registerSkin` / `registerSkinTokens` in the channel docs are this one call). F13's `skin/tokens/` holds only the neutral fallback and
**replaceable stubs** for `wire-room` and `weather-desk`; a channel registration replaces a stub, a second registration of a non-stub key is a dev-time error. `SkinScope({ scopeId, tokens })` is the
token-object scope for anything that is not an outlet (the portal); `OutletSkinScope` is a thin wrapper over it. `registerSkinExtension(ns, schema)` declares an `ext.<ns>` schema and which of its keys are
colors so they enter the contrast check (F13) and mirror the server allowlist (F03). `registerSkinFonts(skinKey, faces[])` carries the font contract: self-hosted `woff2` from the channel's folder, loaded lazily
per mounted scope, `font-display: swap`, CSP `font-src 'self'` (host-config edit is PP-3), no third-party CDN. `SkinResetBoundary` re-applies the **exercise brand tokens** inside an outlet/portal scope so
embedded Social content (an article's `PostCard`, the portal's stream) is immune to outlet tokens.

### FC-9 Cross-cutting rules every channel story inherits
1. **Isolation (XC-001/002):** exercise scope comes only from the host-resolved session; participant routes never accept an exercise id; wrong-exercise ≡ unknown (404). Each channel's new read route is added to the standing isolation suite via the conformance kit (story 20).
2. **Scenario time (COR-053/XC-008):** server stamps from `IExerciseClock`; client renders via the shell's `scenarioNow` / `formatScenarioTime`; no `Date.now()` / `toLocale*` in participant code.
3. **URLs are host-relative (COR-008, PDF-11):** no DTO, link card, alert `href`, sitemap or telemetry payload may contain an absolute URL or a hostname. Browsers resolve against the exercise host.
4. **Two worlds:** participant code imports no COBRA and no default MUI look; staff code imports `@/theme/styledComponents`; a channel's theme mounts in its own route subtree (`OutletSkinScope`), never above the shell.
5. **No platform-added chrome in-fiction (SOC-002 parity):** BREAKING, corrections, "Updated" markers are authorial, rendered by the channel from data; the platform adds none.
6. **Sanitization (NFR-004):** `BodyHtml` is sanitized once, server-side, by the kind's `BodyPolicy`; the client renders it through `SanitizedBody` (defense in depth, never `dangerouslySetInnerHTML` elsewhere). Media passes the existing sniffer/size/malware path.
7. **Soft delete (XC-010):** nothing is hard-deleted; retraction renders an in-fiction tombstone.
8. **Watermark (NFR-008):** high-risk kinds (`article`, `weather_product`, `forecast`, alerts) render `WatermarkSlot` (bottom-right chip over hero/imagery); chrome and watermark are never both off (`isWatermarkRequired(config)`); media always gets `ExerciseBands` when required.
9. **A11y (NFR-001, PDF-12):** severity = icon + text + color; live regions via `LiveRegionAnnouncer` (polite for content, assertive only for emergency alerts); ≥ 44px touch targets on coarse pointers; each channel's pages are in the conformance kit's axe sweep.
10. **Composition roots are orchestrator-owned** (`Program.cs` `AddChannels()/MapChannels()`, `App.tsx`, the staff route registry); every backend feature ships a `WebApplicationFactory<Program>` wiring test, as `InjectsCompositionRootWiringTests` does.

---

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 | Entities + EF configs + `PulseDbContext` DbSets + one migration (idempotent-script safe; `EXEC`-wrap hand SQL per the #413 rule). Unique indexes: `(ExerciseId, OutletId, Slug)`, `(ExerciseId, ChannelId, Slug)`, filtered unique `(ExerciseId, ExternalSource, ExternalRef)`. Includes the follow-up columns `UpdatedScenarioTime`, `PublishOptionsJson`, `LastError`. **M1** of the migration ledger. | `Data/Entities/{Outlet,ContentItem,ContentItemRevision,ContentItemMedia,ChannelAlert}.cs`, `Data/PulseDbContext.cs` (DbSets only), `Migrations/*` | FC-2 entities |
| 02 | Contract-first (the demo-feedback 01/17 pattern): C# records + TS types/guards + fixtures + no-op default methods on `IFeedBroadcaster` + FC-7 interfaces (incl. async `ValidatePayloadAsync`, `ResolvePublishOptions`, `IContentPublishGate`, `ISanitizerProfileRegistry`, `ReviseOptions`) + `ChannelVocabulary` + `IContentPermalinks` + the **one telemetry-vocabulary edit** for every channel (FC-6b). | `Features/Channels/Contracts/**`, `Features/Realtime/IFeedBroadcaster.cs`, `features/channels/contract/**`, `features/channels/mocks/**`, `core/telemetry/schema.ts` (vocabulary additions only) + the server vocabulary constants | FC-1, FC-3, FC-5 names, FC-6b, FC-7 interfaces, FC-8 `contract/` |
| 03 | `OutletService` + endpoints; seeds the default outlets (Newsline 7, Courier-Ledger, National Wire, The Scoop, The Wire Room, The Weather Desk) from the cast library into an exercise on request; paired persona validated in-scope; `skinOverrides` allowlisted + size-capped; `clutter` rejected unless `skinKey` is the Scoop's. The allowlist lives in a **public `ISkinOverridesValidator`** (FC-7; `ext.news|press|weather|portal` namespaces) that the portal config API reuses. "Add default outlets" is idempotent and a `weather` exercise has exactly one default outlet (slug `weather-desk`). | `Features/Channels/Outlets/**` | `OutletService`, `ISkinOverridesValidator`, `/api/outlets*` |
| 04 | `ContentPublishService` implements `IContentPublishService`: sanitize → validate kind payload → stamp `IExerciseClock` time → persist → revision → telemetry → broadcast (via `IFeedBroadcaster`) → observers → optional `IAlertRaiser` / `IPairedSocialPoster` (seams, no-op if unset). Concurrency via `Version`, like `InjectQueueService`. Also: `ISanitizerProfileRegistry` (built-ins `plain`/`rich-basic`/`rich-tables`), `ReviseOptions.touchUpdatedStamp`, persisted-options resolution (FC-7a), `IContentPublishGate`, participant-origin callers. This is the heaviest foundation story and the critical path; if it needs splitting at build time the seam is "core lifecycle" vs "FC-7a/gate/profile extensions". | `Features/Channels/Content/Publish/**` | `IContentPublishService` impl, `IContentPublishedObserver` registry, `ISanitizerProfileRegistry`, `IContentPublishGate` registry |
| 05 | Hosted service modelled on `InjectBurstRunner`: scoped, sets `ExerciseContext.CurrentExerciseId` before resolving `PulseDbContext`, finds due items across exercises with an `IgnoreQueryFilters()` id-only read, publishes via `IContentPublishService`. Respects pause tiers (`PauseTierRegistry`) and clock jumps/freeze. Publishes via `PublishAsync(id, null)` so the funnel resolves persisted/descriptor options (FC-7a): a scheduled item's alert/post decision is never lost. | `Features/Channels/Content/Scheduling/**` | `ContentScheduleRunner` |
| 06 | Read services + endpoints behind `RequireChannelEnabled`; participant projector (the `ParticipantPostProjector` pattern) is the only path to `ChannelContentDto`; `IInSimLinkResolver` impl. | `Features/Channels/Content/Read/**` | `/api/channels/*`, `/api/link-previews`, projector |
| 07 | Staff endpoints over `IContentPublishService`; role/rate-limit filters; staff DTO mapper; preview-as-participant read (`GET /api/content-items/{id}/preview` returns the participant DTO for any status). `revise` accepts `touchUpdatedStamp`; `schedule` accepts and persists `PublishOptions`; `POST /api/content-items/feature/reorder` is the atomic featured order. | `Features/Channels/Content/Staff/**` | `/api/content-items*` |
| 08 | `IChannelEnablement` + endpoint filter + `ChannelCatalog` becomes the one registry; client `useEnabledChannels()` + `<ChannelRoute>` guard. | `Features/Channels/Enablement/**`, `Features/ExerciseConfiguration/ParticipantShellConfigService.cs` (catalog edit only), `features/channels/routing/enabled.ts*` | FC-7 filter, `useEnabledChannels` |
| 09 | `SignalRFeedBroadcaster` implements the four new methods (same `ResolveTargetAsync` lifecycle routing); client `useChannelStream` subscribes on the shared `realtimeConnection` and exposes typed handlers. | `Features/Realtime/SignalRFeedBroadcaster.cs`, `features/channels/data/useChannelStream.ts*` | `useChannelStream`, event names |
| 10 | `AlertService` (`IAlertRaiser`) + `GET /api/alerts` real (replaces the empty `GetAlertsAsync`) + history + staff raise/clear + expiry sweep; emits `AlertsChanged`; SOC-072 bridge: an alert also produces the platform notification while the pilot-mode notification path is enabled. | `Features/Channels/Alerts/**`, `ParticipantShellConfigService.GetAlertsAsync` (delegate only) | `IAlertRaiser`, `/api/alerts*` |
| 11 | `useAlerts` goes live (poll once + `AlertsChanged` push); passes `href` to the existing "Details" link; announce via the existing live region; asserts multi-alert ordering/rotation (weather FU-5). | `features/participant-shell/components/AlertBar/useAlerts*.ts*`, `alertTypes.ts` | live `useAlerts()` (same signature) |
| 12 | `ChannelRouter` inside `ShellLayout`: reads the enabled set, mounts the registered channel by path prefix, per-channel theme scope, participant-world not-found (WR-002 / #238), return-to-after-login for deep permalinks, landing = portal if enabled else social (PRT-001). | `features/participant-shell/channelRouter/**` | `registerChannel()`, `<ChannelRouter>` |
| 13 | Token registry + `OutletSkinScope` (CSS custom properties + a per-outlet MUI theme mounted in the subtree; never the COBRA theme) + schema validation + neutral fallback skin. Also ships the **replaceable stubs** `wire-room` and `weather-desk` so E5/E6 mount before their final values land, **external registration** (`registerSkinTokens`, `registerSkinExtension`, `registerSkinFonts`, FC-8a), the token-object `SkinScope` for non-outlet scopes and `SkinResetBoundary`. News skins (4), press letterhead, weather desk and portal tokens are registered by their channels from their own folders. This is the largest frontend foundation story after 17. | `features/channels/skin/**` | FC-8 `skin/` |
| 14 | Presentational primitives, no data fetching. `ScenarioDateline` formats are a registry (`registerDatelineFormat`; built-ins `standard`, `relative`, `compact`; news registers `wire`). `ContentMedia` imports the existing inline player from `core/media` (extracted from Social if it is not already there) so no channel pulls Social chrome (news FU-9). | `features/channels/primitives/**`, `core/media/**` (only if the player must be extracted) | FC-8 `primitives/` |
| 15 | React Query hooks over the real API (mock fixtures behind the axios client until live), stream merge (new item / revised / retracted), `useContentViewTelemetry` (view on mount once per session+item, dwell on unmount/visibility; accepts allow-listed `extraPayload`, e.g. `productType`). Vocabulary strings are registered by story 02, not here. | `features/channels/data/**` (except `useChannelStream`) | FC-8 `data/` |
| 16 | `InjectItem.Kind = content` with `ContentItemId`; fire = `IContentPublishService.PublishAsync` with `origin: inject`, `injectId`; same state machine, exactly-once claim, pause tiers, telemetry (`inject_action`) as `post`. Attach persists the item's `PublishOptionsJson`; fire calls `PublishAsync(id, null)` (FC-7a). | `Features/Injects/**` (additive), `Data/Entities/InjectItem.cs`, **M4** | content inject kind |
| 17 | `ContentAuthoringShell` (COBRA): list by status, status chips (text + icon), create/edit slot filled by `registerContentKindEditor`, schedule / publish-now / retract / revise, preview-as-participant, "attach to inject", paired-post + alert options. Channels supply editors only; a kind registered with `ownsDeliveryOptions: true` (weather) hides the generic alert/post block and relies on its payload `delivery` block via FC-7a. | `features/controller/content/**` | FC-8 staff side |
| 18 | `PairedSocialPoster` composes link-card post text with the permalink; publishes through `PostIngestService` as the outlet's persona, `origin` mirrors the content item's; failure never blocks the publish (reported in the result). The acting human is read from the **publish call** (`ActingHumanId`), never from the persona's owner, so a participant release cross-posted from a child org outlet attributes correctly (press FU-8). | `Features/Channels/Social/**` | `IPairedSocialPoster` impl |
| 19 | `IContentPermalinks` + client `contentPermalink()` are path-only; tripwire tests scan DTO producers and fixtures for absolute URLs; rename-alias hosts keep permalinks valid. | `Features/Channels/Urls/**`, `features/channels/urls/**`, tests | tripwire tests |
| 20 | Reusable test kit + the standing-suite additions + the **migration-ledger test** (M-order, one migration per owner). | `Pulse.WebApi.Tests/Channels/Conformance/**`, `features/channels/testing/**`, `e2e/channels/**` | `channelConformance()` helpers |
| 21 | Additive barrel exports + two read hooks + a read-only `PostCard` mode + `openComposerWithLink` in the existing social feature; **no behavior change** to Social. | `features/social/index.ts` (the demo-polish F0 barrel freeze is lifted for these additive exports), new `features/social/hooks/{useRecentPublicPosts,usePostById,useComposeWithLink}.ts*`, additive exports of the existing `explore/useTrending.ts`, `theme/SocialBrandScope.tsx` and `layout/socialNavigation.ts` (`socialPaths` + `socialPostPath`/`socialProfilePath` wrappers), `components/PostCard.tsx` / `components/post/**` (read-only mode only) | FC-8 social side |

## Reuse map
- **Isolation:** `IExerciseScoped`, `PulseDbContext` central filter + write guard, `ExerciseContext.CurrentExerciseId` in background scopes (`EnginePublishService.cs:83-129` pattern), host resolution (`Features/ExerciseResolution`). Frontend: `core/exerciseContext`.
- **Clock:** `IExerciseClock.CurrentScenarioTime(exerciseId) ?? exercise.CurrentScenarioTime ?? now` (FollowService pattern); frontend `core/clock` (`useScenarioTime`, `formatScenarioTime`, `ServerClockSync`) and the shell's `scenarioNow`.
- **Funnel pattern:** `PostIngestService` / `IInjectPostPublisher` / `IPostPublishedObserver` / `ParticipantPostProjector` — mirror their shape, do not call them for content.
- **Sanitizer:** `PostSanitizer` (extend by profile for rich body; do not fork). **Media:** `Features/Media/*` (`MediaSniffer`, signed URLs, `MediaLibraryService`), frontend `core/media`, the `ExerciseBands` overlay and `isWatermarkRequired` (demo-feedback 06).
- **Realtime:** `IFeedBroadcaster` + `SignalRFeedBroadcaster.ResolveTargetAsync` lifecycle routing (#375); frontend `core/realtime/connection.ts` (`realtimeConnection`).
- **Inject queue:** `InjectQueueService`, `InjectBurstRunner`, `InjectVocabulary`, `PauseTierRegistry`, `InjectFireRateLimiterPolicy`.
- **Telemetry:** server telemetry sink/`InjectTelemetry` emit pattern; frontend `core/telemetry` emitter + `KNOWN_TELEMETRY_EVENT_TYPES` (`article_view`, `press_release` already present).
- **Shell:** `participant-shell` (`ShellLayout`, `ChannelNav`, alert bar host + `AlertsHistory`, `BrandThemeProvider`, `chromeConfig`); `ParticipantShellConfigService.ChannelCatalog`; D7 SHELL-CONTRACT (channels never render cross-channel nav or draw above the overlay layer).
- **Staff:** COBRA theme + `@/theme/styledComponents`, staff route registry (`features/staff/staffRouteRegistry`), `features/controller/runSheet` (inject console), `EngineCockpitStaffAuthorizationFilter` / `EngineCockpitControllerRoleFilter`.
- **Frontend plumbing:** shared axios client `core/services/api.ts`, `core/utils/validateEnv.ts`, React Query (`core/services/queryClient.ts`), FontAwesome only, MUI 9 `sx`-only props.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Data model + migration **M1** | backend | `Data/Entities/{Outlet,ContentItem,ContentItemRevision,ContentItemMedia,ChannelAlert}.cs`, `Data/PulseDbContext.cs`, `Migrations/*` (M1) | existing isolation layer | 02, 21 | 1 | L |
| 02 Frozen contracts | fullstack | `Features/Channels/Contracts/**`, `Features/Realtime/IFeedBroadcaster.cs`, `features/channels/contract/**`, `features/channels/mocks/**`, `core/telemetry/schema.ts` (vocabulary additions only) + server vocabulary constants | none | 01, 21 | 1 | M |
| 21 Social prerequisites (R-S1) | frontend | `features/social/index.ts` (+ additive exports), `features/social/hooks/{useRecentPublicPosts,usePostById,useComposeWithLink}.ts*`, `features/social/components/post/**` (read-only mode only) | none (existing social) | 01, 02 | 1 | M |
| 03 Outlet registry | backend | `Features/Channels/Outlets/**` | 01, 02 | 04, 08, 09, 10, 13, 14 | 2 | M |
| 04 Publish funnel | backend | `Features/Channels/Content/Publish/**` | 01, 02 | 03, 08, 09, 10, 13, 14 | 2 | L |
| 08 Enablement gate | fullstack | `Features/Channels/Enablement/**`, `ParticipantShellConfigService.cs` (catalog edit), `features/channels/routing/enabled.ts*` | 02 | 03, 04, 09, 10, 13, 14 | 2 | M |
| 09 Realtime fan-out | fullstack | `Features/Realtime/SignalRFeedBroadcaster.cs`, `features/channels/data/useChannelStream.ts*` | 02 | 03, 04, 08, 10, 13, 14 | 2 | M |
| 10 Alert source | backend | `Features/Channels/Alerts/**`, `ParticipantShellConfigService.GetAlertsAsync` (delegate line) — see Seam note 2 | 01, 02 | 03, 04, 08, 09, 13, 14 | 2 | M |
| 13 Outlet skin system (+ external registration) | frontend | `features/channels/skin/**` | 02 | 03, 04, 08, 09, 10, 14 | 2 | L |
| 14 Shared primitives | frontend | `features/channels/primitives/**`, `core/media/**` (only if the inline player must be extracted) | 02 | 03, 04, 08, 09, 10, 13 | 2 | M |
| 05 Scheduler | backend | `Features/Channels/Content/Scheduling/**` | 04 | 06, 07, 11, 12 | 3 | M |
| 06 Participant read API | backend | `Features/Channels/Content/Read/**` | 01, 02, 04, 08 | 05, 07, 11, 12 | 3 | M |
| 07 Staff content API | backend | `Features/Channels/Content/Staff/**` | 04 (03 for outlet refs) | 05, 06, 11, 12 | 3 | M |
| 11 Alert bar live | frontend | `features/participant-shell/components/AlertBar/useAlerts*.ts*`, `alertTypes.ts` | 09, 10 | 05, 06, 07, 12 | 3 | S |
| 12 Channel router | frontend | `features/participant-shell/channelRouter/**` | 08, 13 | 05, 06, 07, 11 | 3 | M |
| 15 Data hooks + telemetry | frontend | `features/channels/data/**` (not `useChannelStream`) | 06, 09, 14 | 16, 17, 18, 19 | 4 | M |
| 16 Content injects | backend | `Features/Injects/**` (additive), `Data/Entities/InjectItem.cs`, **M4** | 04, 07; M1–M3 merged first | 15, 17, 18, 19 | 4 | M |
| 17 Staff authoring seam | frontend | `features/controller/content/**` | 07, 14 (16 for the attach control, mock until live) | 15, 16, 18, 19 | 4 | L |
| 18 Paired social post | backend | `Features/Channels/Social/**` | 04, 06 (resolver) | 15, 16, 17, 19 | 4 | M |
| 19 Subdomain readiness | fullstack | `Features/Channels/Urls/**`, `features/channels/urls/**` | 06, 15 | 16, 17, 18 | 4 | S |
| 20 Conformance kit (+ migration-ledger test) | testing | `Pulse.WebApi.Tests/Channels/Conformance/**`, `features/channels/testing/**`, `e2e/channels/**` | all above | — | 5 | M |

`Stack` tells the orchestrator which builder to spawn and which Gate-0 command to run (`ORCHESTRATION_MECHANICS.md` §5). The backend **exists**, so a frontend story against a
real route waits for that route's story (serial edge: the contract in FC-3/FC-4 is the seam, no codegen); until then it runs on the `features/channels/mocks/` fixtures behind the axios client.

### Seam notes
1. **One migration at a time, in ledger order.** Foundation stories own **M1** (01) and **M4** (16); the channel features own M2/M3/M5 (portal 01, weather 02, press 06). The sequence, owners and waves are the [§ Migration ledger](#migration-ledger); no story outside the ledger adds a migration, and a story that needs a column amends the owning row *before* that row's wave starts (e.g. the follow-up columns `UpdatedScenarioTime`, `PublishOptionsJson`, `LastError` were folded into M1).
2. **`ParticipantShellConfigService.cs` has two Wave-2 touches** (08: catalog; 10: `GetAlertsAsync` delegate). They are different methods but one file — the orchestrator serializes them (08 then 10) or hands 10 a one-line delegate change it applies itself. Everything else in 10 is new files.
3. **`IFeedBroadcaster.cs` is edited only by 02** (no-op default methods) so 04/10 can call the broadcast seam before 09 implements it.
4. **Channel features** (E4/E5/E6/E3) register through `IContentKindDescriptor`, `registerChannel()`, `registerContentKindEditor()` and skin token files; none of them edits a Foundation file. Where a channel genuinely needs a Foundation change, it is a numbered follow-up, not a drive-by edit. The channels' first-round follow-ups (news FU-1..9, press FU-1..9, weather FU-1..8, portal FU-1..9) are **all resolved** below, in the foundation stories or as platform prerequisites; a new one found during build goes to the orchestrator, who amends the owning story before its wave starts.

### Integration seam (orchestrator-owned — never a wave story)
| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | `AddChannels()` / `MapChannels()` (+ hosted service `ContentScheduleRunner`), added by the orchestrator in the same PR as each backend story; guarded by a `WebApplicationFactory<Program>` wiring test per story (routes mapped, hosted service registered, services resolve). |
| Participant composition root | `src/frontend/src/App.tsx` (replaces the hard-coded `<SocialChannel />` with `<ChannelRouter>`) | Orchestrator-only, serial, between Wave 3 and 4. |
| Staff route registry | `features/staff/staffRouteRegistry` | Orchestrator adds the content authoring surface entry (story 17). |
| Channel registry | `features/channels/routing/registry.ts` | Each channel feature adds one `registerChannel()` call at its own mount point; the registry file itself is story 12's. |

## Migration ledger

The one sanctioned, **serialized** schema sequence for the whole December release (supersedes "only F01 and F16 own migrations"). One migration PR is in flight at a time; each later one is
**regenerated against the merged snapshot of the one before it** (orchestrator merges in ledger order and rejects out-of-order PRs). Waves are the **combined** waves of
[`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md) (CW1…CW6), not a feature's local numbering.

| # | Owner story | Adds | Combined wave | May start when | Notes |
|---|---|---|---|---|---|
| **M1** | **F01** | `Outlet`, `ContentItem` (incl. `UpdatedScenarioTime`, `PublishOptionsJson`, `LastError`), `ContentItemRevision`, `ContentItemMedia`, `ChannelAlert` + indexes | CW1 | immediately | The only migration before CW2. |
| **M2** | **portal 01** | `PortalConfig`, `PortalResource`, `PortalDisplay` | CW2 | M1 merged | Needs only F01/F02; kept out of F01 so a non-content channel's tables do not hold up Wave 1 (alternative: fold into M1 — DECEMBER-RELEASE Q-28). |
| **M3** | **weather 02** | `WeatherZone` | CW3 | M2 merged | Zones are an exercise-scoped entity, not outlet categories (weather decision). |
| **M4** | **F16** | `InjectItem.ContentItemId` (+ `Kind` accepts `content`) | CW4 | M3 merged | The foundation's second (and last) migration; a nullable column. |
| **M5** | **press 06** | `PressReleaseEvent`, `PressApprovalSettings` | CW4 (after M4) | M4 merged | Serialized *after* F16's, as press asked. Cut-line fallback if press 06 is cut: none needed (no table). |

Rules (every row): (1) one migration per owner story, nothing else adds one; (2) every entity `IExerciseScoped`, soft-deleted, behind the `PulseDbContext` central filter + write guard; (3) the idempotent
deploy script passes and hand-written SQL naming a same-migration column is `EXEC`-wrapped (#413); (4) a `RequiresDockerFact` migration test per row; (5) migration ids carry the ledger token
(`…_Channels_M<n>_<Name>`) so story 20's **ledger test** can assert order and that no other migration touched these tables; (6) a story that discovers it needs a column amends its owning row before that
row's wave starts, never adds a sixth migration; (7) F16 sits after M2/M3 only because those channels' stories start earlier on the wave axis; the sequence is by merge order, not by owner priority.
*Option for Tom (DECEMBER-RELEASE Q-28):* moving `InjectItem.ContentItemId` into M1 would let F16 own no migration (ledger → M1, M2, M3, M5) at the cost of F01 touching an inject entity; not done here.

## Platform prerequisites

Items that belong to the **platform** (E1 identity, the participant shell, hosting), not the channels foundation. Each has an owning feature; none is built by a channel story. They are listed so the
orchestrator schedules them and the channel stories can state them as dependencies.

| ID | Item | Owner feature | Needed by | How it lands | Fallback if it slips |
|---|---|---|---|---|---|
| **PP-1** | A **`display` session purpose and actor kind** (portal FU-5): `Session.Kind` today is `readonly` / `participant` / `staff`, and `TelemetryEnvelopeAuthority` special-cases `readonly`. A kiosk must be attributable to a **display**, never a person (PRT-041, review finding D9). | `identity-auth-roles` (E1 session issuance, `ISessionIssuer`) + `telemetry` (`TelemetryEnvelopeAuthority`, actor kind) | portal 05 (kiosk credential), hence portal 08/18/19/20 | One additive edit applied **by the orchestrator** before portal 05's wave (CW3), not by 05's builder; portal 05 specifies the observable behavior and tests, and the PreAuthAllowlist/pinned-count change for `POST /api/auth/display` lands in the same seam commit (EL-17). | **Kiosk-lite** (portal cut order 7): the existing shared view-only login on `/portal?display=1`; no per-display telemetry or remote control. |
| **PP-2** | **Kiosk chrome**: `participant-shell/06` AC2 (strip compliance chrome **and** channel nav, keep the alert bar) is "Deferred to Phase 3" and unowned (portal FU-7); plus the `isWatermarkRequired` kiosk clause (portal FU-9: chrome and watermark never both off, NFR-008). | `participant-shell` story 06 (AC2 pulled forward into December) with the `chromeConfig.ts` helper | portal 18 (kiosk frame) | A single shell PR touching `ShellLayout.tsx` and `chromeConfig.ts` with its tests, by the shell owner/orchestrator, merged before portal 18 starts (CW4). **Portal 18 no longer edits `ShellLayout.tsx`**; it consumes `variant: 'kiosk'`. Serialize with F12 only if F12 touches `ShellLayout.tsx` (F12 owns `channelRouter/**` only, none expected). | Portal 18 still ships the frame; without PP-2 the kiosk shows shell chrome, which is a demo-quality regression, not a blocker. |
| **PP-3** | **Hosting headers/CSP**: `font-src 'self'` for the self-hosted skin fonts (news FU-4, F13 AC); `Referrer-Policy: no-referrer` + `Cache-Control: no-store` for `/display/*` (portal, EL-7 pattern). | `backend-host` (SPA host / header config), orchestrator-applied | F13 (fonts), portal 18 | One config edit each, in the orchestrator seam commit of the first consumer. | Fonts fall back to system stacks (E4-Q4 default reversed); `/display/*` headers are a must-have for portal 05/18 and are not optional. |
| **PP-4** | **Per-display realtime group** (portal FU-6): the hub's exercise group would broadcast one display's staging to every participant connection. | `exercise-portal` follow-up over the realtime hub (`ExerciseRealtimeHub` joins display sessions to `display:{exerciseId}:{displayId}`) | nothing in December | **Parked.** December ships 5 s ETag polling. | n/a |
| **PP-5** | **Identity grant model** `identity-auth-roles/09` (multi-org operation grants, COR-018) and the D1 "Posting as" chip (`posts/06`) — both Not Started. Not a follow-up but a platform dependency of press (Q-E5-2). | `identity-auth-roles`, `posts` | press 04 (`IReleaseOrgResolver` swap), press 07 (`ReleasingAsChip`) | Not required: press ships single-org-per-human behind `IReleaseOrgResolver`. | See DECEMBER-RELEASE Q-18. |

## Follow-up resolution ledger

Every numbered "foundation follow-up" the four channel features raised, and where it was resolved. The channel `implementation.md` files point here; their fallbacks are removed.
"Story" = foundation story (a changed AC/files), "FC" = a frozen-contract amendment above, "PP" = platform prerequisite.

| Source | Item | Resolution | Where |
|---|---|---|---|
| news FU-1 | `silent_rewrite` moves the Updated stamp, no `revisions[]` entry | Contract clarified (Updated stamp rule); `ContentItem.UpdatedScenarioTime` column | FC-1, FC-2, F01, F04, F06, F09 |
| news FU-2 | payload-only revise that does not move the stamp | `ReviseOptions.touchUpdatedStamp` (default true) | FC-7, F04, F07 |
| news FU-3 / press FU-1 / weather FU-4 / portal FU-4a | external skin-token registration (four spellings, **one** call), `ext.<ns>` allowlist + contrast, pluggable dateline format, token-object scope | `registerSkinTokens` + `registerSkinExtension` + `SkinScope`; `ISkinOverridesValidator`; `registerDatelineFormat` | FC-8a, FC-7, F13, F03, F14 |
| news FU-4 | font loading contract | `registerSkinFonts`; self-hosted woff2 supplied by each channel; CSP via PP-3 | FC-8a, F13, PP-3 |
| news FU-5 | compose-with-link seam | `openComposerWithLink(permalink)` | F21 |
| news FU-6 | (a) post-by-id hook (b) brand reset wrapper | (a) `usePostById` (b) `SkinResetBoundary` | F21, F13 |
| news FU-7 / weather FU-7 / portal FU-2 / press PC-5 | telemetry vocabulary additions (+ `payload.productType`) | one vocabulary edit for all channels | FC-6b, F02, F15 |
| news FU-8 / press FU-5 | named sanitizer profiles (`article-rich`, tables for press) | `ISanitizerProfileRegistry`; built-ins `plain`/`rich-basic`/`rich-tables`; news registers `article-rich` | FC-7, F04 |
| news FU-9 | inline video player importable without Social chrome | player lives in `core/media` (extract if needed) | F14 |
| press FU-2 | participant write path through the funnel; optional publish gate | participant-origin callers accepted; `IContentPublishGate` | FC-7, F04 |
| press FU-3 / weather FU-2 | `PublishOptions` for scheduled / inject-fired items; descriptor-resolved options; `DefaultAlertMapping` meaning | FC-7a (persist → replay → `ResolvePublishOptions`; `DefaultAlertMapping` is a suggestion only) | FC-7a, FC-2, F01, F04, F05, F07, F16, F17 |
| press FU-4 / weather FU-1 / portal FU-1 | channel-owned migrations | the ledger (M2 portal 01, M3 weather 02, M5 press 06) | § Migration ledger |
| press FU-6 | author-visible reads of an embargoed release | **no foundation change**: F06 stays the same 404; press 09 falls back to its author endpoint; F12's not-found handler must not swallow it (recorded as an F12 AC) | F06 note, F12 |
| press FU-7 | `pageCount` for `document` media | **no foundation change**: rides in press `payload.document`; `ContentMedia` is not extended (recorded in F14) | F14 note |
| press FU-8 | paired-post attribution of a participant cross-post | `ActingHumanId` read from the publish call | F18 |
| press FU-9 | edit-revision timestamp on first document attach | **no foundation change**: F04 already writes `edit` revisions per autosave; press 04 makes the first attach explicit | F04 (existing AC) |
| weather FU-3 | async, scoped payload validation | `ValidatePayloadAsync(json, PayloadValidationContext)`; descriptors are scoped services | FC-7, F02, F04 |
| weather FU-5 | multi-alert stacking/rotation in the one bar | AC on the alert bar | F11 |
| weather FU-6 | editor owns its delivery options | `registerContentKindEditor(kind, component, { ownsDeliveryOptions })` | FC-8, F17 |
| weather FU-8 | one Weather Desk outlet; idempotent defaults | AC | F03 |
| portal FU-3 | FC-4 additive routes | channel-owned route families index; `/display/*` is outside `ChannelRouter` | FC-4, F12 |
| portal FU-4b | server-side skin-override validator reuse | public `ISkinOverridesValidator` | FC-7, F03 |
| portal FU-5 | `display` session purpose / actor kind | **platform** | PP-1 |
| portal FU-6 | per-display realtime group | **platform, parked** | PP-4 |
| portal FU-7 / FU-9 | kiosk chrome stripping; kiosk watermark clause | **platform** | PP-2 |
| portal FU-8 | atomic featured reorder | `POST /api/content-items/feature/reorder` | FC-4, F07 |
| portal R-S1 | Social barrel exports, bounded recent-posts hook, brand scope, route helpers, read-only `PostCard` | new foundation story | F21 |
| portal R-W1 / R-P1 / R-N1 | weather tile `size='display'`; press `dek`/`outlet.name`/embargo; news courtesy | applied in the channel's own stories (weather 10, press 01/04/09), not the foundation; R-N1 needs nothing | weather 10, press 01/04, FC-3 |

## Cadence seam (PDF-06 #529) — recorded, not built
Cadence pushing injects and the clock into Pulse (E9, Phase 4) lands on `IContentPublishService` + the inject queue: a pushed article/release/product is a `ContentItem` created with
`origin: inject`, `ExternalSource: 'cadence'`, `ExternalRef: <cadence inject id>` (idempotent by the unique index, story 01), then fired by the inject queue (story 16). The clock is
already server-authoritative (`/api/clock`); Cadence-driven clock sync is E9's. Nothing in the foundation depends on Cadence.

## Open questions for Tom
The **consolidated, de-duplicated list across all five December features** (with IDs, defaults, impact and "decide first" markers) is [`../DECEMBER-RELEASE.md` § Open questions](../DECEMBER-RELEASE.md#6-open-questions-for-tom). Defaults below are what these stories assume; Q1–Q7 map to DECEMBER-RELEASE Q-01…Q-07.
| # | Question | Default assumed |
|---|---|---|
| Q1 | Retracted article/release: in-fiction tombstone at the permalink (headline hidden) or a plain "not found"? | Tombstone in the outlet's skin (XC-010 pattern). |
| Q2 | Press org newsrooms as child `Outlet`s of The Wire Room (one outlet row per publishing org)? | Yes. Letterhead per org = outlet logo + `ext.press` tokens. |
| Q3 | PDF upload for releases (PRS-002) needs a `document` kind in the media pipeline. **Effectively answered:** the press decomposition owns it (press stories 02 + 03); the foundation only carries `kind: document`. Confirm the PDF-first decision and its fallback in the release index (DECEMBER-RELEASE Q-03). | E5 owns it; foundation DTOs carry `kind: document`. |
| Q4 | Should channel-enablement gating also cover **social** (`/api/feed`, `/api/posts`)? Closes exercise-configuration AC3 fully. | Foundation gates only portal/news/press/weather; social gate is a one-line follow-up. |
| Q5 | Alerts in pilot mode: when a content publish raises an alert, also emit the SOC-072 platform notification? | Yes while the shell alert bar and notifications coexist; one logical alert, two renderings. |
| Q6 | Participant-authored releases (E5) publish through the same funnel as `origin: participant`; is a participant allowed to retract/revise their own release (PRS-005 says update)? | Revise yes, retract staff-only. |
| Q7 | Is "portal" a content channel? | No: it aggregates E4/E5/E6 + social; filler is `news` content tagged `background`. |
