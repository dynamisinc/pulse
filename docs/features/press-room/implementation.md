# Implementation: Press Room

> The bridge between planning and orchestration (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Phase/release: December release (Tom, 10/21).**
> Built **on** [`../channels-foundation/implementation.md`](../channels-foundation/implementation.md): FC-1..FC-9, the FC-7/FC-8 seams and the foundation story numbers (`F01`..`F20`) are referenced by name, never redefined.
> E5 registers: the `release` kind descriptor (`IContentKindDescriptor`), the `press` channel mount (`registerChannel()`), the `release` console editor (`registerContentKindEditor`) and `wire-room` skin tokens.
> **No foundation file is edited**; every gap E5 found is **resolved** in the foundation or the platform (§ Foundation follow-ups — resolved).
> Waves below are on the foundation axis; the combined cross-feature wave view is in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md).

Backend root: `src/Pulse.WebApi/Features/Press/` (new). Media pipeline files under `Features/Media/` are touched **only by story 02** (the foundation reserved `document` for E5, Q3).
Frontend root: `src/frontend/src/features/press/` (new; `contract/ composer/ wire/ release/ approval/ pdf/ skin/`). Console: `features/controller/content/editors/release/` and `features/controller/pressSettings/`.

## E5-owned contracts (named, frozen at story 01; additive-only after)

### PC-1 Release payload (`ContentItem.PayloadJson` for `kind: release`, validated by the descriptor)
`{ orgPersonaId, inputPath: 'pdf'|'rich'|'both', contact: { name, title?, phone?, email? }, dateline?: string, document?: { mediaId, fileName, pageCount }, boilerplate?: string, crossPost?: { text? } | null, approval?: { required: boolean } }`
- **Participant-safe projection** (`ProjectPayload`) exposes only `orgPersonaId`-derived org name/letterhead ref, `contact`, `dateline`, `document { mediaId, fileName, pageCount }`; never `crossPost`, `approval`, `inputPath`.
- `ContentItem.Dek` is **always non-empty** for a release: the composer has no dek field, so story 01's pure `ReleaseDek.Derive(headline, bodyText, orgName)` fills it (first sentence ≤ 160 chars; headline-only → `News release from {org}`); a console-authored explicit dek wins (portal R-P1). `outlet.name` in a release summary is the **publishing org** (the child newsroom outlet's name).
- Headline is the **only required field** at publish (D4-001); body and document are both optional (a headline-only release is allowed; the composer shows a non-blocking note).

### PC-2 Author wire shapes (participant, `camelCase`; C# records in `Features/Press/Contracts/`, TS + guards in `features/press/contract/`)
```jsonc
// ReleaseOrgDto — GET /api/press/orgs (orgs the signed-in human may release as, PRS-001 / COR-018)
{ "personaId": "guid", "outletId": "guid", "name": "Fulton County EM", "handle": "@FultonEM", "pairedHandle": "@FultonEM",
  "letterhead": { "logo": { /* ContentMediaDto */ } | null, "address": "…|null", "defaultContact": { /* contact */ } }, "approvalRequired": false }
// ReleaseAuthorDto — author/org-mate view (own org only). Superset of ChannelContentDto minus staff fields
{ "id": "guid", "orgPersonaId": "guid", "state": "draft|scheduled|pending_approval|returned|published|retracted",
  "headline": "…", "bodyHtml": "<sanitized>", "payload": { /* PC-1 author projection */ }, "media": [ /* ContentMediaDto */ ],
  "scheduledScenarioTime": "…|null", "updatedScenarioTime": "…|null", "lastEditedBy": { "displayName": "J. Alvarez" },
  "returnNote": { "text": "…", "byDisplayName": "…", "scenarioTime": "…" } | null, "permalink": "/press/fulton-county-em/slug", "version": 4,
  "revisions": [ { "number": 2, "kind": "update", "scenarioTime": "…", "note": "…|null" } ] }
// ReleaseWriteRequest — POST/PUT /api/press/releases (PUT carries "version"; stale = 409)
{ "orgPersonaId": "guid", "headline": "…", "bodyHtml": "<untrusted>", "contact": {}, "dateline": null, "documentMediaId": null, "imageMediaIds": [], "version": 0 }
```
`state` is E5's participant vocabulary mapped from FC-1 `ContentStatus` + approval records (`pending_approval` and `returned` are **E5 states on a foundation `draft`**, not new `ContentStatus` values).

