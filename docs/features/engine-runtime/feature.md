# Feature: Engine runtime (backend)

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** §14 `reaction-loop` + `autonomy-safety` runtime / BACKEND_ROADMAP Phase B3
**World:** backend — a staff/backend capability with no participant-visible surface of its own (E8 arch §2)  ·  **Issue:** #284

## Summary
The connective tissue that wires the **built** E8 engine into the `Pulse.WebApi` host and builds
the **missing back-half of the reaction loop**. Today the engine is a mature `Pulse.Core` library
island: `Generation`, `Storylines`, `PersonaVoice`, `Autonomy`, and `EngineEval` are full and
release-gated, but `ReactionLoop` ships **observe + decide only** — `generate → publish → measure`
was left "Blocked" pending the E2 publish pipeline and the E7 review cockpit
(`Pulse.Core/Features/ReactionLoop/README.md`; reaction-loop stories #159/#160). Both now exist:
Phase B1 (`social-api`) shipped `PostIngestService.IngestAsync` (which already accepts
`origin: 'engine'`) + the `IFeedBroadcaster` fan-out, and the controller engine cockpit UI shipped
against a **mock** `reviewStore` (`engine-review-cockpit` #34–36). This is `docs/BACKEND_ROADMAP.md`
**Phase B3 — "wire the E8 engine into the host (make the world talk back)"**.

Four stories turn the island into a live capability: a hosted `BackgroundService` that drives the
full loop in scenario time and builds the missing generate/publish/measure stages (01); the
persistence + API + SignalR that serve real `EngineReviewItem`s to the shipped cockpit and wire the
built autonomy/safety services, flipping `useReviewQueue` live (02, **safety-critical**); the
native exercise clock that drives the loop's scenario-time timers, replacing the hand-cranked
`IScenarioClock` (03); and the live-provider config that turns the modeled cost/latency into
measured against a governed Azure OpenAI endpoint (04, **Tier-2**).

This is a backend/service feature — a sibling to `backend-host` and `social-api`, not a UI feature.
It has **no design brief** and mounts nothing new in `App.tsx`. **B3 is connective tissue only**:
the engine sub-systems are already mature and out of scope for changes (BACKEND_ROADMAP §8 Risk 4 —
"build ON the engine; do not rewrite it").

**The v1 slice (E8 arch §8/§14):** Social channel only, **Suggest + Delayed-auto** autonomy.
Deferred and stated in each story's Out of Scope: **Auto mode** (v1.1, `auto-mode`), `rumor-model`,
`contradiction-reaction`, and storyline **auto-detection** (E8 arch §13.1).

## Requirements covered
E8 arch §1.2 (the reaction loop) / §2 (system shape) — the generate/publish/measure back-half (01).
ADP-040 (review queue), ADP-042 (kill switch), CTL-034 (workload contract) — served to the cockpit (02).
COR-050/051/052 (native clock, discrete jumps, suspension) — scoped to what the loop consumes (03).
NFR-005 / ADP-025 (LLM data governance), NFR-003 (degraded-mode trip), ADP-024 (injection red-team) — live provider (04).
Cross-cutting on the stories that warrant them: SOC-003 (engine posts as ordinary posts, origin hidden),
XC-002 (provenance never participant-visible), COR-001 (isolation — every tick/publish/query/group
exercise-scoped), COR-053 (scenario time), XC-004 (the engine event types), NFR-004 (edit-path sanitize).

## Design references
No design brief — this is a backend connective feature (like `social-api`). The **canonical design**
is `docs/design/E8-ENGINE-ARCHITECTURE.md`: §1.2 (the loop), §2 (system shape + two-worlds), §3.5/§3.6
(degraded mode + publish path), §8 (autonomy & safety state machine + §8.2 invariants + §8.5 CTL-034
workload contract), §9 (guardrails + injection), §11 (telemetry event types), §14 (feature
decomposition). The D5 controller-console amendment **D5-014/1.1** (auto-HOLD, never auto-send;
supersedes D5-005) is inherited by story 02 through the built `autonomy-safety` slice and the shipped
`engine-review-cockpit` — this feature *serves* that behavior, it does not re-decide it.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Reaction-loop host — generate/publish/measure back-half `[backend]` | E8 §1.2, SOC-003 (COR-001, XC-004, XC-002, ADP-023/024, CTL-034) | Complete | #285 |
| 02 | Review-cockpit API — serve `EngineReviewItem`s + autonomy/safety `[fullstack] [SAFETY-CRITICAL]` | ADP-040/042, CTL-034 (D5-014/1.1, COR-001, XC-004, XC-002, NFR-004) | Complete | #286 |
| 03 | Scenario-clock service — native COR-050 clock driving the loop's timers `[backend]` | COR-050/051/052 (COR-053, COR-001) | Complete | #287 |
| 04 | Provider live-config — governed Azure OpenAI + measured eval `[backend] [TIER-2]` | NFR-005, ADP-025, NFR-003, ADP-024 | Complete | #288 |

## Dependencies
**Delivered foundations (referenced by name, not owned here):**
- **Phase B0** — `backend-host/01` (the `Pulse.WebApi` host + `AddEngineGeneration` in `Program.cs`),
  `backend-host/02` (`PulseDbContext` + the Tier-2 write-scope guard), `exercise-isolation/01` (the
  read-side global query filter + `IExerciseContext`/`AddExerciseScoping`), `telemetry/02` (the
  `POST /api/telemetry` sink behind the locked XC-004 v0 envelope). All merged (#268/#269/#44/#274).
- **Phase B1** — `social-api` (`PostIngestService.IngestAsync`, `IFeedBroadcaster`,
  `ParticipantPostDto`, the `ExerciseRealtimeHub` at `/hubs/exercise`). All merged (#270–#273).
- **The built E8 engine slices** (`Pulse.Core`, mature, DO NOT change): `reaction-loop` observe/decide
  (#157/#158), `engine-generation-infra` (#142–#147), `persona-voice-engine`, `storyline-model`,
  `autonomy-safety` (#169–#172), `engine-eval-harness`.
- **The shipped controller cockpit UI** — `engine-review-cockpit` (#34–#36): `reviewContracts.ts`
  (the field-for-field TS mirror of the frozen C# `EngineReviewItem`), `useReviewQueue.ts`,
  `ReviewQueue.tsx`, `reviewStore` (the mock story 02 flips off).

**Cross-feature seams:** `engine-telemetry-tuning/01` (#173, **Not Started**) owns the XC-004 v0
extension the engine event types are added to — a **foundation dependency**: the engine event types
this feature emits must be *added to* the locked v0 envelope, not forked ("a schema mistake is a
cross-phase migration," adversarial review D2). See `implementation.md` open question (d).

**Intra-feature seams (contract-first, agreed upfront in `implementation.md`):** stories 01↔02 share
the `EngineReviewItem` persistence seam + the `IEnginePublishService` publish seam; story 01 consumes
story 03 (`IExerciseClock`) and story 04 (the live `IGenerationProvider`) via DI wired at the
composition root between waves.

**Sibling engine feature docs this reconciles with** (a separate reconciliation pass will point their
stories at this feature): `reaction-loop` (unblocks #159/#160), `autonomy-safety` (its cockpit API/DTO
seam converges here), `engine-review-cockpit` (its mock→live flip lands here), `exercise-clock` (this
delivers a scoped slice of #77), `engine-generation-infra` (its live-config + measured-eval land here),
`engine-telemetry-tuning` (the event-schema foundation).

**Build sequencing (decided 2026-07-21):** B3 builds **after Phase B2** (identity/sessions). B2's real
per-request session→exercise binding is what story 02's controller endpoints and the loop's publish
scope resolve against — it is the clean answer to `implementation.md` open question (b); until B2 lands,
any B3 spike must use a server-authoritative stopgap scope, never a client-supplied `exerciseId`.

## Post-B3 follow-ups (tracked, non-blocking)

- **WR-001 / partial-publish idempotency** (stories 01+02): the engine publish path (`PostIngestService`)
  does not dedupe on `draftId`, so a review-approve that succeeds-then-fails-to-commit, OR a
  partial-publish 502 retry, can double-publish the already-live subset. Root fix: ingest-side `draftId`
  idempotency on the publish path / `Post` schema. Documented in code at the publish-then-commit site.

- **Zero-post burst guard** (Low): `IsPublishFullySuccessful` requires `Posts.Count > 0`; unreachable
  today (GenerateStage drops empty bursts) — add a guard if a future draft-regeneration seam can empty
  a burst.

- **Pre-existing test flake**: `usePersonas()` race in `ReviewQueue.test.tsx` / `EngineDraftEditComposer.test.tsx`
  (reproduces on baseline without the B3 flip) — a shared personas cache would fix it.

- **Wave-0 LO-002**: add a negative-path (reject unknown literal) test for the engine enum JSON converters.

- **Cockpit role granularity (/security-review)**: after the B2 merge, the review-cockpit endpoints
  (#286) are gated to a staff session **assigned to the resolved exercise** (COR-005) via
  `EngineCockpitStaffAuthorizationFilter` — but authorize *any* assigned staff role. The safety-critical
  autonomy controls (kill-switch / swamped-mode / approve / batch) are therefore reachable by a
  non-controller staff session (e.g. an evaluator) assigned to that exercise. Decided (owner) to keep
  staff+assigned for now and defer a controller-role restriction to `/security-review` — **safe only while
  Phase-1 issues exercise assignments to controller-role staff**; escalate if evaluator/observer staff are
  assigned. Minor: the shared-read-only endpoint test drives a null accessor (same path as anonymous)
  rather than a real `readonly`-kind session (the real guarantee is proven in the identity suite); and the
  403 branch returns a bare status with no problem-details body.

## Design notes
Backend / staff — no participant surface. The two-worlds rule (D0 §2) is enforced here as a
**data-layer** guarantee, inherited from B1: every engine post publishes through
`PostIngestService.IngestAsync` as an ordinary post authored by its persona, and its engine `origin`
is captured but **projected out server-side on read** (XC-002/SOC-003) — a participant can never tell
an engine post from a controller-authored or seeded one; that indistinguishability *is* the product
(E8 arch §3.6). All engine *controls* live in the E7 staff cockpit (COBRA); story 02's surface is
staff-only.

**The load-bearing safety invariants (E8 arch §8.2), carried by stories 01 & 02:** auto-HOLD on
timeout **never** auto-sends (silence is never approval, D5-014/1.1 — auto-send only behind the
existing lead-gated swamped-mode toggle #36); automation **never** escalates its own autonomy
(Suggest→Delayed→Auto is always a human toggle); degraded mode + kill switch only ever move autonomy
**down**. Story 02 is marked **[SAFETY-CRITICAL]**; story 04 is **[TIER-2]** (human sign-off on the
NFR-005 governance contract before a live endpoint is reachable).

**Isolation (COR-001) is the other load-bearing guarantee.** Every loop tick, publish unit of work,
review query, and SignalR group is exercise-scoped. The subtle concern is story 01's: `PostIngestService`
reads its scope **only** from a per-request `IExerciseContext` and **fails closed** when unresolved — a
`BackgroundService` has no HTTP request, so how the trusted, non-request-bound loop establishes exercise
scope for its publish unit of work is the feature's key integration open question (`implementation.md`
open question (b)).

**The CTL-034 workload contract** (E8 arch §8.5) binds 01 & 02: one burst = **one** review decision
(not one per post); the `WorkloadDemandMeter` must stay ≤6 demanded decisions/min sustained at NFR-002
load. A design that pushes demand past ~6/min is wrong — flag it, don't ship it.
