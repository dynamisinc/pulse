# Implementation: Demo feedback cut (10/20)

> **Status: contract FROZEN 2026-10-14 (Wed night).** Builders do not change the wire shapes, routes, schema or
> file ownership below. A change goes through the orchestrator, who amends this file in its own commit.
> Mechanics: [`ORCHESTRATION_MECHANICS.md`](../../ORCHESTRATION_MECHANICS.md) with the demo adaptations in
> [`PARTICIPANT-FIRST-DEMO-PLAN.md` §8](../../demo/PARTICIPANT-FIRST-DEMO-PLAN.md#8-how-we-run-it-orchestrator-pattern-adapted-for-12-days)
> (relaxed DoD: no Critical/High at Gate 1; Mediums and Lows become follow-up issues).

## Decisions (DF-n)

| # | Decision | Source |
|---|---|---|
| DF-1 | **Code freeze Sun 10/18 evening for backend and frontend.** The demo plan's Thu 10/15 backend freeze is replaced. Final reset + seed Mon 10/19 after the last deploy; rehearse before that on a test seed | Tom 10/14 |
| DF-2 | **Desktop only** for the demo (plan decision 5 stands). iPhone/iPad is the week after. The easy-login beat is shown on a laptop | Tom 10/14 |
| DF-3 | **Media marking is driven by the existing `Exercise.WatermarkEnabled`**, decoupled from the compliance banner. Participant client rule: `showBands = config.watermark \|\| !config.enabled` (the second term keeps NFR-008: chrome off ⇒ marked). The `ComplianceChromeGuard` mutual guard is unchanged | Tom 10/14 |
| DF-4 | Marking is an **overlay** (top and bottom bands reading `EXERCISE EXERCISE EXERCISE`) on every participant image and video surface, inline, in the viewer and full screen. Server-side burn-in of uploads is post-demo; the **stock demo files are burned in offline** (C1) | Tom 10/14 |
| DF-5 | **Pinned tab** = exercise pins (a controller pinned it for everyone) first, newest pin first; then the viewer's own pins and likes merged, newest first. De-duplicated, taken-down posts excluded, replies included, capped at 200 | Tom 10/14 |
| DF-6 | A **personal pin is a reaction of kind `pin`** (`ReactionKinds.Pin`): no new table, reuses the filtered unique index, participant sessions only. It never counts in `counts` and is never visible to anyone else | orchestrator |
| DF-7 | An **exercise pin is two columns on `Post`** (`PinnedForAllAt` scenario time, `PinnedForAllByHumanId`). Controller role only. Broadcast `PostPinChanged` to the exercise group so every Pinned tab updates live | orchestrator |
| DF-8 | **Export is `.xlsx` via ClosedXML 0.105.1** (latest stable, no advisories, checked 10/14; Cadence uses 0.105.0). One sheet, all posts and replies including taken-down ones, autofilter, frozen header. Any staff role may export, including evaluators | Tom 10/14 |
| DF-9 | **Import reads a Cadence MSEL export as-is** (`.xlsx` sheet `MSEL`, else the first sheet; or `.csv`). Only rows whose `Delivery Method` is social media become run-sheet items; everything else is reported as skipped. Each social row is **one single-post item** (bursts stay authored in the console or seeded) | Tom 10/14 |
| DF-10 | Import idempotency keys on the MSEL `Inject #`, stored in a new `InjectItem.ExternalRef`. Re-import updates unfired items that changed, leaves fired ones alone, never duplicates | orchestrator |
| DF-11 | `PlannedMinute` from the MSEL: minutes from the **earliest (Scenario Day, Scenario Time) of any data row in the file** (the StartEx row) to the row's own; Scenario Day defaults to 1. If no row has a Scenario Time, the same rule on `Scheduled Time`. Neither ⇒ unplanned (`null`) | orchestrator |
| DF-12 | **White noise = a pre-written pool + a server pacer**, no AI. Level `off \| low \| medium \| high` = 0 / 2 / 6 / 15 posts per minute, ±40% jitter. Persisted on `Exercise.NoiseLevel` so a restart keeps it. Posts publish through `PostIngestService` with a new origin **`noise`** | Tom 10/14 |
| DF-13 | Noise stops on **Freeze** (pause tier `Freeze` or a frozen clock), when the exercise clock is not running, and when the exercise lifecycle is not `staged` or `live` (EndEx, lifecycle pause; amended after 05 Gate-1). **Pause injects does not stop noise** (that is what the knob's Off is for). The pacer cycles the pool least-posted first, avoiding the same persona twice in a row | orchestrator |
| DF-14 | **Read-only console is UI only.** Evaluators are admitted to `/staff/console` (registry seam) and every write control is **absent, not disabled**, via one `useCanControl()` hook (`session.role === 'controller'`). Server-side enforcement stays on #61/#377. The backend already lets evaluators read every console endpoint (no 403 on `GET /api/injects`, `/api/steering/*`, `/api/engine/*`, `/api/feed`) | Tom 10/14 + backend map |
| DF-15 | **Emoji picker**: a library is allowed only if it works with React 19, renders **native** emoji, and makes **no runtime network call** (exercise networks are locked down; NFR / #52). Self-host any data file under `public/`. Verify the current version and advisories before adding (candidates checked 10/14: `frimousse` 0.4.0 headless, `emoji-picker-react` 5.0.0; no advisories) | orchestrator |
| DF-16 | **The on-stage import uses the Kestrel run sheet rendered as a Cadence MSEL** (C2), padded with non-social rows so the skip is visible. The seed then loads only the burst items (`-RunSheet bursts`) so the import does not duplicate them | Tom 10/14 |

## Where the brief met the code (10/14 map)

- `PostReaction.Kind` is a free string (max 16), validated in code by `ReactionService.TryParseKind`; there is no
  check constraint, so `pin` needs no migration for the kind itself.
- There is **no "posts I liked" endpoint**: the profile Likes tab filters `GET /api/feed?includeReplies=true` client-side
  on `viewer.liked`, and the feed is capped at 200. The Pinned tab therefore gets a server read (04).
- `Post.Origin` already distinguishes `participant`, `controller-as-persona`, `inject`, `engine`
  (`PostIngestService.AllowedOrigins`); `InjectId` holds the inject item id; `ActingHumanId` is the person.
- The participant client does **not** receive `watermarkEnabled` (`ChromeConfigResponse` is `{Enabled, Top, Bottom}`);
  01 adds it.
- Run sheet routes are **`/api/injects`** (not `/api/staff/...`); reads need any assigned staff, writes need the
  controller role (`EngineCockpitControllerRoleFilter`). The run sheet polls every 3 s, so imported items appear
  without a push.
- Staff-only pushes go to `ExerciseRealtimeHub.StaffGroupNameFor(id)` (`exercise:{id}:staff`); participant pushes to
  `GroupNameFor(id)`.
- Evaluators cannot reach `/staff/console` today (`staffRouteRegistry.tsx`: controller only). Console write controls
  have **no** role gating; `useControllerIdentity().role` is hard-coded and must not be used (see
  `ExerciseLifecycleControl.tsx:47-55`, which gates on `useOptionalSession()?.role`).
- #493's cause: `RunSheetField.tsx:117-118` forces a shrunk outlined label onto the input's white fill in light
  `chrome.inkMuted`.

## Frozen wire contract

### Schema (story 01, ONE migration `DemoFeedbackPinsNoiseImport`)

| Entity | Change |
|---|---|
| `Post` | `PinnedForAllAt DateTimeOffset?` (scenario time), `PinnedForAllByHumanId string? (max 128)`; index `(ExerciseId, PinnedForAllAt)` filtered `PinnedForAllAt IS NOT NULL` |
| `PostReaction` | constant `ReactionKinds.Pin = "pin"` only (no column change) |
| `InjectItem` | `ExternalRef string? (max 64)`; filtered unique index `(ExerciseId, ExternalRef)` where `ExternalRef IS NOT NULL AND DeletedAt IS NULL` |
| `Exercise` | `NoiseLevel string (max 8, required, default 'off')` |
| `NoisePost` (new, `IExerciseScoped`) | `Id, ExerciseId, PersonaId, Text (column max 1024, like `InjectItemPost.Text`; content 1–280 **code points**, validated in code), Order int, PostedCount int default 0, LastPostedWallClock DateTimeOffset?, CreatedWallClock`; index `(ExerciseId, PostedCount, Order)` |

Hand-written SQL naming a column added in the same migration is `EXEC(N'…')`-wrapped; `IdempotentMigrationScriptTests`
must replay it (#413).

### Routes

| Route | Gate | Story |
|---|---|---|
| `GET /api/chrome-config` | unchanged | 01 adds `watermark: boolean` to the response |
| `GET /api/staff/exports/posts.xlsx` | staff (any assigned role) + `no-store` | 02 |
| `POST /api/injects/import?dryRun=true\|false` (multipart `file`) | staff + controller role | 03 |
| `PUT` / `DELETE /api/posts/{postId}/reactions/pin` | existing reaction route; participant sessions only | 04 |
| `PUT` / `DELETE /api/staff/posts/{postId}/pin` | staff + controller role | 04 |
| `GET /api/feed/pinned` | participant session (staff: exercise pins only) | 04 |
| `GET /api/staff/noise` | staff (any role) | 05 |
| `PUT /api/staff/noise` `{ level }` | staff + controller role | 05 |
| `PUT /api/staff/noise/pool` | staff + controller role | 05 |

### Types

```ts
// ---- 01: chrome config (participant) ------------------------------------------------------
interface ChromeConfig { enabled: boolean; top: …; bottom: …; watermark: boolean }   // + watermark

// ---- 04: post view additions (feed, thread, PostReceived, pinned feed) ---------------------
interface ParticipantPostView {
  // …existing fields…
  pinnedForAll?: true                     // omitted when not pinned for everyone
  viewer?: { liked: boolean; reposted: boolean; pinned: boolean }   // + pinned
}
// PUT/DELETE /api/posts/{id}/reactions/pin → ReactionStateDto (counts unchanged; viewer.pinned flips)
// PUT/DELETE /api/staff/posts/{id}/pin     → 204; 404 when the post is not in the exercise or taken down
interface PinnedFeedItem { reason: 'exercise' | 'pin' | 'like'; post: ParticipantPostView }
interface PinnedFeedResponse { items: PinnedFeedItem[] }            // GET /api/feed/pinned, DF-5 order
// SignalR, exercise group: 'PostPinChanged' { postId: string; pinnedForAll: boolean }

// ---- 05: white noise ----------------------------------------------------------------------
type NoiseLevel = 'off' | 'low' | 'medium' | 'high'
interface NoiseStateDto {
  level: NoiseLevel; ratePerMinute: number            // 0 / 2 / 6 / 15
  poolSize: number; postedCount: number               // postedCount = total noise posts this exercise
  lastPostedAt?: string                               // scenario time
  running: boolean                                    // false while frozen / clock stopped / level off
}
// PUT /api/staff/noise { level } → NoiseStateDto
// PUT /api/staff/noise/pool { mode: 'replace' | 'append', posts: { persona: string /* handle or id */; text: string }[] }
//   → { poolSize: number; rejected: { index: number; reason: string }[] }   (≤ 1000 posts per call)
// SignalR, staff group: 'NoiseStateChanged' NoiseStateDto   (on level change and every published noise post)

// ---- 03: MSEL import ----------------------------------------------------------------------
interface InjectImportRowDto {
  rowNumber: number; injectNumber?: string; title?: string; personaHandle?: string; plannedMinute?: number
  status: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'
  message?: string                                     // reason for skipped/failed; warnings for the rest
}
interface InjectImportResultDto {
  dryRun: boolean; totalRows: number; socialRows: number
  createdCount: number; updatedCount: number; unchangedCount: number; skippedCount: number; failedCount: number
  rows: InjectImportRowDto[]
}
```

### MSEL columns (03; headers matched case-insensitively, trimmed; unknown columns ignored)

Cadence's export (`MselWorksheetBuilder` / `ExcelFormattingHelper.MselColumns`) writes, in order: `Inject #`, `Title`,
`Description`, `Scheduled Time`, `Scenario Day`, `Scenario Time`, `From / Source`, `To / Target`, `Delivery Method`,
`Track`, `Phase`, `Expected Action`, `Notes`, `Priority`, `Location`, `Responsible Controller` (+ conduct columns
`Status`, `Fired At`, `Fired By` when exported with conduct data).

| MSEL column | Required | Run-sheet field |
|---|---|---|
| `Inject #` | yes | `ExternalRef` (DF-10); title fallback `Inject {#}` |
| `Delivery Method` | yes | filter: social when, trimmed and case-insensitive, it equals `Social Media`, `Social`, `Pulse`, or contains `social` |
| `From / Source` | yes | persona: leading `@` stripped, handle match, then exact display-name match (case-insensitive), **in this exercise only** |
| `Description` | yes | post text (≤ 280 after sanitising, else the row fails) |
| `Title` | no | item title (≤ 120, truncated with a warning) |
| `Scenario Day`, `Scenario Time`, `Scheduled Time` | no | `PlannedMinute` (DF-11) |
| `Notes` | no | item notes (≤ 500, truncated with a warning) |
| `Responsible Controller` | no | assignee by display name from the assignee list, else unassigned with a warning |
| `Pulse Media` (Pulse extension) | no | comma-separated media-library file names (≤ 4 images or 1 video); an unknown name fails the row |

Limits: file ≤ 2 MiB, ≤ 2,000 data rows, `.xlsx` (magic bytes `PK`) or `.csv` (UTF-8, BOM tolerated, quoted
multi-line cells). `?dryRun` returns the same report and writes nothing.

### Export columns (02, sheet `Posts`)

`Scenario time` · `Wall clock (UTC)` · `Author handle` · `Author name` · `Author type` (`Participant`,
`Controller as persona`, `Scripted inject`, `Engine`, `White noise`; from `Origin`) · `Posted by` (the acting human's
display name; blank for engine and white noise) · `Inject #` (the item's `ExternalRef`, else its title) · `Post id` ·
`Reply to` (`@handle` + post id) · `Text` · `Media` (e.g. `2 images`, `1 video`) · `Likes` · `Reposts` ·
`Replies` (real counts) · `Shown likes` · `Shown reposts` · `Shown replies` (baseline + real) · `Pinned for all` ·
`Status` (`Live` or `Taken down`) · `Taken down at`.

### Telemetry (XC-004, counts only, no text, no names)

`export.posts.downloaded {rows}` (02) · `injects.imported {created, updated, unchanged, skipped, failed, dryRun}` (03) ·
`post.pinned` / `post.unpinned {scope: 'exercise'|'personal'}` (04) · `noise.level.changed {from, to}` and
`noise.pool.replaced {poolSize}` (05).

## Reuse map

| Need | Reuse | Do not |
|---|---|---|
| Staff gates | `EngineCockpitStaffAuthorizationFilter`, `EngineCockpitControllerRoleFilter`, `NoStoreEndpointFilter`, the nested empty-prefix group pattern in `ModerationEndpoints.cs:79-87` | invent a new role check |
| Upload handling | `RosterEndpoints.ImportAsync` (`?dryRun` parsing, size limit attribute, `DisableAntiforgery`, 400 reasons) | buffer an unbounded body |
| Text cleaning | `PostSanitizer` | write a new sanitiser |
| Inject creation | `InjectItemValidator` limits + `InjectQueueService` write path | bypass the validator or the queue version token |
| Server publish | `PostIngestService.IngestAsync` + `PostAttribution` | write `Post` rows directly |
| Staff push | `ExerciseRealtimeHub.StaffGroupNameFor` as in `EngineReviewBroadcaster` | push staff data to the exercise group |
| Participant push | `SignalRFeedBroadcaster` / `realtimeFeed.ts` | open a second hub connection |
| Background timing | `InjectBurstRunner` (tick, fresh scope, `ExerciseContext.CurrentExerciseId`, pause-tier skip) and `IExerciseClock` | use wall clock for anything a participant sees |
| Role gating (FE) | `useOptionalSession()?.role` as in `ExerciseLifecycleControl.tsx:110-113` | `useControllerIdentity().role` |
| Staff look | COBRA components, `consoleChrome.ts` tokens | MUI defaults on staff; COBRA on participant paths |

## Wave plan

`Effort`: S ≤ ½ day of agent time, M ≈ 1 day. Every frontend story builds against mocks behind the existing
`USE_MOCK_*` switches and makes one live check once its backend is deployed.

| Story | Stack | Pri | Files it owns | Depends on | Wave | Effort |
|---|---|---|---|---|---|---|
| 01 Foundation | backend | Must | `Data/Entities/{Post,PostReaction,InjectItem,Exercise,NoisePost}.cs`, `Data/PulseDbContext.cs`, the one migration + snapshot, `Features/Social/PostIngestService.cs` (`AllowedOrigins` += `noise` only), `Features/ParticipantShell/ParticipantShellDtos.cs`, `Features/ExerciseConfiguration/Chrome/ChromeConfigProjection.cs`, `ParticipantShellConfigService.cs` (watermark only), their tests | none | 0 | S |
| 02 Export | backend | Must | new `Features/Exports/**` (+ tests) | seam S-1 | 1 | M |
| 03 MSEL import | backend | Must | new `Features/Injects/Import/**`; `Features/Injects/InjectQueueService.cs` + `InjectWriteRequests.cs` (only to carry `ExternalRef` through the existing write path) (+ tests) | 01, S-1 | 1 | M |
| 04 Pins | backend | Must | new `Features/Social/Pins/**`; `Features/Social/Reactions/ReactionService.cs` (kind `pin`); `Features/Social/Engagement/{IPostEngagementReader,PostEngagementReader}.cs` (`ViewerPinned`, pin excluded from counts); `ParticipantPostDto.cs`, `PostWireDtos.cs`, the participant post projector; `Features/Realtime/SignalRFeedBroadcaster.cs` + its interface (`PostPinChanged`) (+ tests) | 01 | 1 | M |
| 05 White noise | backend | Must | new `Features/WhiteNoise/**` (+ tests) | 01 | 1 | M |
| 06 Media bands | frontend | Must | `participant-shell/{chromeConfig.ts,mountContract.ts}` (+ mocks), `social/components/media/**`, `social/components/ComposerMedia.tsx` (bands on previews only) | contract | 2 | M |
| 07 Pinned tab | frontend | Must | `social/layout/routes/HomeView.tsx`, new `social/pinned/**`, `social/components/post/PostActions.tsx`, `social/types/post.ts` (+ `post.provenance.test.ts`), `social/services/realtimeFeed.ts` (`subscribePinChanged`), `social/services/postService.ts` mocks | contract | 2 | M |
| 08 Live world pin + unread | frontend | Must | `controller/liveWorld/**` | contract (07's `realtimeFeed.subscribePinChanged` by name) | 2 | M |
| 09 Noise knob + Export | frontend | Must | new `controller/noise/**`, new `controller/export/**`, `controller/components/ControllerConsole.tsx` (steering row + title row only), the `noise` origin in `social/types/post.ts` (`PostOrigin` only), `core/telemetry/schema.ts` and `originConsoleLabel` in `social/services/postService.ts` | contract | 2 | M |
| 10 Run sheet import + #493 | frontend | Must | new `controller/runSheet/import/**`, `controller/runSheet/RunSheetPanel.tsx` (toolbar button + dialog mount only), `controller/runSheet/RunSheetField.tsx` | contract | 2 | M |
| 12 Emoji picker | frontend | Should | new `core/emoji/**`, `social/components/Composer.tsx` (`ComposerForm` tools row + internal ref), `src/frontend/package.json` + lockfile, `public/emoji/**` if data is self-hosted | none | 2 | S |
| 11 Read-only console | frontend | Must | new `controller/access/**`; gating lines in `ControllerConsole.tsx`, `PersonaComposer.tsx`, `runSheet/{RunSheetPanel,RunSheetRow,InjectItemEditor}.tsx`, `liveWorld/{TakedownAction,PinForAllAction}.tsx`, `steering/{PausePill,EscalationDial}.tsx`, `EngineControlBar`, `ReviewQueue.tsx`, `noise/**`, a "View only" chip | 08, 09, 10, 12 merged | 3 | M |
| 13 Participant polish | frontend | Should | tooltips across `social/**` icon buttons; `SocialChannel.module.css`, `SocialChannel.layout.test.tsx`, `layout/frameMetrics.ts` (#495) | 06, 07 merged | 3 | S |
| 12b Emoji in persona composer | frontend | Should | `controller/components/PersonaComposer.tsx` (one button) | 12 merged; before 11 | 3 | S |
| S1 Seed script | script | Must | `scripts/uat/Seed-DemoContent.ps1` (+ `.Tests.ps1`, `README-seed.md`, `test-fixtures/demo-pack/**`), `docs/demo/pack/schema/pack.schema.json` | 04, 05 deployed | 3 | M |
| C1–C3 Content | content | Must | `docs/demo/pack/**` except `schema/` (on the #491 branch) | none | any | — |

**Why 03 depends on 01:** `ExternalRef` is a column. **Why 11 is last:** it adds one gating line to files that 08, 09,
10 and 12b own, so it runs after they merge, alone. **Why 13 waits:** its tooltips touch `PostActions.tsx` (07) and
the media buttons (06).

### Calendar (today is Wed 10/14)

| When | What |
|---|---|
| **Wed 10/14 night** | Docs + seam S-1 on the umbrella. **Backend W0/W1 start: 01 ∥ 02.** 03 starts the moment 01 merges into the umbrella |
| **Thu 10/15** | 01 merged (🧑 Tier-2: schema) → 04 ∥ 05 start; 03 continues. FE W2 starts on mocks: 06 ∥ 07 ∥ 08 ∥ 09 ∥ 10 ∥ 12. Internal review |
| **Fri 10/16** | Backend Gate 1 + Gate 2 → **umbrella PR to `main`** → deploy + reset. FE W2 live checks against UAT. C1–C3 content on #491 |
| **Sat 10/17** | FE W2 merges → frontend deploy. W3: 12b, then 11; 13 in parallel. S1 seed script. Rehearsal 1 on a test seed |
| **Sun 10/18** | Fixes. Manual UAT walk (`feature.md`). **Pencils down evening**: last backend + frontend deploy |
| **Mon 10/19** | Final reset + seed (`-RunSheet bursts`), rehearsal 2 |

### Integration seam (orchestrator-owned, never a wave story)

| Seam | File(s) | When |
|---|---|---|
| S-1 Excel package | `src/Pulse.WebApi/Pulse.WebApi.csproj`: `ClosedXML` 0.105.1 | Before W1 (done on the umbrella 10/14) |
| S-2 Backend composition root | `src/Pulse.WebApi/Program.cs`: `AddPostExport()/MapPostExport()`, `AddInjectImport()/MapInjectImport()`, `AddPostPins()/MapPostPins()`, `AddWhiteNoise()/MapWhiteNoise()` (after `AddInjects`/`AddPauseTierSteering`), one commit; `CompositionRootWiringTests` asserts each new route maps exactly once. **Also** add `.WithExposedHeaders("Content-Disposition")` to the CORS policy so story 09 can read the export file name cross-origin (02 Gate-1 M2). **Merge 01 with a real merge, never a squash**: 02-05 merged earlier 01 heads, and a squash would bring back the superseded migration file (02 Gate-1 M3) | After backend W1 merges |
| S-3 Staff registry | `features/staff/staffRouteRegistry.tsx`: `/staff/console` `allowedRoles: ['controller', 'evaluator']` (default for controller only) + its test; a console entry in the evaluator's surface launcher | With 11 |

## Gotchas that will bite a parallel builder

- **One migration.** Only 01 touches the snapshot. 03/04/05 never add a migration; if one seems needed, stop and
  ask the orchestrator.
- **Build lock.** C: has ~13 GB free. Run every `dotnet build/test` and `npm run test:run` through
  `pwsh -File C:\Code\pulse-build-lock.ps1 <command>` so parallel sessions never cold-build together. If it reports
  under 4 GB free, stop and say so.
- **Pins never change counts.** `PostEngagementReader` must count `like` and `repost` explicitly, never "all kinds".
- **Noise is not an inject.** It must not appear in the run sheet or obey Pause injects (DF-13), and its origin is
  `noise`, not `inject`.
- **Export formula safety.** Write every cell as a text/number value (never `FormulaA1`); a participant post that
  starts with `=` must open in Excel as text.
- **Scenario time only on participant surfaces.** The export (staff) may show wall clock; the Pinned tab and noise
  posts may not.
- `useControllerIdentity().role` is hard-coded `'controller'`; gate on the session role (DF-14).
- A test pins `PostViewerState` keys to exactly `['liked','reposted']` (`post.provenance.test.ts:163`); 07 updates it.
- `SocialChannel.layout.test.tsx:153-155` pins `justify-content: start`; 13 updates it with #495.

## Risks

| Risk | Mitigation |
|---|---|
| 01 slips and blocks 03/04/05 | 01 is S and starts first; Tier-2 review Thursday morning |
| A backend deploy after seeding wipes in-memory engine state | Seed Monday after the last deploy (DF-1) |
| Noise floods the demo | Default `off`; High is 15/min, well under the 120/min burst-legibility bar (NFR-002) |
| Import maps the wrong persona | Dry-run first in the UI (10); unknown handles fail the row, never fall back |
| Evaluator still has write power at the API | Accepted for the demo (DF-14); say so if asked; #61/#377 after |

### S-2 checklist (from the five Gate-1 reviews, 10/14–15)

- **Merge order:** 01 → 02 → 03 → 04 → 05 into `feature/demo-feedback`, each a **real merge** (no squash); after each, `Data/Migrations` must hold exactly one `20261014202342_DemoFeedbackPinsNoiseImport`.
- **DI** (`Program.cs`): `AddPostExport()`; `AddPostPins()` after `AddSocialReactions()` / `AddSocialRealtimeHub()` / `AddExerciseClock()` and staff identity; `AddInjectImport()` and `AddWhiteNoise()` after `AddInjects()` (which is after `AddPauseTierSteering()`).
- **Routes:** `MapPostExport()`; `MapPostPins()` at **top level** (never inside `DenyReadOnlySessions()`, or a view-only `GET /api/feed/pinned` is refused); `MapInjectImport()` and `MapWhiteNoise()` beside `MapInjects()`.
- **CORS:** `.WithExposedHeaders("Content-Disposition")` (09 reads the export file name).
- **Pacer in tests:** confirm 05's `FirstSweepDelay` landed; otherwise remove the `WhiteNoisePacer` hosted service in the `WebApplicationFactory` fixtures.
- **`CompositionRootWiringTests`:** each maps exactly once: `GET /api/staff/exports/posts.xlsx`; `POST /api/injects/import` (staff + controller filters); `GET /api/feed/pinned`, `PUT`/`DELETE /api/staff/posts/{postId:guid}/pin`; `GET`/`PUT /api/staff/noise`, `PUT /api/staff/noise/pool`. One `WhiteNoisePacer` hosted service; `IFeedBroadcaster` → `SignalRFeedBroadcaster`; `INoiseBroadcaster` → `NoiseBroadcaster`; `INoiseJitterSource` → `CryptoNoiseJitterSource`; `PinService` / `PinnedFeedService` / `InjectImportService` resolve.
- **Afterwards:** flip stories 01–05 to In Review and tick their ACs; file one follow-up issue with the remaining Gate-1 Mediums/Lows (02 M1/M4 + L1–L6, 03 L1–L7, 04 L2–L6, 05 L2–L4/L7–L10, 01 L2/L5); then the umbrella PR to `main` (Copilot review, Gate 2).