### PC-3 Participant routes (`/api/press/*`, live participant session, **no exercise id in any URL/body**, each behind `RequireChannelEnabled('press')` and a PIO-permission + org-grant check)
`GET /api/press/orgs` · `GET /api/press/releases?org=&state=` (author/org-mate list) · `POST /api/press/releases` · `GET|PUT|DELETE /api/press/releases/{id}` (DELETE = own **draft** soft delete only) ·
`POST /api/press/releases/{id}/{publish|schedule|unschedule|revise}` · `POST /api/press/releases/{id}/crosspost-preview` · `POST /api/press/documents` (PDF upload, story 02/04) ·
Approval (story 06): `GET /api/press/approvals` · `GET /api/press/approvals/{releaseId}` (draft-diff) · `POST /api/press/approvals/{releaseId}/{approve|return}`.
Public reads reuse foundation **F06** (`/api/channels/press/content…`, `/api/outlets?channel=press`); E5 adds none. **There is no participant retract route** (Q6); staff retract uses F07.
Staff: `GET|PUT /api/press/settings` (approval routing; story 06/14). Publishing as an org from the console uses F07 + the F17 shell (story 13).

### PC-4 Seams E5 defines (interfaces in `Features/Press/Contracts/`)
| Name | Shape | Owner / impl |
|---|---|---|
| `IReleaseOrgResolver` | `ListOrgsAsync(humanId) → ReleaseOrg[]` · `CanReleaseAsync(humanId, personaId) → bool` — the *only* place "who may release as which org" is decided | 04 (impl over `Account.PersonaId` + `EnrollmentRoles.Pio`); swapped to the COR-018 multi-org grant model when `identity-auth-roles/09` lands, no caller changes |
| `IReleaseApprovalGate` | `EvaluateAsync(release, humanId) → Pass \| Hold(approvalId)` | interface + pass-through default in 01; real impl 06. Distinct from F04's `IContentPublishGate` (06 also registers one of those to audit a staff bypass) |
| `PressTelemetry` | the one emitter for every E5 server event (names below) | 01 (class + vocabulary), called by 04/05/06 |
| `IReleaseReactionHook` | `OnReleasePublishedAsync(ReleasePublishedEvent)` — E8/E10 consume; no-op default | interface 01, observer wiring 12 |

### PC-5 Telemetry vocabulary (additions only to FC-6; the `eventType` strings are registered once by foundation story 02, FC-6b — this table owns the payloads; `channel: 'press'`, `target: { entityType: 'content_item', entityId }`, actor = the **human**, `actor.orgPersonaId` for the shared org handle)
| `eventType` | Emitter | Payload |
|---|---|---|
| `press_release` (FC-6 existing) | server, funnel path (F04) | `{ kind:'release', inputPath, crossPost:boolean, embargoed:boolean, approvalRequired:boolean, draftStartedScenarioTime, draftToPublishSec, revisionCountAtPublish, orgPersonaId }` — never also `content_published` |
| `press_draft_created` | server (04) | `{ orgPersonaId, inputPath }` |
| `press_embargo_set` / `press_embargo_cancelled` | server (05) | `{ scheduledScenarioTime, orgPersonaId }` (cancel also `{ approversNotified }`) |
| `press_approval_requested` / `press_approval_approved` / `press_approval_returned` | server (06) | `{ approvalId, approverHumanId?, noteLength?, latencySec }` |
| `press_wire_view` | none — reuses client `article_view` with `payload.kind = 'release'` (F15) | |
Edit timeline (PRS-004) is **not** an event stream: it is the `ContentItemRevision` `edit` rows (F04), read by story 12's evaluator projection.

