# Implementation: Social API (backend)

> Phase B1 of `docs/BACKEND_ROADMAP.md` — the walking skeleton. Backend-heavy `fullstack` feature:
> every story ships a `Pulse.WebApi` endpoint/service; three of the four also ship a small,
> well-scoped frontend piece (a mock-adapter flip for 01/04, a brand-new shared connection module
> for 03). No new route/component tree — this feature swaps data transport under **existing**
> participant/staff surfaces, so (unlike most frontend features) there is no `App.tsx` mount to
> plan for. **All four stories are hard-blocked on Phase B0** (`backend-host/01,02`, and
> `exercise-isolation/01`'s read filter on `backend-host/02`'s write guard), authored in parallel by a
> sibling effort and referenced here by name only — this feature does not own or edit
> `docs/features/backend-host/**`.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Feed & thread read | Endpoints over `PulseDbContext.Posts`/replies, inheriting the central exercise-scoping filter. Every row is projected through a server-side participant-safe DTO — `origin`/`actingHumanId`/`createdWallClock`/`injectId` are never materialized into the response, mirroring `toParticipantView` (`postService.ts:152-162`) but enforced before serialization, not after. Thread ancestry walk mirrors `useThread.ts`'s `buildAncestorChain` (`useThread.ts:158-172` — oldest-first, unbounded depth per D1-006). | `Pulse.WebApi/Features/Social/FeedEndpoints.cs`, `ThreadEndpoints.cs`, `ParticipantPostDto.cs`, `PostReadService.cs` | `GET /feed`, `GET /threads/{id}` — the two frozen read contracts; `ParticipantPostDto`, the participant-safe shape 02's participant-caller branch and 03's broadcast payload both reuse rather than re-deriving |
| 02 Post write | A single ingest funnel (`PostIngestService`) realizing `createPost`'s "blessed ingest path" concept (`postService.ts:12-19`) server-side: sanitize (NFR-004) → stamp `exerciseId` from the request's resolved scope + `createdWallClock` from the server clock (never client input) → persist → emit exactly one XC-004 event via `telemetry/02`'s sink → call `IFeedBroadcaster` (03's interface) → shape the response by caller role (staff keeps `origin`; participant never does). Accepts the full `PostOrigin` enum (`engine`/`inject` included) for forward compatibility, though only `participant`/`controller-as-persona` have a real B1 caller. | `Pulse.WebApi/Features/Social/PostWriteEndpoints.cs`, `PostIngestService.cs`, `PostSanitizer.cs` | `POST /posts`; `PostIngestService`, the funnel `engine-runtime/01` (Phase B3) and E9's inject-fire (Phase 4, INT-004) are documented to reuse verbatim (`BACKEND_ROADMAP.md` §4 Phase B3: "engine posts as an ordinary post") |
| 03 SignalR feed host | An exercise-grouped SignalR hub: `OnConnectedAsync` resolves the connection's scope via the same `IExerciseContext` mechanism as the HTTP endpoints and joins `exercise:{id}` — never a client-supplied group name. `IFeedBroadcaster` is the small contract-first seam 02 calls post-persist (agreed upfront, not file-shared — see the Wave Plan note). Frontend: a **new** shared real-time connection module (built with its mock+live duality together, since — unlike 01/04 — there is no pre-existing mock adapter to flip) exposing a subscribe-by-event-name primitive, honoring the "one connection, new handlers added to it" precedent already anticipated in `overlayState.ts:17-19` and `useAlerts.ts:33`. | Backend: `Pulse.WebApi/Features/Realtime/ExerciseRealtimeHub.cs`, `IFeedBroadcaster.cs`, `SignalRFeedBroadcaster.cs`. Frontend (new): `core/realtime/connection.ts`, `features/social/services/realtimeFeed.ts` | `ExerciseRealtimeHub` (mapped at `/hubs/exercise`); `IFeedBroadcaster.BroadcastPostAsync(exerciseId, post)` (02 calls this); the connection module's subscribe primitive — `feeds-discovery/04`'s future `useFeedStream()` is the documented first consumer |
| 04 Persona read | A read endpoint over `PulseDbContext.Personas`, filtered by the same central filter. No provenance concern — the shipped `Persona` type (`personas/types.ts:84-101`) carries none — so, unlike 02, the response is unconditional for every caller. | `Pulse.WebApi/Features/Social/PersonaEndpoints.cs`, `PersonaReadService.cs` | `GET /personas` |

## Reuse map

