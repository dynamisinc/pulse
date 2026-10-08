# Implementation: Inject queue & conduct timeline

> Staff-world continuous-watch rail in the console. Publishes through the channel pipelines (E2
> social in Phase 1). Runs on the native exercise clock (COR-050). Backend not present — the queue +
> fire endpoints are the serial backend-contract seam; mock behind the axios client now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Timeline | Queue model + timeline rail bound to the scenario clock. | `features/controller/components/queue/ConductTimeline.tsx`, `hooks/useQueue.ts`, `types/queue.ts` | `useQueue()`, `QueueItem` type |
| 02 Fire/hold/skip/edit | Queue mutations that publish via the channel pipeline with dual-time capture. | `features/controller/services/queueActions.ts`, `components/queue/QueueItemActions.tsx` | `fireItem()`, `holdItem()`, `skipItem()`, `editThenFire()` |
| 03 Scheduler | "Hold for conduct" affordance + scheduled scenario time on the composer. | `features/controller/components/queue/HoldForConduct.tsx` | `scheduleItem()` |
| 04 Bursts | Bundle item type + pacing scheduler honoring world-pause. | `features/controller/services/burstScheduler.ts`, `components/queue/BundleProgress.tsx` | `fireBundle()` |
| 05 Time-jump disposition | Pause-gated jump dialog + batch disposition over spanned items. | `features/controller/components/queue/TimeJumpDialog.tsx` | `<TimeJumpDialog>` |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- console-shell rail/column host + `registerTool()` — mounts the timeline (continuous-watch)
- **E2 social publish pipeline** — fire/backfill publish through it; do not fork
- E1 **native exercise clock** (COR-050/051) + lifecycle (COR-032) — scheduling + jump + "now" marker
- Telemetry emitter (XC-004) — every fire/hold/skip/edit/jump is a logged controller action
- **world-steering tiered pause (CTL-023)** — burst suspend (04) and jump gating (05) read pause state
- Persona/composer path (persona-operation) — edit-then-fire + bundle child posts

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Timeline | ConductTimeline, useQueue, types | console-shell; E1 clock | — | 1 | M |
| 02 Fire/hold/skip/edit | queueActions, QueueItemActions | 01; E2 pipeline; telemetry | 03 | 2 | M |
| 03 Scheduler | HoldForConduct | 01; E2 composer; E1 clock | 02 | 2 | S |
| 04 Bursts | burstScheduler, BundleProgress | 02; CTL-023 pause | — | 3 | M |
| 05 Time-jump disposition | TimeJumpDialog | 02; **CTL-023 pause**; E1 jump | — | 3 | M |

Stories 04 and 05 depend on world-steering's tiered pause (CTL-023) landing — cross-feature serial edge.

---

## Demo slice — scripted posts, server-side (stories 06 + 07) · decided 2026-10-08

