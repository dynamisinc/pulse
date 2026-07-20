# Backend Implementation Roadmap — closing the gap between the two islands

> **Status: v1 — draft for review.** The plan of record for building Pulse's missing middle tier
> (host + persistence + real-time + API + engine runtime) using the **same orchestrator-agent pattern**
> that built the frontend. Companion to [`BUILD_PLAN.md`](BUILD_PLAN.md) (the frontend wave checklist this
> extends), [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md) (branch/worktree/gate mechanics),
> and [`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md) (the contracts).
>
> **Why now:** two major thrusts have landed — a heavily-skinned participant/console **frontend** and the
> **E8 adaptive engine** — but they are *two islands with a mocked strait between them*. This roadmap builds
> the strait. It is the first thrust to exercise the `backend-agent` role and the already-wired backend CI
> gate (`ci.yml` → `backend` job), which have existed but never carried a story.

---

## 1. The finding (bottom line up front)

Pulse today is **two well-built halves with no middle**:

| Half | State | Evidence |
|---|---|---|
| **Frontend** (React 19 SPA) | Feature-rich, but **every data path is mocked and fails _closed_** | `USE_MOCK_DATA` gates every read through an axios *mock adapter*; disabling it yields blank surfaces, not a live path (`core/config/mockData.ts`). The only real network call in the app is a fire-and-forget `api.post('/telemetry')` whose failures are swallowed (`core/telemetry/mockSink.ts`). |
| **E8 engine** (`Pulse.Core`) | Sub-systems individually **mature and well-tested**, but a **library island** | Class library — no ASP.NET Core, no EF Core in its `.csproj`. Reaction loop is `observe → decide` only; `generate→review→publish→measure` is *"intentionally not built… neither the E2 publish pipeline nor the E7 review cockpit exists yet"* (`Features/ReactionLoop/README.md`). Only runnable artifact is `Pulse.Playground`, whose header reads *"There is no runtime yet."* |
| **The middle** (host · DB · real-time · API · engine runtime) | **Does not exist** | Zero `DbContext`/EF/repository/migration code anywhere. Zero `ApiController`/`MapPost`/`WebApplication`. `pulse.slnx` has exactly three projects: `Pulse.Core`, `Pulse.Core.Tests`, `Pulse.Playground`. |

**This is not an accident and not a criticism of the build so far** — it is the deliberate consequence of a
frontend-first phase. The playbook says so plainly: *"the .NET backend does not exist yet, so Phase-1 frontend
runs against React Query + mock data behind the axios client"* ([`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md)),
and the process review flags it as finding **R4**: *"DoD + builders were frontend-only; half the repo (`Pulse.Core`)
orphaned."* The seams on **both** sides were shaped to meet a backend later. Later is now.

### 1.1 The user-visible symptoms this explains

The concerns that prompted this analysis map exactly onto the missing middle:

1. **"There is no way to view messages created by a controller anywhere."** There *is* a controller-message
   path — `PersonaComposer → composeAsPersona() → createPost() → postStore.appendPost()` — and it is real and
   DOM-tested. But `postStore` is, in its own words, *"an in-memory store in one tab… no cross-tab /
   cross-participant fan-out"* (`postStore.ts`). A controller posting on their machine produces **nothing** a
   participant on another machine can see, and it **evaporates on reload**. The loop looks alive in a single
   browser tab and is dead across sessions. → Retired by **Phase B1** (persistence + SignalR fan-out).
2. **"Navigation is rudimentary."** Five flat routes (`/`, `/shell`, `/console`, `/evaluator`, `*`), no global
   nav, no cross-surface links — surfaces are reachable only by typing the URL. This is partly *because there is
   no session, role, or exercise state to drive navigation*: you cannot build "land the participant in their
   exercise" (COR-004) or the "staff exercise switcher" (COR-005) without a backend that knows who is logged in.
   → Retired by **Phase B2** (identity/sessions) + a small nav story that rides on it.
3. **"We'll keep building the frontend without a backend."** The real risk. Each new mock surface deepens the
   integration debt and lets the frozen client contracts drift untested against a real server. → This roadmap
   is the countermeasure: it flips the build's center of gravity to the backend and makes every new surface
   land on real data.