**Frozen frontend contracts this feature serves (do not change their shape):**
- `resolveFeed()` + the `mockAdapter` it swaps out — `src/frontend/src/features/social/services/feedService.ts:67-73,103-112`; `assembleFeedView()` (the client-side convergence that stays unchanged) — `feedService.ts:140-165`.
- `resolveThread()` / `useThread()` + `ThreadWireResponse` — `src/frontend/src/features/social/hooks/useThread.ts:152-156,232-254`.
- `createPost()` — the "blessed ingest path" — `src/frontend/src/features/social/services/postService.ts:101-144` (module doc: `postService.ts:12-19`); `toParticipantView()` — `postService.ts:152-162`; `originConsoleLabel()` — `postService.ts:169-186`.
- `Post` / `ParticipantPostView` / `PostOrigin` — `src/frontend/src/features/social/types/post.ts:40,73-97,104-112`.
- `postStore.ts` — the in-memory pub/sub story 03 retires the *role* of (not the file — that remains `feeds-discovery/07`'s, not edited here); see its own "no cross-tab / cross-participant fan-out" admission — `src/frontend/src/features/social/services/postStore.ts:20-21,80-83`.
- `composeAsPersona()` — `src/frontend/src/features/controller/services/composeService.ts:73-86`; `useComposeAsPersona().publish()` — `src/frontend/src/features/controller/hooks/useComposeAsPersona.ts:95-112`; the console's dependency on the write response's `origin` field — `src/frontend/src/features/controller/components/PersonaComposer.tsx:150-157` (`originConsoleLabel(lastPublished)`), which is why 02's response is role-conditional.
- `USE_MOCK_DATA` — `src/frontend/src/core/config/mockData.ts:30-31`.
- `resolvePersonas()` / `usePersonas()` + the `SEEDED_PERSONAS` mock-fixture caveat — `src/frontend/src/features/personas/personaService.ts:45-49,61-67,96-146`.
- Sanitizer pattern (strip-not-encode; server mirrors this, does not double-encode) — `src/frontend/src/features/social/services/sanitize.ts:41-45`.
- Telemetry v0 envelope the server-side emission must satisfy — `src/frontend/src/core/telemetry/schema.ts:144-252` (locked; see `docs/features/telemetry/01-telemetry-emitter-v0.md`, Complete).
- Shared axios client (`VITE_API_URL` base) new/changed frontend calls route through — `src/frontend/src/core/services/api.ts:9-14`.
- `exerciseId`/`timeZone` are STAMPING-only inputs, never a client query-scoping param (WAVE0-REVIEW precedent 13) — `src/frontend/src/core/exerciseContext/exerciseContextResolver.ts:52-58`. This feature enforces the *server-side mirror* of that discipline: never trust a client-supplied `exerciseId` for scoping, only the request's own resolved scope.
- Scenario-time-only rule (COR-053) the read path (01) must not violate — `src/frontend/src/core/clock/scenarioTime.ts` module doc.
- The "one shared SignalR connection, new handlers added to it" precedent 03's frontend module must honor — `src/frontend/src/features/participant-shell/components/OverlayLayer/overlayState.ts:17-19`, `src/frontend/src/features/participant-shell/components/AlertBar/useAlerts.ts:33` (both anticipate the same shared connection for their own future needs; `docs/features/live-monitoring/feature.md`'s Dependencies line names it too, for CTL-030 — a third documented future consumer). No feature should open a second connection.