> **Why this section exists.** The Oct 20 demo must show Pulse replacing Looking Glass, whose social content was a
> mix of live role-play and **pre-written posts released on cue**. The participant-first plan (#418) carried this as a
> browser-only run sheet (demo-polish C3, #438). Tom's interview on 2026-10-08 moved it **server-side**, so this
> slice replaces C3. Stories: [`06`](06-scripted-posts-server-queue.md) (backend), [`07`](07-scripted-posts-console.md)
> (console). The rest of this file (stories 01–05, the full timeline) is unchanged and still the post-demo target.

### Decisions (IQ-n)

| # | Decision | Why |
|---|---|---|
| IQ-1 | The queue is **server-side** and replaces C3's `localStorage` run sheet. | Tom: several controllers each own their slice of the script; one browser's list is not the product. The demo shows two consoles staying in sync. |
| IQ-2 | Fire publishes in-process through `PostIngestService.IngestAsync` with `origin: 'inject'`, `injectId` = item id and the **firing controller** as acting human. | `inject` was reserved for exactly this in-process caller (`PostIngestService.cs:39-40`); HTTP still can't claim it (`PostAttributionResolver.cs:164-176`). The after-action review can tell scripted posts from live role-play, and still knows who pressed Fire. |
| IQ-3 | Assignment is a **filter, not a lock**: anyone can fire anything, and the log records who fired. | Tom: matches MSEL assignment, where a colleague covers for another. |
| IQ-4 | Bursts are paced **server-side** by `InjectBurstRunner`. The first post goes at release; the rest are spread across the window with jitter (increasing, ≥ 3 s gaps). At most one child per burst per tick. When a child fires late, the remainder shifts by the lateness. | One rule covers PAUSE INJECTS, FREEZE, a held burst and a backend restart, with no suspend bookkeeping. Overdue posts never dump together, so the feed stays legible (SOC-071). |
| IQ-5 | **PAUSE INJECTS** suspends bursts; manual fire still works. **FREEZE** blocks fire/retry (409) and suspends bursts. **ENGINE PAUSED** has no effect. | Tom's choice. The `injects` tier already exists (`PauseTierRegistry.cs:16`); it becomes a live control instead of being removed by C4. |
| IQ-6 | Consoles **poll** `GET /api/injects` every ~3 s (and right after their own mutation) instead of using a SignalR push. | Meets Tom's "within seconds". B5 is reworking the realtime groups in this push (role-scoped, XC-002); a new staff push would collide with it. Move to the staff group after the demo. |
| IQ-7 | Posts reference personas by **id**; the seed script resolves handles through `GET /api/personas`. | Ids are what the server validates in scope; handles can change. |
| IQ-8 | The server emits one `inject_action` event per queue action; the console emits nothing for them. | A single emitter, like `PostIngestService`, means no double count. The posts themselves carry `origin: inject` + the same `injectId`, which links them. |
| IQ-9 | **Exactly once** = every state change (edit, claim to fire, each burst child's claim) goes through an integer `Version` **concurrency token** on the item. A concurrent writer gets `DbUpdateConcurrencyException` → 409, so exactly one fire wins. | Several controllers press Fire at once, and the runner may tick on more than one instance. The repo has no `ExecuteUpdate`/rowversion precedent, and a concurrency token behaves the same on SQL Server and the test providers. |
| IQ-10 | Until demo-polish BP merges, fire maps text only. Media / `ParentPostId` / `EngagementBaseline` map onto BP's typed `CreatePostRequest` members when BP lands. **BP amendment:** honour `engagementBaseline` for `inject` too, and keep media/reply/baseline handling inside `IngestAsync`. | BP is the single editor of the ingest funnel this push. In-process callers must get the same validation as HTTP. |

### Wire contract (frozen for 06 ↔ 07)

All routes require a live **staff** session assigned to the active exercise (the existing `EngineCockpitStaffAuthorizationFilter`: 401 with no staff session / no scope, 403 when not assigned). Mutations also require the `controller` role (`EngineCockpitControllerRoleFilter`). The acting human always comes from the server-side staff session (`ICurrentStaffSessionAccessor` → `StaffUserId`), **never the body**. Participants and anonymous callers are refused. No request carries an
`exerciseId`: the server scopes everything (COR-001). A cross-exercise id ≡ an unknown id.

| Method + route | Body | Success | Errors |
|---|---|---|---|
| `GET /api/injects` | — | 200 `InjectQueueDto` | — |
| `GET /api/injects/assignees` | — | 200 `InjectAssigneesDto` | — |
| `POST /api/injects` | `InjectItemWrite` | 201 `InjectItemDto` | 400 |
| `PUT /api/injects/{id}` | `InjectItemWrite & { version }` | 200 `InjectItemDto` | 400 · 404 · 409 (stale version / not editable) |
| `DELETE /api/injects/{id}?version=n` | — | 204 (soft delete) | 404 · 409 (fired/firing; stale version) |
| `POST /api/injects/reorder` | `{ ids: string[] }` (the full new order) | 200 `InjectQueueDto` | 400 (unknown/missing ids) · 409 (the set changed concurrently; no `item`) |
| `POST /api/injects/{id}/fire` | — | 200 `InjectItemDto` (`fired` / `firing` / `failed`) | 404 · 409 (not fireable · already fired · world frozen · reply parent not fired) |
| `POST /api/injects/{id}/hold` · `/release` · `/skip` · `/unskip` · `/retry` | — | 200 `InjectItemDto` | 404 · 409 (transition not allowed; retry under freeze) |

A 409 body is a ProblemDetails with `detail` (readable) and an `item` extension member (the current `InjectItemDto`,
when the item exists). ASP.NET serialises ProblemDetails extensions at the **top level**, so the JSON is
`{ type, title, status, detail, item }`. The console uses it to refresh the row without a second call.

```ts
// src/frontend/src/features/controller/runSheet/types.ts  (07)  ⇄  Features/Injects/InjectDtos.cs  (06)
export type InjectKind = 'post' | 'burst'
export type InjectStatus = 'pending' | 'held' | 'firing' | 'fired' | 'skipped' | 'failed'
export type InjectPostStatus = 'pending' | 'fired' | 'skipped' | 'failed'

export interface InjectPostWrite {
  id?: string                                             // PUT: echo an existing child's id to keep its identity; omit for a new child
  personaId: string
  text: string                                            // 1..280 code points
  media?: { mediaId: string; alt: string }[]              // <= 4 images OR exactly 1 video; alt 1..1000
  replyTo?: { sequence: number }                          // an EARLIER sibling in this item (1-based, < own sequence); works at create time
         | { injectPostId: string }                       // a scripted post in another item (or this one, by id)
         | { postId: string }                             // an existing post
  engagementBaseline?: { like?: number; repost?: number; reply?: number }   // 0..1,000,000
}
export interface InjectItemWrite {
  kind: InjectKind
  title: string                                           // 1..120
  notes?: string                                          // <= 500
  plannedMinute?: number                                  // integer >= 0; display + sort hint only
  assigneeId?: string | null                              // a staff user assigned to this exercise
  burstWindowSeconds?: number                             // burst only; 30..600 AND >= 3 x (posts - 1); default 90
  posts: InjectPostWrite[]                                // post: exactly 1; burst: 2..20
}
export interface InjectPostDto extends InjectPostWrite {
  id: string
  sequence: number                                        // 1-based within the item
  status: InjectPostStatus
  dueOffsetSeconds?: number                               // burst pacing, from release
  firedPostId?: string
  firedScenarioTime?: string                              // ISO instant (exercise clock)
  firedWallClock?: string                                 // staff-only
  firedByHumanId?: string
  error?: string
}
export interface InjectItemDto extends Omit<InjectItemWrite, 'posts'> {
  id: string
  order: number                                           // 1-based
  status: InjectStatus
  assigneeName?: string
  posts: InjectPostDto[]
  firedCount: number
  total: number
  version: number
  createdByHumanId: string
  updatedAt: string                                       // wall-clock, staff-only
  firedByHumanId?: string                                 // who pressed Fire (first release)
  firedScenarioTime?: string
  error?: string
}
export interface InjectQueueDto {
  items: InjectItemDto[]
  pauseTier: 'running' | 'injects' | 'engine' | 'freeze'  // so the panel can show the suspended/frozen state
}
export interface InjectAssigneesDto {
  me: string                                              // the caller's staff id (same id space as assigneeId)
  assignees: { id: string; displayName: string; role: string }[]
}
```

**Child identity on PUT (amended 2026-10-08).** Children are ordered by array position (`sequence`). On `PUT`, a
child carrying the `id` of an existing child of the same item keeps that child's identity (status, fired post,
and any `replyTo` pointing at it). A child without an `id` is new. An `id` from another item, or an unknown one, is
a 400. An unfired child left out is removed. This lets a burst's replies point at an earlier sibling at create time
(`{ sequence }`) and survive edits.

**As built (06, 2026-10-08).**
- 400 and 404 responses are also ProblemDetails, with a readable `detail`.
- `{ sequence }` replies are normalised to `{ injectPostId }` on write, so responses always return `injectPostId`.
  The console treats a sibling's `injectPostId` as a sibling reply.
- No two posts of an item publish less than 3 s apart (`InjectItem.LastPublishedAt`). This holds even after an edit
  or a Fire after a hold.
- Editing a held or failed item that already published is allowed. Published posts must be echoed unchanged, and
  `kind` can't change after the first fire (both 409). No edit or delete while a post is mid-publish (409).
- Queue actions (hold, skip, edit, …) stay allowed under FREEZE. Only `fire` and `retry` are refused, so controllers
  can prepare the script while the world is frozen.

**Telemetry (IQ-8).** One server event per action, in the same unit of work as the state change:
`eventType: 'inject_action'`, `channel: 'system'`, `actor { kind: 'system', actingHumanId }`, `injectId: <item id>`,
`target { entityType: 'inject', entityId: <item id> }`, wall-clock + scenario time, and
`payload { action: 'create'|'edit'|'delete'|'reorder'|'hold'|'release'|'skip'|'unskip'|'fire'|'retry', kind, status }`.
Each published post's own `post`/`reply` event carries `origin: 'inject'` + the same `injectId`.

### Wave plan (slice)

| Story | Stack / agent | Owns | Depends on | Target |
|---|---|---|---|---|
| 06 | backend / backend-agent | `Features/Injects/**`, `Data/Entities/InjectItem*.cs`, `PulseDbContext` (DbSets + config only), one migration + snapshot, tests under `Features/Injects/**`; the orchestrator adds the `Program.cs` lines | demo-polish B1 merged (migration on top); BP + B2 for media/reply live | build now; merge by Tue 10/13 (freeze Thu 10/15) |
| 07 | frontend / frontend-agent | `features/controller/runSheet/**`, `components/steering/PausePill.tsx` (re-add the injects option, after #449) | 06 contract (mock first); C1 picker; C4 slot | merge Wed 10/14 |

**Changes this slice makes to demo-polish (Tom approved, 2026-10-08):**
- **C3 (#438)** is replaced by 06 + 07. 07 keeps the `RunSheetPanel` seam, so the orchestrator mount is unchanged.
- **C4 (#439)** removed the disabled Pause injects placeholder in #449; 07 re-adds it as a live control.
- **S1 (#443)** creates the demo script through `POST /api/injects` instead of writing `pulse.runsheet.v1` JSON.
- **BP (#425):** see IQ-10.