---

## 2. Where the two thrusts actually stand

### 2.1 Frontend (`src/frontend`) — real UI, mock spine

- **Routes:** `createBrowserRouter` with 5 flat routes; the two-worlds split is enforced *structurally*
  (COBRA physically unreachable from participant paths). Good bones; no global navigation.
- **Live surfaces:** the participant **Social** feed (`/shell`), the **Controller/SimCell console** (`/console`),
  and a fully-built **Evaluator dashboard** (`/evaluator`, four views: live/timeline/replay/metrics) — **all on
  mock data.**
- **The seams are already backend-shaped** (this is the good news — the swap is small and low-risk):
  - `resolveFeed()` calls `api.get('/feed')` behind a mock adapter; *"swapping it for a live `/feed` endpoint
    needs NO consumer change"* (`feedService.ts`).
  - `createPost()` is *"the blessed ingest path — every new post (a participant compose, a controller operating
    a persona, a fired MSEL inject, the future adaptive engine) goes through this one function"* (`postService.ts`).
    It already stamps `exerciseId`/`origin`, sanitizes, and emits one XC-004 event.
  - Isolation is *already delegated server-side by contract*: reads take **no** client `exerciseId` param —
    *"query scoping stays server-side (COR-001); the session binds the exercise"* (`feedService.ts`, `postStore.ts`).
  - `toParticipantView()` structurally strips provenance (`origin`/`actingHumanId`) — the XC-002 guarantee is
    a pure function ready to run either side of the wire.
- **Not built:** portal, news/outlets, press, weather (named only in a disabled channel catalog).

### 2.2 E8 engine (`Pulse.Core`) — mature parts, no runtime

| Sub-area | Maturity | Note |
|---|---|---|
| Generation infra (provider abstraction, prompt assembly, model tiering, governance, resilience/degraded-mode) | **Full** | 3 providers: `Fake`, `AzureOpenAI`, `ClaudeFoundry`; Polly resilience + circuit-breaker degrade signal. |
| Storylines (state machine, curves, intensity/sentiment, dial-follow, rate governance) | **Full** | Drives the Playground. |
| Persona voice (profiles, casting, style conformance, believable+diverse gate + re-roll) | **Full** | |
| Autonomy/safety (levels, auto-HOLD, kill switch, degrade-only listener, CTL-034 demand meter) | **Full** | |
| Eval/red-team (content guard, injection suite, voice metrics) | **Implemented, release-gating** | |
| **Reaction loop** | **Partial by design** | `observe`+`decide` built; `generate→review→publish→measure` **deferred pending E2/E7**. |
| **Runtime / host / persistence / API** | **Not built** | No loop-runner, no host, no DB, no serialization of `GeneratedPost` beyond tests. |

The engine's hard problems (believable voice, injection-resistance, cost/latency, safety) are **solved and
tested**. What's missing is **connective tissue**, not engine logic.

### 2.3 Backend & infrastructure — specced, gated, unbuilt

- **CI is already stack-agnostic.** `ci.yml` runs a `backend` job (`dotnet build + dotnet test` on `pulse.slnx`)
  and an `infra` job (Bicep compile+lint), behind a required aggregate `gate`. **Add a `Pulse.WebApi` project to
  the solution and Gate 0 builds+tests it automatically** — no CI change needed.
