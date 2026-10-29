# Implementation: News network (E4)

> The bridge between planning and orchestration (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Phase/release: December release (Tom, 10/21).**
> Builds **on** [`channels-foundation/implementation.md`](../channels-foundation/implementation.md). Contracts are referenced by name (`FC-1..FC-9`, seam interface names, `F##` = foundation story number)
> and are **not redefined here**. E4 registers exactly four things: a kind descriptor (`article`, `IContentKindDescriptor`, FC-7), a channel mount (`registerChannel`, FC-8), a kind editor
> (`registerContentKindEditor('article', …)`, FC-8) and skin token files. **E4 edits no foundation file**; every gap E4 found is **resolved** in the foundation or the platform (see § Foundation follow-ups — resolved).
> Waves below are E4-local; the combined cross-feature wave view is in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md) (E4-1 = CW3, E4-2 = CW4, **16 pulled from E4-3 into CW4** behind 15, E4-3's 17 and E4-4's 02 = CW5, E4-5 = CW6).

Backend root: `src/Pulse.WebApi/Features/News/` (descriptor only). Frontend root: `src/frontend/src/features/news/` (participant) and `src/frontend/src/features/controller/content/article/` (staff editor subfolder).

---

## E4's own contracts (small; everything else is FC-n)

### E4-C1 Article payload (`ContentItem.PayloadJson` for `kind: article`, validated by story 01)
`{ breaking?: { text } | null, dateline?: { place, agency? } | null, slugCode?: string, storyType?: 'breaking_hard_news'|'follow_up'|'human_interest'|'press_conference_recap' }`.
Participant projection: `{ breaking, dateline, slugCode }` (never `storyType`). Kicker, dek, byline, category, hero and media are existing FC-2 columns, **not** payload.

### E4-C2 Slot component contract (frontend, `features/news/`)
Every slot component is presentational with props `{ item: ChannelContentDto; skin: OutletSkin }` (plus slot-specific optional callbacks), no fetching, no routing. Slot → story → export:
| D3-P1 slot | Story | Export (file) |
|---|---|---|
| 2 masthead + section nav | 03 | `OutletMasthead`, `SectionNav` (`masthead/`) |
| 3 breaking | 07 | `BreakingSlot`, `BreakingBanner` (`breaking/`) |
| 4–5 kicker/hed/dek + byline·dateline·share slot | 04 | `HeadBlock` (`article/`) — hosts `ShareBar` from 09 |
| 5 share | 09 | `ShareBar` (`share/`), prop `onShare` |
| 6 hero + watermark chip | 05 | `HeroSlot`, `BroadcastPlayer` (`hero/`), optional `onPlayProgress` |
| 7 body, pull quote, embeds | 06 | `ArticleBody` (`body/`), optional `onEmbedOpen` |
| 8 correction / tombstone | 08 | `CorrectionSlot`, `RetractedTombstone`, `UpdatedStamp` (`revisions/`) |
| 9 discussion footer | 09 | `DiscussionFooter` (`share/`) |
| lists | 15 | `StoryList`, `StoryRow`, `LeadStory` (`home/`) |
| clutter | 14 | `ClutterSlot` (`clutter/`) |
04 imports these; 04 is the only story that owns the page-level DOM order. Telemetry (19) is wired by 04 through the optional callbacks, so 19 owns no file in 05/06.

### E4-C3 Skin registration
Each skin story exports `tokens: OutletSkinTokens` from `features/news/skins/<key>/tokens.ts` and one `registerSkinTokens(key, tokens, { fonts })` call (F13, FC-8a; the single registration call) collected in `features/news/skins/index.ts` (imported by
the mount, story 02); the `ext.news` schema is registered once with `registerSkinExtension('news', …)`. Skin keys: `newsline7`, `courier-ledger`, `national-wire`, `the-scoop` (must equal the `skinKey` values seeded by foundation 03). E4-specific token extensions live in the `ext.news`
namespace (FC-3b `ext`): `masthead` (`tv-bar|centered-nameplate|wire-strip|tabloid-flag`), `liveChip`, `slugCode`, `discussionLabel`, correction/tombstone label strings.