## Foundation follow-ups — resolved
All nine were folded into the foundation (or the platform) in the December consolidation pass; **none remains open and no fallback is needed.** Source of truth:
[`channels-foundation/implementation.md` § Follow-up resolution ledger](../channels-foundation/implementation.md#follow-up-resolution-ledger).
| # | Gap | Resolved in |
|---|-----|-------------|
| FU-1 | Skin tokens registration | **FC-8a** `registerSkinTokens` + `registerSkinExtension` (F13); E5 registers the final `wire-room` from `features/press/skin/`, replacing F13's stub; `ext.press` allowlisted by F03's `ISkinOverridesValidator`. Story 09. |
| FU-2 | Participant write path; optional publish gate | **F04**: participant-origin callers accepted (authorization stays at E5's endpoints); `IContentPublishGate` (`Allow(auditNote)` / `Hold`) — story 06 registers one to audit a staff bypass of a pending release. |
| FU-3 | Scheduled `PublishOptions` not persisted | **FC-7a** + `ContentItem.PublishOptionsJson` (F01), persisted by `ScheduleAsync` (F04/F07), replayed by F05. The interim `ReleaseCrossPostObserver` is **removed**; `PayloadJson.crossPost` remains only as the composer's draft-state checkbox. Story 05. |
| FU-4 | Second migration | **Migration ledger M5** (press 06, after M4 = F16). The `PressApprovalSettings`-as-JSON fallback is dropped. |
| FU-5 | Rich-text sanitizer profile with tables | **F04** built-in `rich-tables` (`ISanitizerProfileRegistry`); E5 registers nothing. |
| FU-6 | Author-visible reads of an embargoed release | **No foundation change.** F06 stays the uniform 404; story 09 falls back to the author endpoint; F12 has an AC that the router does not swallow it. |
| FU-7 | `ContentMediaDto.kind = 'document'` page count | **No foundation change.** `pageCount` rides in PC-1 `payload.document`; recorded in F14 so `ContentMedia` is not extended. |
| FU-8 | F18 attribution for a participant cross-post | **F18** AC: `ActingHumanId` is read from the publish call. |
| FU-9 | "drop → publish" bench needs an `edit` revision on first document attach | **No foundation change.** F04 already writes `edit` revisions per autosave; story 04 makes the first attach explicit. |

## Per-story tech notes
| Story | Approach | Key files (owns) | Exports (others import) |
|-------|----------|------------------|-------------------------|
| 01 | `ReleaseKindDescriptor : IContentKindDescriptor` (`Kind=release`, `ChannelId=press`, `AllowedMediaKinds=image,document`, rich `BodyPolicy`); PC-1/PC-2 records + TS types/guards + fixtures; `PressTelemetry`; `IReleaseApprovalGate` pass-through; `OrgNewsroomProvisioner` creates one child `Outlet` per publishing org under The Wire Room via F03's `OutletService` (idempotent, run on exercise setup and on grant); `ReleaseDek.Derive` (R-P1); body policy = F04's `rich-tables`. | `Features/Press/Contracts/**`, `Features/Press/Kind/**`, `Features/Press/Outlets/**`, `features/press/contract/**`, `features/press/mocks/**` | PC-1..PC-5, `IReleaseOrgResolver` interface |
| 02 | `MediaSniffer` gains a `%PDF-` allowlist entry; new `MediaKinds.Document`; size cap (default 20 MB, `MediaOptions`); `DocumentInspector` (structural parse only, no render): rejects encrypted, JS (`/JS`, `/JavaScript`), `/OpenAction`, `/Launch`, `/EmbeddedFile`, `/XFA`, `/AcroForm` submit actions, > N pages (default 60); extracts `pageCount` and a suggested headline (title metadata → first-page first line); stored/served **only** as `application/pdf` with `Content-Disposition: inline; filename=…`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and the SAS pinned content-type; existing malware-scan hook applies. | `Features/Media/{MediaSniffer,MediaUploadService,MediaDtos,MediaOptions,MediaEndpoints}.cs` (additive), `Features/Media/Documents/**` | `MediaKinds.Document`, `IDocumentInspector`, `DocumentInfo { pageCount, suggestedHeadline }`, `IDocumentUploadAuthorizer` (default-deny; 04 implements) |
| 03 | `PdfPages` renders a signed PDF URL page-by-page to canvas with pdf.js **in a worker, scripting/XFA disabled, `isEvalSupported:false`, no external fetch beyond the signed URL**; lazy page virtualization; per-page alt/label; download link; honest failure state. Lib is a dynamic import so the participant shell bundle does not grow. | `features/press/pdf/**` | `<PdfPages src pageCount title />`, `usePdfDocument` |
| 04 | `ReleaseAuthorService` over `IContentPublishService` (`CreateDraftAsync/UpdateDraftAsync`, `origin: participant`); `ReleaseOrgResolver : IReleaseOrgResolver`; `ReleaseAuthorDto` mapper (never staff fields); org-mate scoping (a release is visible to every human who may release as its org); document upload endpoint wraps story 02. | `Features/Press/Authoring/**` | `/api/press/orgs`, `/api/press/releases` (draft verbs), `/api/press/documents` |
| 05 | `ReleasePublishService` (publish/schedule/unschedule/revise) calls `IReleaseApprovalGate` first, then the funnel with `PublishOptions.pairedPost` only when the request says so; cancel-embargo writes a `PressReleaseEvent` and notifies approvers via story 06's `IApprovalNotifier`; `schedule` passes `PublishOptions{ pairedPost }` to `ScheduleAsync` so F04 persists and F05 replays it (no E5 observer); `crosspost-preview` composes the link card from the same projector F06 uses. | `Features/Press/Publishing/**` | publish/schedule/unschedule/revise routes |
| 06 | `PressApprovalService` + `PressApprovalSettings` + `PressReleaseEvent` entities + the one E5 migration (**M5** of the foundation ledger, after F16's M4); an `IContentPublishGate` for the audited staff bypass; `ApprovalGate : IReleaseApprovalGate`; approve → funnel publish with the **author as acting human** and the approver recorded; return requires a non-empty note; per-exercise routing + per-org defaults; approver = a participant holding the routed role **or a controller via the participant approval view** (C-1). | `Features/Press/Approval/**`, `Data/Entities/Press*.cs`, `Migrations/*` (M5 only) | `/api/press/approvals*`, `/api/press/settings`, `IApprovalNotifier` |
| 07 | The composer *is* the sheet: `ReleaseSheet` (letterhead + contact block + dateline + headline + body slot), `PdfDropZone`, `HeadlineSuggest`, `PasteFromWord` (secondary, behind a quiet affordance), `ImageAttach`, `ReleasingAsChip` (reuses the D1 chip component), `AutosaveStatus` (ambient). No form fields outside the sheet. Autosave debounced + on blur; 409 → non-destructive reload prompt. | `features/press/composer/sheet/**` | `<ReleaseComposer>`, slot `publishPanel`, slot `returnedBanner`, `ScheduledChip` |
| 08 | `PublishPanel` filling the composer's `publishPanel` slot: Now/Schedule (scenario-time picker), the sheet-line flip, redundant SCHEDULED chip, cross-post checkbox + live card, the **single** `ConfirmReleaseSheet` (org / headline / timing / cross-post), cancel-embargo confirm. | `features/press/composer/publish/**` | `PublishPanel` |
| 09 | `registerChannel('press', …)`; routes `/press`, `/press/:outletSlug`, `/press/:outletSlug/:contentSlug`; `WireList` (org filter), `NewsroomPage`, `ReleasePage` (letterhead, contact block, `PdfPages`, rich body via `SanitizedBody`, revision markers, tombstone, author-only scheduled banner); final `wire-room` skin tokens registered through `registerSkinTokens` / `registerSkinExtension` (FU-1 resolved); `WatermarkSlot`. | `features/press/wire/**`, `features/press/release/**`, `features/press/skin/**`, `features/press/index.ts` | `registerPress()` |
| 10 | `ApprovalInbox`, `ApprovalReview` with **draft-diff** (struck removals / shaded additions, text-not-color-only), approve confirm chip, return-with-required-note, `ReturnedBanner` consumed by the composer slot. | `features/press/approval/**` | `ReturnedBanner`, `useApprovals` |
| 11 | "Revise" mode of the composer on a published release: change fields + optional note → `update` revision; shows prior versions to the author; no retract affordance. | `features/press/composer/revise/**` | `ReviseDialog` |
| 12 | `PressReleaseObserver : IContentPublishedObserver` → `IReleaseReactionHook` (E8/E10); evaluator projection `GET /api/press/evaluation/releases` (staff) computing draft→publish, drop→publish, revisions, approval latency, embargo set/cancel, cross-post decision, per-human attribution; completeness test over PC-5; NFR-007 disclosure string served to the composer. | `Features/Press/Evaluation/**` | `/api/press/evaluation/releases`, `ReleasePublishedEvent` |
| 13 | `ReleaseEditor` registered via `registerContentKindEditor('release', …)`: org persona picker (any org, PRS-020), contact block, PDF/body, headline; COBRA only. Publish/schedule/retract come from the F17 shell. | `features/controller/content/editors/release/**` | the editor |
| 14 | Approval toggle, routing (approver role/persona), per-org defaults, default off. | `features/controller/pressSettings/**` | `PressSettingsPanel` |
| 15 | Press additions to the F20 kit + e2e + the drop→publish bench. | `Pulse.WebApi.Tests/Press/**`, `features/press/testing/**`, `e2e/press/**` | — |

## Reuse map
- **Foundation, by name:** FC-1 vocabulary, FC-2 entities (read via F04 only; E5 never writes `ContentItem` rows), FC-3 shapes (E5's author DTOs *extend* them), FC-5 events (`ContentPublished/Revised/Retracted` drive wire updates through `useChannelStream`, F09/F15), FC-6, FC-7 (`IContentPublishService`, `IContentKindDescriptor`, `IContentPublishedObserver`, `IPairedSocialPoster`, `IContentPermalinks`), FC-8 (`registerChannel`, `OutletSkinScope`/`useOutletSkin`, primitives `ScenarioDateline`, `WatermarkSlot`, `SanitizedBody`, `ContentMedia`, `LiveRegionAnnouncer`, hooks `useContentList/useContentItem/useChannelStream`, `registerContentKindEditor`).
- **Scheduler:** F05 `ContentScheduleRunner` (embargo release at scenario time, time-jump rule, freeze tier; replays the persisted `PublishOptions`) — E5 adds nothing to it.
- **Sanitizer:** `PostSanitizer` via F04's `ISanitizerProfileRegistry`, profile `rich-tables` (FU-5 resolved). **Media:** `Features/Media/*` (`MediaUploadService`, signed URLs, malware-scan hook), `core/media`, `ExerciseBands`, `isWatermarkRequired`.
- **Identity:** `Account.PersonaId` + `EnrollmentRoles.Pio` today; the COR-018 grant model later (behind `IReleaseOrgResolver`). Telemetry actor shape from `core/telemetry` and the server sink (per-human behind a shared org handle).
- **Social:** the D1 "Posting as" chip component (posts/06; if it is not built, story 07 builds `ReleasingAsChip` as a thin wrapper and the chip's component is extracted, not duplicated), `PostIngestService` only through F18.
- **Notifications:** the existing notifications feature for approver pings (kept wire-internal per D4-007 #3 — a wire inbox badge, not a platform push, in this release).
- **Clock:** `IExerciseClock` server-side; `core/clock` (`useScenarioTime`, `formatScenarioTime`) client-side. No `Date.now()` / `toLocale*` in `features/press/**` (lint-enforced like the rest of the participant world).
- **Two worlds:** participant code imports **no** `@/theme/styledComponents`, no COBRA theme, no default MUI look; surfaces mount under `OutletSkinScope` for `wire-room`. Staff stories 13/14 import `@/theme/styledComponents`. FontAwesome only. MUI 9 `sx`-only props.
- **Frontend plumbing:** `core/services/api.ts`, `core/utils/validateEnv.ts`, React Query. Mock fixtures in `features/press/mocks/` behind the axios client until each backend route lands.

## Wave Plan (DAG-ready)
`Fnn` = a channels-foundation story. A frontend story against a real E5 route waits for that route's backend story (serial edge: PC-2/PC-3 are the seam, no codegen); until then it runs on `features/press/mocks/`.

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 02 Document media kind | backend | `Features/Media/{MediaSniffer,MediaUploadService,MediaDtos,MediaOptions,MediaEndpoints}.cs` (additive), `Features/Media/Documents/**` | none (existing media pipeline) | F01, F02 | 1 | L |
| 03 Inline PDF rendering | frontend | `features/press/pdf/**` | 02 (contract only; mock PDF fixture) | F03, F04, F08, F09, F10, F13, F14 | 2 | M |
| 01 Kind, contracts, org newsrooms | fullstack | `Features/Press/{Contracts,Kind,Outlets}/**`, `features/press/{contract,mocks}/**` | F02, F03 (OutletService), F04 (`rich-tables` profile) | F05, F06, F07, F11, F12 (04 starts after 01's contracts/fixtures PR: same-wave serial edge) | 3 | M |
| 04 Release author API | backend | `Features/Press/Authoring/**` | 01 (contracts first), 02, F04 | F05, F06, F07, F11, F12 | 3 | L |
| 05 Publish/embargo/revise API | backend | `Features/Press/Publishing/**` | 01, 04, F04, F05; F18 for the cross-post AC (seam no-op until then) | 06, 07, F15, F16, F17, F19 | 4 | L |
| 06 Approval gate backend | backend | `Features/Press/Approval/**`, `Data/Entities/Press*.cs`, `Migrations/*` (**M5**, merged after F16's M4) | 01, 04, F04 | 05, 07, F15, F16, F17, F18, F19 | 4 | L |
| 07 Composer: letterhead sheet | frontend | `features/press/composer/sheet/**` | 01, 03, 04 (mock until live), F13, F14 | 05, 06, F15, F16, F17, F18, F19 | 4 | L |
| 08 Composer: publish panel | frontend | `features/press/composer/publish/**` | 07, 05 (mock until live), F05 (scenario-time semantics) | 09, 10, 11, 12, 13, 14 | 5 | M |
| 09 Wire, newsrooms, release page | frontend | `features/press/{wire,release,skin}/**`, `features/press/index.ts` | 01, 03, 07 (`ScheduledChip`), F06, F09, F12, F13 (`registerSkinTokens`), F14, F15 | 08, 10, 11, 12, 13, 14 | 5 | L |
| 10 Approval UI | frontend | `features/press/approval/**` | 06 (mock until live), 07 (banner slot), F13, F14 | 08, 09, 11, 12, 13, 14 | 5 | M |
| 11 Revise published release | frontend | `features/press/composer/revise/**` | 05, 07 | 08, 09, 10, 12, 13, 14 | 5 | S |
| 12 Telemetry + evaluation + hook | backend | `Features/Press/Evaluation/**` | 04, 05, 06, F04 (observers) | 08, 09, 10, 11, 13, 14 | 5 | M |
| 13 Console release editor | frontend | `features/controller/content/editors/release/**` | 01, 02, F17, F07 | 08, 09, 10, 11, 12, 14 | 5 | M |
| 14 Console approval settings | frontend | `features/controller/pressSettings/**` | 06, F17 (shell for placement only) | 08, 09, 10, 11, 12, 13 | 5 | S |
| 15 Press conformance + bench | testing | `Pulse.WebApi.Tests/Press/**`, `features/press/testing/**`, `e2e/press/**` | all E5 stories, F20 | — | 6 | M |

**File-disjointness check:** the only shared-file risk is `Migrations/*` (06 is M5, serialized after F16's M4 per the ledger); the skin is registered from E5's own folder, so no foundation token file is touched. Everything else is a new folder. 07/08/10/11 all live under `features/press/composer|approval` in disjoint sub-folders and meet through two declared slots (`publishPanel`, `returnedBanner`) in `ReleaseComposer`.

### Integration seam (orchestrator-owned — never a wave story)
| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | `AddPress()` / `MapPress()` added by the orchestrator in the same PR as each backend story (01, 02, 04, 05, 06, 12); each ships a `WebApplicationFactory<Program>` wiring test (routes mapped, descriptor registered with the funnel, observer registered, services resolve). |
| Descriptor/observer/gate registration | `AddPress()` registers `ReleaseKindDescriptor`, `PressReleaseObserver` and the approval `IContentPublishGate` as `IContentKindDescriptor` / `IContentPublishedObserver` / `IContentPublishGate` | orchestrator, with 01/06/12. |
| Channel registry | `features/channels/routing/registry.ts` | story 09 ships `registerPress()` (one `registerChannel('press', …)` call); the orchestrator wires the call into the participant composition root when it wires F12 (`App.tsx`, serial). |
| Staff route/editor registry | `features/staff/staffRouteRegistry` + `registerContentKindEditor` | orchestrator adds the `release` editor (default `ownsDeliveryOptions: false`) and the Press settings panel entries (13, 14). |
| Migration order | `Migrations/*` | Story 06's **M5**, after M4 (F16) per the foundation [migration ledger](../channels-foundation/implementation.md#migration-ledger). |

## Schedule risk — December release (Tom, 10/21)
Today is 10/29. The foundation is 5 waves; E5 adds a sixth. Risks, in order:
1. **PDF pipeline (02 + 03) is the long pole and a security surface.** It starts in Wave 1 (no foundation dependency) so it can finish in parallel; its malicious-PDF corpus tests are the gating review item. If it slips, the **fallback is rich-text-first with PDF as a download-only attachment** (no inline render) — a real regression from the PDF-first epic decision (PRS-002), so Tom should decide early.
2. **Participant write path (04/05)** is new surface the foundation did not build; F04 now explicitly accepts participant-origin callers (FU-2 resolved) and depends on F04 landing cleanly.
3. **Composer (07/08)** is the "critical screen" and the one most tied to the D4 mockup; keep it a sheet, not a form.
4. **Cut line if the date forces it (in order):** 14, 10, 06 (approval gate: off by default, a participant-visible feature only when an exercise enables it — ship without and the epic's default behavior still holds); then 11 (revise-own; PRS-005 stays available via a controller-side revise in F17); then 13 (controllers can use the generic F17 editor with the `release` payload fields as raw JSON — ugly, not blocking). **Not cuttable:** 01, 02, 03, 04, 05, 07, 08, 09, 12-telemetry (XC-004 from day one), 15's isolation/XSS parts.
5. **Identity grant model** (`identity-auth-roles/09`, Not Started) — if it does not land, December ships single-org release authoring (the human's bound persona) and JIC-as-shared-account only. See Q-E5-2.

## Open questions for Tom
Consolidated and de-duplicated in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md#6-open-questions-for-tom): Q-E5-1 → Q-17, Q-E5-2 → Q-18, Q-E5-3 → Q-03, Q-E5-4 → Q-19, Q-E5-5 → Q-20, Q-E5-6 → Q-21, Q-E5-7 → Q-22, Q-E5-8 → Q-23, Q-E5-9 → Q-06. Defaults are what the stories assume.
| # | Question | Default assumed |
|---|----------|-----------------|
| Q-E5-1 | Who may open the composer — the `pio` enrollment role only, or also any participant granted an org? | `pio` role **and** an org the human may release as; others see the wire read-only. |
| Q-E5-2 | Multi-org / JIC "Releasing as {org} ▾" depends on `identity-auth-roles/09` (Not Started) and the D1 chip (posts/06). Is December single-org-per-human acceptable if they do not land? | Yes: `IReleaseOrgResolver` returns the bound persona; the chip renders only when >1 org. |
| Q-E5-3 | PDF limits: 20 MB, 60 pages, no scripts/forms/embedded files, encrypted rejected. Right for exercises (agency PDFs are often 30+ MB with images)? | 20 MB / 60 pages, configurable via `MediaOptions`. |
| Q-E5-4 | In the author view, do org colleagues see each other's names ("last edited by J. Alvarez")? | Yes, display name only, own org only (needed for JIC coordination; per-human evaluation attribution stays staff/E10-side). |
| Q-E5-5 | Embargoed releases are invisible to **everyone** but author-org members and staff (epic §5 Q1 post-launch idea "media personas see it" is parked). Confirm. | Confirmed per epic recommendation. |
| Q-E5-6 | A controller publishing a release that is `pending_approval` — bypass the gate (default) or force it through approval? | Bypass, with a `press_approval_*` audit entry (controller authority; made explicit by F04's `IContentPublishGate` `Allow(auditNote)`, story 06). |
| Q-E5-7 | Approver-notification on embargo cancel / approval request: wire-internal inbox badge only (D4-007 #3), or also a platform notification? | Wire-internal only; platform push is the parked "reach beyond the wire" item. |
| Q-E5-8 | Is a headline-only release (no body, no PDF) publishable? D4-001 says headline is the only required input. | Yes, with a non-blocking composer note. |
| Q-E5-9 | Can a participant delete a **scheduled** (embargoed) release outright, or must they "cancel embargo" (returns to draft, notifies approvers, audit trace) first? | Cancel first, then delete the draft. |