**Backend seams authored in parallel (reference by name — not owned by this feature):**
- `PulseDbContext` (`backend-host/02-persistence-efcore`) — the EF Core context every story queries/persists through. Its `Post`/`Persona`/`Exercise` entity shapes are assumed to mirror the frontend `Post`/`Persona` TS types, including the "seed v0, reserve extension fields" guidance (`BACKEND_ROADMAP.md` §3.6/Risk 1 — e.g. `rumorRef`/`mutationOf` reserved on `Post`; not this feature's concern to populate).
- The exercise-scoping global query filter — `exercise-isolation/01-exercise-scoped-queries` (Not Started; the requirement, COR-001, is E1's), realized in real SQL as the read-side filter extending `backend-host/02-persistence-efcore`'s `PulseDbContext` (whose **[Tier-2]** `SaveChangesAsync` guard is the write/schema half). Every query/persist/group-join in this feature inherits it; no story here re-implements scoping.
- `IExerciseContext` / the exercise-context resolver (ships with `exercise-isolation/01`; full host/session-token auth resolution is Phase B2 `identity-backend`) — per-request scope resolution. All four stories read the request's resolved scope from it; none accepts a client-supplied `exerciseId` as a scoping parameter.
- `telemetry/02-telemetry-sink-backend` — the real `POST /telemetry` ingest behind the locked v0 envelope. Story 02's server-side emission targets this sink.
- `Pulse.WebApi/Program.cs` DI/composition root (`backend-host/01`) — see Integration seam below.
- Infra: `infrastructure/modules/signalr.bicep` — the dormant Azure SignalR module story 03 activates (per `BACKEND_ROADMAP.md` §2.3, "authored but gated off by default").

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|----------------|------------|---------------|------|--------|
| 01 Feed & thread read | fullstack | `Pulse.WebApi/Features/Social/{FeedEndpoints.cs,ThreadEndpoints.cs,ParticipantPostDto.cs,PostReadService.cs}` (+ xUnit) | B0 (`backend-host/01,02`; read filter `exercise-isolation/01`) | 02, 03, 04 | 1 | M |
| 02 Post write | fullstack | `Pulse.WebApi/Features/Social/{PostWriteEndpoints.cs,PostIngestService.cs,PostSanitizer.cs}` (+ xUnit) | B0 (as above) + `telemetry/02` (telemetry sink); contract-first `IFeedBroadcaster` interface with 03 (see note*) | 01, 03*, 04 | 1 | L |
| 03 SignalR feed host | fullstack | Backend: `Pulse.WebApi/Features/Realtime/{ExerciseRealtimeHub.cs,IFeedBroadcaster.cs,SignalRFeedBroadcaster.cs}`. Frontend (new): `core/realtime/connection.ts`, `features/social/services/realtimeFeed.ts` (+ tests) | B0 (as above); contract-first `IFeedBroadcaster` interface with 02 (see note*); soft reuse of 01's `GET /feed` as the polling-fallback source | 01, 02*, 04 | 1 | L |
| 04 Persona read | fullstack | `Pulse.WebApi/Features/Social/{PersonaEndpoints.cs,PersonaReadService.cs}` (+ xUnit) | B0 (as above) | 01, 02, 03 | 1 | S |

`Stack` (`frontend | backend | fullstack`) tells the orchestrator which builder to spawn and which
Gate-0 command to run (see `ORCHESTRATION_MECHANICS.md §5`) — all four here are `fullstack`
(`dotnet build + dotnet test` **and** the frontend gate).

\* **02 ↔ 03 contract-first seam, not a file dependency.** 02's `PostIngestService` calls
`IFeedBroadcaster.BroadcastPostAsync(exerciseId, post)` after a successful persist; 03 owns that
interface + its SignalR-backed implementation. The interface is small and agreed upfront (this
doc), so both stories build in the **same wave** against the agreed shape rather than serializing —
mirroring the `persona-operation`/`console-shell` Wave-1 precedent (input/callback contract, not a
hard import). If the interface needs to change once either builder is underway, that edit is
coordinated the same way a Wave-1 cross-feature composition is: a short serial patch, not a
re-plan.

All four stories land in **Wave 1** once B0 is green — they are file-disjoint (backend files never
overlap; the two frontend touches, 01/04's flip-eligibility and 03's brand-new module, don't
overlap either) and, per `BACKEND_ROADMAP.md` §7.3, are meant to fan out as a single Workflow run.
Effort: 04 is the simplest (single unconditional read, no provenance concern); 02 and 03 are the
largest (02 carries four of this feature's five attached cross-cutting ACs; 03 introduces a
genuinely new transport primitive plus a degraded-mode path).

### Integration seam (orchestrator-owned — never a wave story)

This feature adds no new route or component tree, so — unlike most frontend features — there is
**no `App.tsx` row** here. Its two composition-root-shaped seams are:

| Seam | File(s) | Rule |
|------|---------|------|
| Frontend mock→live flip | `core/config/mockData.ts` (`USE_MOCK_DATA`); `features/social/services/feedService.ts` (`resolveFeed`'s `mockAdapter` branch, story 01); `features/social/hooks/useThread.ts` (`resolveThread`'s `mockAdapter` branch, story 01); `features/personas/personaService.ts` (`resolvePersonas`'s `mockAdapter` branch, story 04) | Flip one story's adapter only when *that* story's endpoint is Gate-2 clean. Never a builder-owned edit. |
| Frontend mock→live flip — **write path (bigger edit, flag explicitly)** | `features/social/services/postService.ts` (`createPost`), `features/controller/services/composeService.ts` (`composeAsPersona`), `features/controller/hooks/useComposeAsPersona.ts` (`publish`), and the participant composer's equivalent hook (`useComposePost`, per `postService.ts`'s own module doc — not read/named in this pass) | Unlike the read seams, `createPost` is **synchronous today and never axios-routed at all** (no `api.*` call anywhere in `postService.ts`) — this is not a mock-adapter swap, it is introducing `api.post('/posts', …)` for the first time and changing `createPost`'s signature from `(input) => Post` to `(input) => Promise<Post>`, which ripples to every caller. Land it as its **own** reviewed integration commit once 02 is Gate-2 clean, separate from 01/03/04's flips. The client-side `sanitizeText`/`buildAndEmit` calls currently inside `createPost` are replaced (not layered) by the network call — they stop executing on the live path once this edit lands, so telemetry is never double-counted. |
| Backend composition root | `Pulse.WebApi/Program.cs` (+ DI) | Each story exposes `IServiceCollection`/`IEndpointRouteBuilder` extension methods (e.g. `AddSocialFeedRead()`, `MapSocialFeedEndpoints()`, `AddSocialRealtimeHub()`, `MapSocialRealtimeHub()`); the orchestrator calls them from `Program.cs` serially as each story lands — mirroring the `App.tsx` convention (`BACKEND_ROADMAP.md` §3.4). No builder edits `Program.cs` directly. |

### Wave-0 seam freeze (orchestrator-owned, landed before the fan-out)

B0 shipped a deliberately thin `Post` entity (`Body`, `CreatedScenarioTime`, reserved `RumorRef`/`MutationOf`/`DeletedAt`) — it does **not** carry the provenance the write path (02) must persist, and the two shared C# contract types the parallel builders import must exist on the umbrella *before* the fan-out (C# is nominally typed — a "structural, per-side" contract like the frontend's Wave-1 precedent can't compile). So a single serial **seam-freeze** commit (`4981b6b`, `freeze(social-api): …`) landed these, reviewed as its own Tier-2-schema Gate-1:

- **`Post` provenance columns** (+ EF migration `PostProvenanceColumns`): `Origin` (string, NOT NULL), `ActingHumanId` (string, NOT NULL — COR-018), `CreatedWallClock` (`DateTimeOffset`, NOT NULL — real ingest instant, staff/telemetry-only), `InjectId` (string, NULL). Staff/telemetry-only; **never** projected onto a participant response.
- **`Features/Social/ParticipantPostDto.cs`** — the frozen participant-safe shape (`id`, `authorPersonaId`, `text`, `counts.{reply,repost,like}`, `scenarioTime`; `media`/`linkPreview` omitted this phase) with `static FromPost(Post)`, **the single server-side XC-002 narrowing** (retires S2-2). Story 01 *produces* it; stories 02 (participant branch) and 03 (broadcast payload) *consume* it.
- **`Features/Realtime/IFeedBroadcaster.cs`** — `Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken)`. The contract-first seam 02 calls and 03 implements; payload is unconditionally participant-safe.

Ownership delta from the Wave Plan: 01 no longer *creates* `ParticipantPostDto.cs` (it consumes the frozen one); 03 no longer *creates* `IFeedBroadcaster.cs` (it ships `SignalRFeedBroadcaster` implementing the frozen interface). All backend files remain disjoint across the four builders.

## Post-B1 follow-ups

**#271 write-path frontend flip (deferred).** Making `createPost` async (`Promise<Post>`) per the
flip design in the Integration seam table above ripples beyond the two composer paths (the
participant composer, `useComposeAsPersona`) into the **engine review-publish pipeline**
(`features/controller/engine/services/reviewActions.ts` burst-publish, part of
`engine-review-cockpit`) — a subsystem out of B1 scope — and the live path cannot be
browser-smoked without a deployed backend + Phase-B2 per-request scope resolution. Recommended
contained approach for the follow-up: route the live `api.post('/posts', …)` call in at the
**composer-hook boundary** (`useComposePost` / `useComposeAsPersona`) behind `USE_MOCK_DATA`,
leaving `createPost` itself as the mock/engine synchronous path, so the flip doesn't destabilize
the engine subsystem; land it as its own reviewed, backend-verified commit once a deployed
environment exists to smoke it against. The read-seam live branches (feed/thread/persona,
stories 01/04) already exist and need no client change to go live — go-live for all four B1
stories is the deploy-time `USE_MOCK_DATA` flag, not further frontend work.

**Budgeted post-B1 hardening pass (Gate-2 suggestions).** Tracked for the explicit
"hardening pass after B1" (`BACKEND_ROADMAP.md` §3.6/§8), not blocking this feature's Complete
status:
- **SG-1 — telemetry emission wording.** The implemented server-side XC-004 emission is a direct
  `DbContext` insert in the same unit of work as the post persist (atomic, dedup-safe by
  construction), not an HTTP call through `telemetry/02-telemetry-sink-backend`'s sink as this
  doc's per-story tech notes phrase it above. Reconcile the wording, or extract a shared emit
  helper if the sink's responsibilities grow side effects that the direct-insert path would miss.
- **SG-2 — best-effort broadcast fan-out.** Make `IFeedBroadcaster`'s SignalR implementation
  log-and-continue on a transient fault rather than propagate, so a broadcast failure never turns
  an already-committed write into a 500 for the caller.
- **SG-3 — read-path query parity.** Add `AsNoTracking()` to the post read path
  (`PostReadService`) for parity with `04-persona-read-api`'s read service.
- **SG-4 — acting-human placeholder.** Participant-authored posts store `ActingHumanId = ""`
  (no real acting human to attribute) until Phase B2 `identity-backend` resolves a session to an
  actual human; `controller-as-persona` posts already store the real operating controller per
  COR-018.