- **Infrastructure is drawn but switched off.** `main.bicep` says it in its own header: Pulse *"is frontend-only
  today (no .NET backend exists yet)… deploys ONLY the Free-tier Static Web App. The heavier resources are fully
  authored below but gated off by default."* Every backend toggle — `deployDatabase`, `deployBackend`,
  `deployAi`, `deployStorage`, `deployCommunication`, `deployMonitoring` — defaults **`false`**. The authored-but-
  dormant modules (`webapp`, `functionapp`, `database` Azure SQL, `signalr`, `storage`, `ai` = Azure AI Foundry
  for the engine's live model endpoint, `appinsights`, `loganalytics`, `communication`, `defender`) model the
  *intended* topology but **no application code fills any of it.** The frontend target (`stapp-pulse-uat`) is the
  only thing that deploys; the server side is a costed skeleton, not a deployed backend. (`ai.bicep` is designed
  to stand up *independently* — a cheap early move to give B3's engine runtime a real provider endpoint.)

The upshot: the runway is poured. The roadmap is about putting an aircraft on it, foundation-first.

---

## 3. Strategy & principles

These are **the frontend build's own principles, re-applied to the backend** — this is deliberately not a new
methodology, it's the next chapter of the proven one.

1. **Foundation-first / seams-first.** The process review *CONFIRMED* seams-before-fan-out is the real constraint.
   The backend's load-bearing seams — the host + DI root, the `DbContext` + the **exercise-scoping query filter**,
   the per-request exercise/session context, the telemetry sink — precede every consumer endpoint. A schema or
   isolation mistake here is a cross-phase migration.
2. **The frozen client contract _is_ the seam.** The frontend already defines the DTOs and endpoints
   (`Post`, thread shape, the XC-004 telemetry envelope, `/feed`, `/threads/:id`, `POST` compose, `/telemetry`).
   Backend stories build **to the existing contract** — this is a "fill in the server behind a frozen client"
   job, the lowest-risk shape of backend work. There is no codegen; the hook/service signature is the contract.
3. **Walking skeleton before breadth.** Do **not** build all endpoints then integrate. Build the thinnest slice
   that makes **one** real thing work end-to-end across sessions — the controller-message-to-participant-feed
   loop, persisted and pushed — then broaden. This retires the headline concern early and de-risks the whole tier.
4. **Two orchestrator-owned composition roots now.** The frontend `App.tsx` was orchestrator-owned (edited
   serially between waves, never a builder's file). The backend adds a second: `Pulse.WebApi/Program.cs` + DI.
   And a third seam becomes orchestrator-owned — **the mock→live flip** (`USE_MOCK_DATA` and each service's
   adapter): turning a surface live is a serial integration edit, not a builder-owned change.
5. **Gates unchanged; the isolation gate graduates to real SQL.** Gate 0 (CI) already covers backend. Gate 1
   (`code-review` per story) and Gate 2 (integrated delta) apply. The **always-Critical** review item —
   *"an isolation-scope break"* — was previously enforced against a *mock* provider; on the backend it becomes a
   **real EF global query filter with a standing cross-exercise test suite (COR-007)**. This is the single
   highest-stakes review class and gets **Tier-2 human sign-off** (isolation/security/schema).
6. **Seed v0, budget one hardening pass** (finding R6). The `DbContext` schema and the telemetry event store are
   the highest-fan-in backend seams; expect them to churn once the first consumer wave wires up. Reserve
   extension fields and schedule an explicit seam-hardening pass after Phase B1 — do not treat the first
   migration as final.
7. **Stack-typed stories.** Every story carries `stack: backend | fullstack`. `backend-agent` builds; the gate is
   `dotnet build + dotnet test`; `fullstack` stories also run the frontend gate and touch the mock→live flip.

---

## 4. The roadmap — phased backend waves

Notation mirrors [`BUILD_PLAN.md`](BUILD_PLAN.md): each row is a candidate story with the **contract seam it
fills** and the **mock it retires**. Story slugs are proposals for `story-agent` to formalize under
`docs/features/`. Phases are serialized on their load-bearing seams; stories **within** a wave are file-disjoint
and fan out.

### Phase B0 — Backend foundation seams · umbrella `feature/backend-host` · **build first, serial**

The load-bearing tier. Nothing consumer-facing is safe until these land. Analogous to frontend **Wave 0**.

| Story (proposed) | Builds | Retires / enables | Req |
|---|---|---|---|
| `backend-host/01-webapi-bootstrap` | `Pulse.WebApi` ASP.NET Core project added to `pulse.slnx`; DI root wiring `AddEngineGeneration(...)`; health, CORS for the SWA, config/secrets, App Insights | Gate-0 backend job now covers a real host; the frontend's `/api` base URL resolves | §6 tech context |
| `backend-host/02-persistence-efcore` | `PulseDbContext` + EF Core on Azure SQL; the E1 entities (`Exercise`, `PersonaTemplate`/`Persona`, `Post`, `ParticipantAccount`, `StaffAssignment`, `Cast`, telemetry event store); initial migration | `database.bicep` gets its first consumer; durable state exists | COR domain model |
| `backend-host/03-exercise-isolation-filter` **[Tier-2]** | `IExerciseContext` resolved per request (hostname COR-008 / session token); **EF global query filter on `ExerciseId`**, fail-closed; the standing cross-exercise + stored-XSS access test suite. **Extends the existing `docs/features/exercise-isolation/01-exercise-scoped-queries` story** (already decomposed, currently *Not Started* — *"the .NET backend does not exist yet"*), rather than starting fresh | The server-side realization of the client's already-delegated scoping; the always-Critical guarantee, in real SQL | COR-001/002/007 |
| `backend-host/04-telemetry-sink` | Real `POST /telemetry` ingest + storage behind the **locked XC-004 v0 envelope**; the highest-fan-in seam | Turns the swallowed fire-and-forget into a real sink; feeds E10 from day one | XC-004 |

> **Composition-root note:** `Program.cs`/DI is orchestrator-owned from the first commit — builders register
> their services through extension methods; the orchestrator wires them serially, exactly as `App.tsx` was handled.

### Phase B1 — The walking skeleton: the controller-message loop, for real · umbrella `feature/social-backend`

**The money slice.** Makes the exact loop the SimCell wave demoed *in one tab* work **across machines, across a
reload, persisted, and evaluated.** This is "pilot mode" per PRD §4 (login → social feed) on a real spine.

| Story (proposed) | Builds | Retires / enables | Stack |
|---|---|---|---|
| `social-backend/01-feed-read-api` | `GET /feed` (exercise-scoped; **provenance projected out server-side** — retires deferred finding S2-2) + `GET /threads/:id` | Flip `resolveFeed`/`useThread` mock adapter to live | fullstack |
| `social-backend/02-post-write-api` | `POST /posts` — server-side `createPost` (sanitize NFR-004, stamp `exerciseId`/`origin`, persist, emit telemetry) | Participant composer **and** controller `composeAsPersona` POST here instead of `postStore.appendPost` | fullstack |
| `social-backend/03-realtime-fanout` | **SignalR hub** (`signalr.bicep`): a published post pushes to every session in the exercise; polling fallback (NFR-003) | Replace the in-memory `postStore`; deliver the deferred `feeds-discovery/04` buffered "▲ N new posts" pill. **This is what makes a controller's post appear in a _different participant's_ browser.** | fullstack |
| `social-backend/04-persona-attribution` | Personas served from the DB; COR-018 per-human attribution persisted | Replace the seeded `personaService` mock; real authorship | fullstack |

> **Outcome:** the headline concern is fully retired — controller messages are viewable everywhere, by everyone in
> the exercise, durably. The frozen frontend contracts get their first real server, proving the seam design.

### Phase B2 — Identity, sessions, exercise onboarding · umbrella `feature/identity-backend`

Makes "log in and land in *your* exercise" real — and unlocks meaningful navigation.

| Story (proposed) | Builds | Req |
|---|---|---|
| `identity-backend/01-participant-accounts` | Named participant accounts (bulk import), session↔exercise binding | COR-011/012 |
| `identity-backend/02-readonly-credential` **[Tier-2]** | Shared read-only credential + lifecycle (rotation, revoke, brute-force lockout, per-IP rate limit) | COR-015/016, NFR-009 |
| `identity-backend/03-staff-auth` | Staff auth vs the Dynamis IdP behind a provider interface; `StaffAssignment` across exercises | COR-014, COR-005 |
| `identity-backend/04-hostname-scoping` | Per-exercise hostname → exercise resolution (COR-008), wired into `IExerciseContext` | COR-008 |
| `app-shell/05-global-nav` *(frontend)* | Role-aware entry + the **staff exercise switcher**; replace the 5 flat hardcoded routes | COR-004/005 |

> Replaces the frontend `sessionResolver`/`exerciseContextResolver` mocks with real auth and closes the isolation
> loop at the session layer. **Navigation is a fast-follow here, not before** — polishing nav without session/role
> state is polishing a shell with nothing to drive it.

### Phase B3 — Wire the engine into the host (E8 goes live) · umbrella `feature/engine-runtime`

Turns the engine island into a live capability. The engine's sub-parts are already mature; this is the
back-half of the reaction loop + the runtime, *"which the reaction-loop, E7 cockpit and E2 publish will drive
for real"* (`Program.cs`).

| Story (proposed) | Builds | Req |
|---|---|---|
| `engine-runtime/01-reaction-loop-host` | A hosted background worker (`functionapp.bicep`) driving `observe→decide→generate→review→publish→measure`; **publish reuses the B1 `POST /posts` + SignalR path** (engine posts "as an ordinary post") | E8 §1.2/§2, SOC-003 |
| `engine-runtime/02-review-cockpit-api` | Serve `EngineReviewItem` (the C# contract already exists) to the controller console; Suggest / Delayed-auto, auto-HOLD, kill switch | ADP-040/042, CTL-034 |
| `engine-runtime/03-scenario-clock-service` | The native exercise clock (COR-050) as a backend service driving the engine's scenario-time timers (today a hand-cranked `IScenarioClock`) | COR-050/051 |
| `engine-runtime/04-provider-live-config` **[Tier-2]** | Azure OpenAI in-tenant default under NFR-005 governance; run the existing eval harness against the live provider (replace *modeled* cost/latency with *measured*) | NFR-005 |

### Phase B4 — Evaluation backend + hardening · umbrella `feature/evaluation-backend`

| Story (proposed) | Builds | Req |
|---|---|---|
| `evaluation-backend/01-telemetry-queries` | Back the evaluator dashboard's four views with real telemetry queries; replace `evaluator/services/mockData.ts` | E10 |
| `evaluation-backend/02-content-security` **[Tier-2]** | Server-side HTML sanitization on all rich-text paths, upload malware/MIME scanning, size caps, strict CSP | NFR-004 |
| `evaluation-backend/03-degraded-modes` | Defined failure behavior (Cadence-unreachable dead-letter, clock-loss holdover, SignalR→polling, LLM outage→Suggest) | NFR-003 |

### Later (Phase 3/4 parity, per PRD §4)

E9 **Cadence fire-into-Pulse** (INT-004 — the `POST /posts` ingest built in B1 *becomes* the inject delivery
target; `origin: 'inject'` already exists in the model), the Beat media pipeline, the E3/E4/E5/E6 channels
(portal/news/press/weather), and E10 full (replay/metrics computed over telemetry captured since B0).

---

## 5. How each stated concern is retired

| Concern | Retired by | Mechanism |
|---|---|---|
| No way to view controller messages | **B1** | `POST /posts` persists; SignalR fans out to every session in the exercise; survives reload. |
| Rudimentary navigation | **B2** (+ `app-shell/05`) | Real sessions/roles give nav something to route on: participant → their exercise (COR-004), staff → console/evaluator + exercise switcher (COR-005). |
| Building frontend without a backend | **B0→B4** | The build's center of gravity moves to the backend; every existing mock surface is swapped to real data behind its frozen contract, wave by wave. |

---

## 6. Orchestrator mechanics for the backend thrust

Same loop as [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md), with these deltas:

- **Roles:** `backend-agent` builds each `backend`/`fullstack` story strictly to its ACs; `testing-agent` adds
  **xUnit beside the engine** (the harness already anticipates *"add xUnit beside the backend when it lands"*);
  `code-review` runs Gates 1 & 2; `story-agent` decomposes and closes out. `frontend-agent` handles the
  mock→live client edits on `fullstack` stories.
- **Composition roots (orchestrator-owned, serial, never a builder's file):** backend `Pulse.WebApi/Program.cs`
  + DI; frontend `App.tsx`; **and the mock→live flip** (`USE_MOCK_DATA` + each service adapter).
- **Worktrees:** backend builders need `dotnet restore` (fast, cached) — no `node_modules` juggling. `fullstack`
  stories still share one worktree across build+test.
- **The always-Critical gate, in real SQL:** every wave that adds a participant-facing endpoint must ship the
  cross-exercise access test that *fails*. Isolation, security, and schema/contract stories are marked
  **[Tier-2]** above — they take a human sign-off on top of the agent review.
- **Frozen-contract advantage:** because the client DTOs are the contract, a backend story's Gate-1 review checks
  the response shape against the existing TypeScript types — a concrete, testable acceptance criterion.

---

## 7. Immediate next actions

1. **Decompose B0 + B1 with `story-agent`** into `docs/features/` — write `feature.md` + `implementation.md`
   (reuse map naming the engine's existing services and the frontend's frozen DTOs; a DAG-ready Wave Plan with
   `stack:` fields) + the `NN-<slug>.md` stories, mirrored to GitHub per [`GITHUB_TRACKER.md`](GITHUB_TRACKER.md).
   Start with `backend-host` (Phase B0) — it is the serial prerequisite for everything else. **Reconcile, don't
   duplicate:** the net-new foundation is `backend-host`, but several consumer stories *attach to existing feature
   folders that today carry only frontend/mock work* — `exercise-isolation`, `posts`, `feeds-discovery`,
   `identity-auth-roles`, `persona-management`, `telemetry`. Add the `stack: backend|fullstack` stories to those
   features rather than inventing parallel ones; the frontend halves are already their reuse map.
2. **Run Phase B0 as a hand-driven serial chain** (not a fan-out): its four stories are a dependency line
   (host → persistence → isolation filter → telemetry sink), so build them in order with the standard
   build→test→Gate-1 loop, then Gate-2 the umbrella.
3. **Then fan out Phase B1** as a per-wave Workflow run (the four stories are file-disjoint once the seams exist),
   swapping the frontend adapters live as each endpoint lands. Update this doc's phase boxes as waves merge.

**Session-kickoff (paste to start the first build session):**

```
Build backend-host Phase B0 per docs/BACKEND_ROADMAP.md and docs/ORCHESTRATION_MECHANICS.md.
Umbrella: feature/backend-host (off latest origin/main).
Serial chain (each its own build/<slug>/<NN> branch): 01-webapi-bootstrap → 02-persistence-efcore →
  03-exercise-isolation-filter [Tier-2] → 04-telemetry-sink.
Stack: backend. Gate each with dotnet build + dotnet test; Gate-1 code-review per story (isolation filter is
always-Critical); Gate-2 the umbrella. Do NOT exceed the ACs. The exercise-scoping query filter must be a
central EF global filter, fail-closed, with a cross-exercise test that FAILS access.
```

---

## 8. Risks

1. **Schema churn on the highest-fan-in seams** (`DbContext`, telemetry store). *Mitigation:* seed v0 + reserve
   extension fields; one explicit hardening pass after B1 (finding R6). Note the E8 arch doc's schema-now
   requirement — reserve `rumorRef`/`mutationOf` on the `Post` schema even though rumors are v1.1.
2. **Isolation regressions as endpoints multiply.** *Mitigation:* the central query filter + the standing
   cross-exercise/stored-XSS suite extended on **every** new participant-facing endpoint; Tier-2 sign-off.
3. **Contract drift between the frozen client and the new server.** *Mitigation:* Gate-1 checks response shapes
   against the existing TS types; keep the mock adapters until the live endpoint is Gate-2 clean, then flip.
4. **Engine runtime scope creep.** The temptation is to "improve the engine" while wiring it. *Mitigation:* B3 is
   *connective tissue only* — the engine sub-systems are already mature and out of scope for changes; build the
   host and the publish/review wiring strictly to the E8 arch doc's contracts.
5. **Doing nav/polish before sessions exist.** *Mitigation:* nav is sequenced into B2, explicitly after
   identity — do not spend a wave on a shell with no state to drive it.
