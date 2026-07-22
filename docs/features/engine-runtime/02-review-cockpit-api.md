# Story: Review-cockpit API — serve `EngineReviewItem`s + wire autonomy/safety  `[fullstack]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** fullstack  ·  **Status:** Complete
**Requirements:** ADP-040, ADP-042, CTL-034 (D5-014/1.1, D5-014/2.1, D5-014/2.7, COR-001, XC-004, XC-002, NFR-004, SOC-003, COR-018)  ·  **Design decisions:** D5-014/1.1, D5-014/2.1, D5-014/2.7  ·  **Issue:** #286

> **⚠ SAFETY-CRITICAL.** This story carries the load-bearing E8 §8.2 safety invariants into the live
> API. Auto-HOLD-on-timeout must **never** auto-send; autonomy must **never** self-escalate; degraded
> mode and the kill switch may only ever **lower** autonomy. Build + review at the highest bar.
>
> **Reconciles `engine-review-cockpit` (#34–36) + `autonomy-safety` (#169–172).** The cockpit UI and
> the autonomy/safety domain are both built; this story is the server + wire between them and the
> mock→live flip of `useReviewQueue`. It does **not** rewrite the cockpit or the autonomy logic.

## Context
The controller engine cockpit (`engine-review-cockpit` #34–36) shipped a full review queue —
approve/edit/veto/re-roll, batch approve, per-item persona + storyline context, the auto-HOLD NEEDS-YOU
behavior, and the lead-gated swamped-mode toggle — but against a **mock** `reviewStore` (a same-tab,
in-memory module singleton) and the `reviewContracts.ts` **field-for-field TS mirror** of the frozen
C# `EngineReviewItem`. The autonomy/safety domain (`autonomy-safety` #169–172) shipped in `Pulse.Core`:
`EngineAutonomyState` (level resolution + kill switch + degraded clamp), the pure `AutoHoldPolicy`, the
`AutonomyProviderHealthListener`, and the CTL-034 `WorkloadDemandMeter` / `DemandAccounting`. Its own
`feature.md` says the API/DTO seam "converges when a WebApi exists (none yet)." It exists now.

This story persists and serves real `EngineReviewItem`s to the shipped cockpit, wires the built
autonomy/safety services to endpoints + SignalR push, and flips `useReviewQueue` from the mock
`reviewStore` to the live GET + realtime subscribe — **no cockpit rewrite** (the port slots behind the
same `reviewContracts.ts` shapes). Staff world (COBRA), staff-only (XC-002). See `feature.md` and
`implementation.md`.

## Acceptance Criteria
- [x] **Queue GET (scoped).** Given a controller in exercise A, When it GETs the review queue, Then it
  receives A's `EngineReviewItem`s (Suggest queued + Delayed-auto counting down + auto-HELD), each with
  its storyline context and countdown snapshot, and **never** an item from exercise B.
- [x] **Terminal actions publish through the shared seam.** Given a queued / counting-down item, When
  the controller approves (or batch-approves), Then the burst publishes via story 01's
  `IEnginePublishService.PublishBurstAsync` (one decision per burst, not per post); **veto** marks it
  `Vetoed` and nothing publishes; **re-roll** requests a fresh draft and returns it to review; **edit**
  sanitizes the new text (NFR-004) before publishing through the same seam.
- [x] **Delayed-auto countdown → AUTO-HOLD on expiry (never auto-send).** Given a Delayed-auto
  countdown expires with **no** controller decision, When the deadline passes in scenario time, Then the
  draft **auto-HOLDs** (`DraftDisposition.Held`, "timer expired — held for you", surfaces in NEEDS YOU)
  via `AutoHoldPolicy.Evaluate` — silence is never approval (D5-014/1.1). Auto-send on expiry happens
  **only** when swamped mode is explicitly enabled (`EngineAutonomyState.SwampedModeEnabled`, set by a
  lead controller, #36) and the draft is still effectively Delayed-auto.
- [x] **Kill switch + degraded mode lower autonomy only.** Given the kill switch fires
  (`EngageKillSwitch`) or the provider health breaches (`AutonomyProviderHealthListener` →
  `DegradeToSuggest`), When autonomy is clamped, Then it drops to Suggest (or full stop) instantly,
  in-flight Delayed-auto countdowns suspend (hold, not send), and autonomy **never** self-escalates —
  Suggest→Delayed→Auto is always an explicit human toggle; recovery clears the alert but does not raise
  autonomy (a human restores via `RestoreFromSafety`).
- [x] **SignalR push.** Given a countdown ticks, a disposition changes, or an auto-HOLD fires, When the
  state changes, Then it pushes to the exercise's controllers over the `ExerciseRealtimeHub` pattern
  (exercise-scoped group `exercise:{id}`, never a client-supplied group name).
- [x] **Frontend mock→live flip (no cockpit rewrite).** Given the endpoints are Gate-2 clean, When
  `useReviewQueue` is flipped, Then it reads the live queue GET and subscribes to the realtime push
  **instead of** the mock `reviewStore`, and delegates actions to the live endpoints — with **no**
  change to `ReviewQueue.tsx` or the `reviewContracts.ts` shapes (the frozen mirror is the seam).
- [x] **Safety invariants (E8 §8.2), verbatim in intent.** The above hold as invariants, not just happy
  paths: (1) auto-HOLD-on-timeout NEVER auto-sends — silence is never approval (D5-014/1.1); auto-send
  exists only behind the lead-gated swamped-mode toggle (#36). (2) Automation NEVER self-escalates its
  autonomy. (3) Degraded mode + kill switch only ever LOWER autonomy and never auto-recover.
- [x] **Isolation (COR-001).** Given a request scoped to exercise A, When it reads the queue or acts on
  an item, Then the data and the SignalR group are exercise-scoped; a cross-exercise queue read or
  action returns 403/404 and extends the standing cross-exercise isolation suite.
- [x] **Telemetry (XC-004).** Given a review decision, Then it emits exactly one `engine.reviewed` event
  (action ∈ approve / edit / veto / re-roll / **hold-on-expiry** / **auto-send**), carrying the actor
  incl. the human behind the shared controller account (COR-018), wall + scenario time, and channel —
  against the v0 envelope extended by `engine-telemetry-tuning/01`. One event per **decision**, not per post.
- [x] **XC-002.** The cockpit surface is staff-only (COBRA); the engine `origin` and draft internals are
  never exposed to a participant surface.
- [x] **CTL-034 workload contract.** Given a burst, When it enters the queue, Then it is **one** review
  decision (not one per post); the `WorkloadDemandMeter` / `DemandAccounting` surfaces queue-pressure as
  **demand** (amber past ~6/min sustained), never as a controller-performance measure (D5-014/2.7); a
  design past ~6/min is a defect to flag.

## Out of Scope
- **Auto mode (v1.1, `auto-mode`).** Only Suggest + Delayed-auto are served; `AutonomyLevel.Auto` is
  rejected by `EngineAutonomyState.Create`/setters.
- **The cockpit UI itself** (built — `engine-review-cockpit`); this story flips the **data source**, not
  the components. `ReviewQueue.tsx`, `EngineDraftEditComposer.tsx`, `SwampedModeToggle.tsx`, and the
  `reviewContracts.ts` shapes are unchanged.
- **The escalation dial + tiered-pause UI** (`world-steering`, CTL-022/023) — the storyline target and
  the pause-suspends-timers wiring live there; this story consumes the resolved autonomy/pause state.
- **Response-match confirmation prompts** (`response-reaction`, ADP-002) — a different demand class,
  counted by the same meter but not this queue.
- **`rumor-model` / `contradiction-reaction`** — v1.1.

## Technical Notes
Staff world (COBRA on the frontend; backend endpoints on `/api`). **Backend** owns
`src/Pulse.WebApi/Features/EngineRuntime/**`: `EngineReviewEndpoints.cs` (GET queue + approve/edit/
veto/re-roll/batch-approve + swamped-mode + kill-switch), `EngineReviewService.cs` (persists + serves
`EngineReviewItem`, drives `AutoHoldPolicy` on the scenario-time tick), `EngineReviewBroadcaster.cs`
(SignalR push, reusing the `ExerciseRealtimeHub` pattern), `AddEngineReview()` / `MapEngineReview()`.
**Frontend** owns the flip of `useReviewQueue.ts` (`src/frontend/src/features/controller/engine/hooks/`):
mock `reviewStore` → live GET + `core/realtime` subscribe; actions → live endpoints. `reviewContracts.ts`,
`ReviewQueue.tsx`, `reviewStore.ts` (retired as a live path, kept behind `USE_MOCK_DATA`) unchanged.

**Reuse, do not reinvent** (see `implementation.md`): `EngineAutonomyState`, `AutoHoldPolicy.Decide`/
`Evaluate`, `DelayedAutoCountdown`, `WorkloadDemandMeter` (`BudgetPerMinute = 6`), `DemandAccounting`,
`IEngineSafetySwitch`, `AutonomyProviderHealthListener`, and the frozen `EngineReviewItem` /
`DraftDisposition` / `TimeoutDisposition` / `AutonomyLevel` records (`Pulse.Core/Features/Autonomy`).
The C# `EngineReviewItem` is the frozen contract `reviewContracts.ts` already mirrors field-for-field —
the wire shape carries `PostCount`, not the draft posts (which the backend holds), so the GET payload
matches the frozen mirror. The **edit path sanitizes** through the same `PostSanitizer` funnel before
calling 01's `IEnginePublishService` (NFR-004). SignalR reuses `ExerciseRealtimeHub` / the
`core/realtime` connection module (B1); no second connection.

**Frozen C# ↔ TS mirror is the seam** (like B1's `ParticipantPostDto`): the endpoint's JSON must
deserialize into `reviewContracts.ts`'s `EngineReviewItem` / `DelayedAutoCountdown` without a shape
change — the mock port was built for exactly this swap.

## Dependencies
- **Story 01** — the `IEnginePublishService` publish seam (approve/edit/batch/auto-send call it) and
  the `EngineReviewItem` persistence seam (01 produces what this serves). Contract-first, same wave.
- **Story 03** — the scenario clock drives the Delayed-auto countdown + the auto-HOLD tick.
- **Delivered:** `autonomy-safety` (#169–172, the domain logic), `engine-review-cockpit` (#34–36, the
  UI + `reviewContracts.ts` + `useReviewQueue`), B1 (`ExerciseRealtimeHub`, `PostIngestService`,
  `core/realtime`), B0 (host + isolation + telemetry sink).
- **Foundation:** `engine-telemetry-tuning/01` (#173) — the `engine.reviewed` (incl. hold-on-expiry /
  auto-send) event schema.

## Tests
Backend xUnit: queue GET is exercise-scoped and a cross-exercise read/action returns 403/404 (extends
the standing isolation suite — always-Critical); approve/veto/re-roll/batch each drive the right
disposition + one `engine.reviewed` event; **auto-HOLD-on-timeout never publishes** and swamped-mode is
the *only* auto-send path (drive `AutoHoldPolicy.Evaluate` through the scenario clock); kill switch +
degraded clamp only lower autonomy and suspend countdowns; SignalR push is exercise-grouped. Frontend
(RTL): `useReviewQueue` reads the live source with no `ReviewQueue.tsx` change; the existing cockpit
tests stay green against the flipped hook. Safety-invariant tests are the release gate for this story.