### E4-C4 Mapping to foundation revision kinds (FC-1)
`correction` = visible editor's note (08 slot); `silent_rewrite` = new body + "Updated" stamp, no marker; `update` = "Updated" stamp only. Retraction = tombstone (Q1 default). FC-1 states the Updated stamp rule (silent rewrite moves the stamp, no `revisions[]` entry) and F04's `ReviseOptions.touchUpdatedStamp` covers the payload-only breaking toggle (resolved FU-1/FU-2).

---

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 | `ArticleKindDescriptor : IContentKindDescriptor` (payload schema via async `ValidatePayloadAsync`, `article-rich` profile registered with F04's `ISanitizerProfileRegistry`, media rules, `ProjectPayload`, `DefaultAlertMapping` suggestion). No migration. `AddNewsChannel()` DI extension (orchestrator adds the `Program.cs` line + wiring test). | `Features/News/ArticleKindDescriptor.cs`, `ArticlePayload.cs`, `NewsServiceCollectionExtensions.cs`, tests | E4-C1 |
| 02 | Route table + `registerChannel({ id:'news' })` + thin containers over foundation hooks, `OutletSkinScope` per subtree, outlet index. Assembly only. | `features/news/{index.ts,routes.tsx,NewsChannel.tsx,containers/*}` | the news channel registration |
| 03 | Skin-driven masthead + collapsible section nav; props-only. | `features/news/masthead/**` | `OutletMasthead`, `SectionNav` |
| 04 | CSS-grid article page (well 1140 / body 680 / rail 340), head block, page states, DOM order, callback wiring for 19. | `features/news/article/**` | `ArticlePage`, `HeadBlock` |
| 05 | Hero slot + shared broadcast player wrapping the existing inline-player and `ContentMedia`; `WatermarkSlot` bottom-right. | `features/news/hero/**` | `HeroSlot`, `BroadcastPlayer` |
| 06 | `ArticleBody` over `SanitizedBody`; `<pulse-post>` render-prop with the F21 read-only `PostCard` / `usePostById` inside F13's `SkinResetBoundary`. | `features/news/body/**` | `ArticleBody` |
| 07 | Default-empty breaking slot, banner from `skin.breaking`; live merge. | `features/news/breaking/**` | `BreakingSlot`, `BreakingBanner` |
| 08 | Correction slot, Updated stamp, tombstone; live revise via foundation stream hook. | `features/news/revisions/**` | `CorrectionSlot`, `RetractedTombstone`, `UpdatedStamp` |
| 09 | `ShareBar` (callback `onShare` → `openComposerWithLink` from F21) and `DiscussionFooter`. | `features/news/share/**` | `ShareBar`, `DiscussionFooter` |
| 10–13 | Data-only token files + font declarations + contrast unit tests. | `features/news/skins/{newsline7,courier-ledger,national-wire,the-scoop}/**` | `tokens` (E4-C3) |
| 14 | Three clutter components + `ClutterSlot` Scoop-only guard. | `features/news/clutter/**` | `ClutterSlot` |
| 15 | Home composition by `homeLead` enum, categories, latest list, rail, coalesced live merge. | `features/news/home/**` | `OutletHome`, `StoryList`, `StoryRow`, `LeadStory` |
| 16 | Category list page over `StoryList`. | `features/news/section/**` | `SectionPage` |
| 17 | `ArticleEditor` registered via `registerContentKindEditor`; rich-text body, media inserter, post-embed picker, breaking field, participant-preview hookup. Staff COBRA. | `features/controller/content/article/{ArticleEditor,BodyEditor,MediaInserter,PostEmbedPicker,BreakingField}.tsx` | editor registration |
| 18 | Four pure-data templates + `applyTemplate` + picker. | `features/controller/content/article/templates/**` | `TemplatePicker`, `applyTemplate` |
| 19 | Two telemetry hooks (`content_video_*`, `content_embed_open`), invisibility test. | `features/news/telemetry/**` | `useVideoTelemetry`, `useEmbedTelemetry` |
| 20 | Skin-matrix/CANNOT-list suite, isolation additions, axe + keyboard + mobile e2e. | `Pulse.WebApi.Tests/News/**`, `features/news/testing/**`, `e2e/news/**` | — |

## Reuse map
- **Foundation seams (FC-n):** `IContentKindDescriptor` + `IContentPublishService` funnel (FC-7); `registerChannel()`, `OutletSkinScope`/`useOutletSkin`, primitives (`ScenarioDateline`, `WatermarkSlot`, `SanitizedBody`, `ContentMedia`, `LiveRegionAnnouncer`), data hooks (`useOutlets`, `useContentList`, `useContentItem`, `useContentViewTelemetry`, `useChannelStream`) (FC-8); `registerContentKindEditor`, `ContentAuthoringShell` (F17); `contentPermalink()` (FC-8/9.3).
- **Participant world:** brand tokens/`BrandThemeProvider` pattern (participant-shell); per-outlet CSS custom properties; **never** COBRA, **never** `@mui/icons-material`; FontAwesome only; MUI 9 `sx`-only system props.
- **Staff world (17, 18 only):** COBRA theme + `@/theme/styledComponents`, console list/confirm patterns, `useStaffSession`, the foundation preview renderer (COR-041).
- **Clock/time:** `core/clock` (`useScenarioTime`, `formatScenarioTime`), the shell's `scenarioNow`; no `Date.now`/`toLocale*` in participant code.
- **Media:** `core/media`, `ExerciseBands`, `isWatermarkRequired`, the existing inline video player, upload path (MIME/size/malware).
- **Social (read-only import):** `features/social/components/PostCard` for embeds, the composer for share; never forked.
- **Realtime:** `core/realtime/connection` via `useChannelStream` only (events `ContentPublished/Revised/Retracted`, FC-5).
- **Telemetry:** `core/telemetry` emitter + FC-6; the server emits publish/revise/retract/share.
- **Backend:** `PostSanitizer` (extend by profile), DI pattern of the existing feature slices, `WebApplicationFactory<Program>` wiring test (FC-9.10).
- **Plumbing:** shared axios client `core/services/api.ts`, `core/utils/validateEnv.ts`, React Query, foundation `mocks/` fixtures until live routes exist.

## Wave Plan (DAG-ready)
`F##` = channels-foundation story. Waves are **E4-local** and each carries a foundation gate; foundation merge order governs actual start. Backend exists; frontend stories run on `features/channels/mocks/` until the
foundation route they read is live (serial edge only for the final live wiring in 02/15, which already waits on F15/F12).

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Article kind descriptor | backend | `Features/News/**` (+ tests) | F02, F04 | 03, 05–14, 18 | E4-1 | M |
| 03 Masthead + nav | frontend | `features/news/masthead/**` | F02, F13 | 01, 05–14, 18 | E4-1 | M |
| 05 Hero + player + chip | frontend | `features/news/hero/**` | F02, F13, F14 | 01, 03, 06–14, 18 | E4-1 | M |
| 06 Body + embeds | frontend | `features/news/body/**` | F02, F13, F14, F21 (01 semantics) | 01, 03, 05, 07–14, 18 | E4-1 | M |
| 07 Breaking slot | frontend | `features/news/breaking/**` | F02, F13, F14 | 01, 03, 05, 06, 08–14, 18 | E4-1 | S |
| 08 Revisions + tombstone | frontend | `features/news/revisions/**` | F02, F13, F14 | 01, 03, 05–07, 09–14, 18 | E4-1 | M |
| 09 Share + footer | frontend | `features/news/share/**` | F02, F13, F14, F21 (compose-with-link), F18 (mock until live) | 01, 03, 05–08, 10–14, 18 | E4-1 | M |
| 10 Skin Newsline 7 | frontend | `features/news/skins/newsline7/**` | F13 | 01, 03, 05–09, 11–14, 18 | E4-1 | S |
| 11 Skin Courier-Ledger | frontend | `features/news/skins/courier-ledger/**` | F13 | 01, 03, 05–10, 12–14, 18 | E4-1 | S |
| 12 Skin National Wire | frontend | `features/news/skins/national-wire/**` | F13, F14 | 01, 03, 05–11, 13, 14, 18 | E4-1 | S |
| 13 Skin The Scoop | frontend | `features/news/skins/the-scoop/**` | F13, F03 | 01, 03, 05–12, 14, 18 | E4-1 | S |
| 14 Scoop clutter | frontend | `features/news/clutter/**` | F13 | 01, 03, 05–13, 18 | E4-1 | M |
| 04 Article page assembly | frontend | `features/news/article/**` | 03, 05, 06, 07, 08, 09; F13, F14, F15 (mock) | 15, 18, 19 | E4-2 | L |
| 15 Outlet home | frontend | `features/news/home/**` | 03, 07, 14 (10–13 for tests); F13, F14, F09/F15 (mock) | 04, 18, 19 | E4-2 | L |
| 18 Article templates | frontend (staff) | `features/controller/content/article/templates/**` | 01 | 04, 15, 19 | E4-2 | S |
| 19 News telemetry | frontend | `features/news/telemetry/**` | 05, 06 (callback props); F15, F02 (vocabulary) | 04, 15, 18 | E4-2 | S |
| 16 Section pages | frontend | `features/news/section/**` | 15 (StoryList), 03; F15 | 17 | E4-3 | S |
| 17 Article editor | frontend (staff) | `features/controller/content/article/{ArticleEditor,BodyEditor,MediaInserter,PostEmbedPicker,BreakingField}.tsx` | 01, 18; F17 (shell + registry), F07 | 16 | E4-3 | L |
| 02 News channel mount | frontend | `features/news/{index.ts,routes.tsx,NewsChannel.tsx,containers/*}` | 04, 15, 16, 10–13; F08, F12, F13, F15 | — | E4-4 | M |
| 20 News conformance | testing | `Pulse.WebApi.Tests/News/**`, `features/news/testing/**`, `e2e/news/**` | all E4; F20, F06, F07 | — | E4-5 | M |

**Foundation gates:** E4-1 starts after foundation Wave 2 (F02, F13, F14 merged; F03/F04 for 01's runtime wiring test; F21 from foundation Wave 1 for 06/09). E4-2 needs F15 only as a mock (real hooks in 02's wave). E4-3's 17 waits for F17 (Wave 4) and F07 (Wave 3). E4-4 (02) waits for F12 (Wave 3) and F15 (Wave 4). E4-5 (20) waits for F20 (Wave 5).
All file footprints within a wave are disjoint (distinct subfolders). Story 04 is the only one that imports other E4 slot stories, hence its wave after them.

### Integration seam (orchestrator-owned — never a wave story)
| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Orchestrator adds `AddNewsChannel()` (descriptor DI) in the same PR as story 01, with a `WebApplicationFactory<Program>` wiring test (descriptor resolves, funnel accepts `article`). |
| Participant composition root | `src/frontend/src/App.tsx` / foundation channel registry | Orchestrator imports `features/news` (registration side effect) once, with story 02. No builder edits the registry file. |
| Staff route registry | `features/staff/staffRouteRegistry` | No E4 entry needed: the article editor is reached through the foundation "Channel content" surface (F17). Editor registration import is added by the orchestrator with story 17. |
| Telemetry vocabulary | `core/telemetry/schema.ts` (`KNOWN_TELEMETRY_EVENT_TYPES`) | **Nothing to do for E4:** `content_video_play`, `content_video_progress`, `content_embed_open` are registered by foundation story 02 (FC-6b). |

## Foundation follow-ups — resolved
All nine requests were folded into the foundation (or the platform) in the December consolidation pass; **none remains open and no fallback is needed.** Source of truth:
[`channels-foundation/implementation.md` § Follow-up resolution ledger](../channels-foundation/implementation.md#follow-up-resolution-ledger).
| # | Request | Resolved in |
|---|---------|-------------|
| FU-1 | `silent_rewrite` moves `updatedScenarioTime`, adds no `revisions[]` entry | **FC-1** Updated stamp rule (+ `ContentItem.UpdatedScenarioTime`): F01, F04, F06, F09. E4-Q2 default now the contract. |
| FU-2 | Payload-only revise that does not move the stamp | **FC-7** `ReviseOptions.touchUpdatedStamp` (default true): F04, F07. Story 07's breaking toggle uses it. |
| FU-3 | External skin registration; `ext.news` allowlisted + in contrast check; pluggable dateline format | **FC-8a**: `registerSkinTokens` + `registerSkinExtension` (F13), `ISkinOverridesValidator` ext namespaces (F03), `registerDatelineFormat` (F14; story 12 registers `wire`). |
| FU-4 | Font loading contract | **FC-8a** `registerSkinFonts` (F13): self-hosted woff2 shipped in each skin's folder, lazy per scope, `font-src 'self'` via **PP-3**. Supplying/bundling the files is E4's (skin stories 10–13); whether to self-host at all is Q-10. |
| FU-5 | Compose-with-link seam | **Foundation story 21** `openComposerWithLink` (story 09 consumes). |
| FU-6 | (a) post-by-id hook (b) brand-token reset wrapper | (a) **Foundation story 21** `usePostById` + read-only `PostCard`; (b) **F13** `SkinResetBoundary`. |
| FU-7 | Telemetry vocabulary additions | **FC-6b**, applied once in **F02**. |
| FU-8 | Named sanitizer profile hook | **FC-7** `ISanitizerProfileRegistry` (F04); story 01 registers `article-rich`. |
| FU-9 | Inline video player importable without Social chrome | **F14**: the player lives in `core/media` (extracted if needed). |

## Cadence / E9 seam (recorded, not built)
A Cadence-pushed article is a `ContentItem` with `ExternalSource: 'cadence'` (foundation Cadence seam); the story-01 descriptor already validates it identically. The Beat asset picker (NWS-020 "via E9") is a disabled labelled entry in 17 until E9.

## Open questions for Tom (E4-specific; foundation Q1–Q7 assumed per defaults)
Consolidated and de-duplicated in [`../DECEMBER-RELEASE.md` § Open questions](../DECEMBER-RELEASE.md#6-open-questions-for-tom): E4-Q1 → Q-08, Q2+Q3 → Q-09, Q4 → Q-10, Q5 → Q-12, Q6 → Q-11, Q7 → Q-13, Q8 → Q-14, Q9 → Q-15, Q10 → Q-16.
| # | Question | Default assumed |
|---|----------|-----------------|
| E4-Q1 | **Epic text conflicts, flagged not rewritten:** (a) NWS-013 "always append an editor's note" vs. the quiet-rewrite lever (settled by D3-P4 into two renderings); (b) NWS-031 hardened from "comments out of scope at launch" to "no comments, ever". OK to amend the epic text on the sync PR? | Stories follow D3-P4/D3 as approved; epic edited on sync. |
| E4-Q2 | Does a **silent rewrite** move the "Updated" stamp (D3-P4) or may a controller also choose a *fully invisible* edit (no stamp)? (FC-1 states the stamp moves) | Stamp moves, per D3-P4; no fully-invisible option. |
| E4-Q3 | Setting/clearing **breaking after publish**: should it move the "Updated" stamp? | No (banner only): F04 `touchUpdatedStamp: false`. |
| E4-Q4 | **Fonts:** self-host the six open-license families (OFL) vs. system fallbacks, given exercises on restricted/air-gapped networks? | Self-host, lazy per outlet. |
| E4-Q5 | Ship **prepared example articles** per outlet (e.g. "Emergency Call Delays" in all four registers) as part of the December seed so a demo has content? Not an epic requirement. | No; outlets only (foundation 03). Content is authored. |
| E4-Q6 | December proceeds on D3 **exhibits 1a/1b fidelity** (grid + registers), though the full mockup (article states, homepage compositions per skin, mobile) is not delivered. Wait for the mockup or build to 1a/1b and iterate by token edit? | Build to 1a/1b; iterate via tokens. |
| E4-Q7 | **Rich-text library** for the article body editor: is there an approved library, or pick one (e.g. TipTap/Lexical)? | **Decided: Tiptap** (Tom, 10/29, Q-13); must emit only the story-01 allowlist. |
| E4-Q8 | A breaking article **suggests** an `advisory` alert-bar entry but never raises one itself (01). Confirm alerts stay an explicit publish option. | Confirmed as written. |
| E4-Q9 | **NewsNow (PDF-05):** mark "superseded by E4 for December"? E4's Newsline 7 skin + permalinks already cover the NewsNow target. | **Decided (Tom, 10/29): superseded; #528 closed.** |
| E4-Q10 | The embedded-post feature assumes **participants see posts only from their own exercise** and an article embedding a deleted post shows "post unavailable". OK? | Yes (XC-010 tombstone pattern). |
