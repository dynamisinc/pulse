# Story: Ambient background posting (autonomous, within a tier policy)

**Feature:** Ambient chatter  ·  **Epic:** E8  ·  **Phase:** 2 (v1) — engine go-live wave C2 ("some autonomy")  ·  **Status:** Built (backend), NOT Complete
**Requirements:** ADP-005 (+ ADP-011 quiet floor, ADP-023/024 content safety, ADP-042 kill switch, ADP-040 auto-HOLD, NFR-005)  ·  **Design decisions:** none (brief decision B1 "AI engine: ambient chatter publishes on its own, key posts are still reviewed")  ·  **Issue:** #168

> Rewritten 2026-10-16 from `docs/NEXT-WAVE-SESSION-BRIEF.md` C4/C2 (wave C2). Original ADP-005 intent (fill the
> quiet floor on the cheap tier) is kept; what changes is that ambient posts now **publish without a controller
> click**, under a human-set, bounded policy. PROVIDER-GOVERNANCE §8 is signed (Tom Bull, 2026-10-16); PR #571
> puts UAT on the live provider, suggest-only for everything else.

## Context
Today every engine burst goes to the review queue (`ReactionLoopDriver.BuildReviewItem` → Queued, or
CountingDown under Delayed-auto). Ambient chatter is the one content class where that is the wrong default:
it is high-volume, low-stakes everyday color, and routing it through the queue would blow the controller
workload contract (CTL-034, <=6 decisions/min). So ambient posts publish **autonomously, but only inside a
tier policy a controller has explicitly turned on**. Everything story-critical stays reviewed.

Verified state of the code this builds on (so the builder does not reinvent):
- `ReactionTriggerKind.AmbientFloor` exists and `IntentComposer` already maps it to the Ambient tier, but
  **nothing produces an `AmbientFloor` intent yet** (no decide-stage policy registered; only
  `ResponseReactionBehavior` is, in `ReactionLoopDriver`). The decide policy is new work.
- Rate governance exists: `RateGovernanceConfig` (`MaxEnginePostsPerMinute` = 60, `MinBelievableActivity` = 6) and
  `RateGovernance` (`Pulse.Core/Features/Storylines`), carried on `ReactionLoopRegistration.RateConfig`.
- Publishing exists: `EnginePublishService.PublishBurstAsync` publishes with `Origin = "engine"` and emits
  `engine.published`; `GenerateStage` already runs `ContentGuard.InspectBurst` (ADP-023/024) before anything is
  returned. `InjectionRedTeam` (`Pulse.Core/Features/EngineEval`) is the standing attack catalog.
- Safety exists: `EngineAutonomyState` (`IsGenerationStopped` kill switch, degraded-mode clamp,
  `IEngineSafetySwitch`), per-exercise registries `EngineAutonomyRegistry` / `EngineTierPolicyRegistry`
  (singletons, **process memory**, `ConcurrentDictionary` keyed by `exerciseId`), served through
  `GET /api/engine/settings` (`EngineSettingsDto`) and `POST /api/engine/settings/{autonomy-default,tier-policy}`
  (autonomy-safety 05, #353; panel = 06, #354).
- Freeze is honoured by the loop (`ReactionLoopHost.TickExerciseAsync` skips a tick when
  `IExerciseClock.IsFrozen`); the tiered pause (`Steering/PauseTierRegistry`: Pause injects / Pause engine /
  Freeze) exists.
- **Lifecycle is NOT honoured by the engine.** `Exercise.Status` (`build|staged|live|paused|completed|archived`,
  `ExerciseLifecycleStates`) gates only participant routes via `ExerciseLifecycleGatingMiddleware`; that file
  itself records "the engine reaction loop does not deregister an exercise on `completed`", and the controller
  guide says "the AI engine is not stopped by EndEx". Session A's A5 lifecycle gate has **not landed**, so
  this story must check lifecycle itself, behind a seam A5 can later replace (AC5).
- White noise (`Features/WhiteNoise`, demo-feedback 05) is a **separate, authored-pool** background-noise feature,
  not LLM-generated; ambient chatter here is generated. They must not double-fill the quiet floor — see
  Technical Notes.

## Acceptance Criteria
Group 0 — governance gate (blocks shipping to UAT live, not building)
- [ ] **AC0 PROVIDER-GOVERNANCE §8 amendment signed before this ships to UAT live (Tier-2, Tom Bull).**
      The §8 "Authorized autonomy (amendment at signing, 2026-10-16)" (PR #571, commit `2f47fda`; read with
      `git show 2f47fda:docs/features/engine-runtime/PROVIDER-GOVERNANCE.md`) authorizes ONLY Suggest (default) and
      Delayed-auto with lead-controller swamped mode on UAT, and states: "Wider autonomy than this (autonomous
      ambient posting under a tier policy, wave C2 / #168) needs its own amendment to this section before it
      reaches the live provider." Given the code is merged, when the UAT/prod config could let an exercise reach
      `ambientPolicy.mode = autonomous` on the live provider, then a second signed amendment naming autonomous
      ambient posting (its caps, allow-lists, kill-switch/lifecycle conditions from AC1-AC9) exists in §8 BEFORE
      that happens. Until then the code merges **dark**: `mode` defaults `off` (AC1), and the settings API
      rejects `autonomous` (400, "not authorized by PROVIDER-GOVERNANCE §8") unless a governed config flag
      `Generation:Governance:AmbientAutonomyAuthorized` is true (default false, set by the signer in the same
      reviewed commit as the amendment — the same pattern as `generationTenantBounded`); `review` mode stays
      allowed. The PR must not edit PROVIDER-GOVERNANCE.md itself; the amendment is Tom's.

Group A — the policy (human-set, bounded, in memory)
- [ ] **AC1 Tier policy, default OFF.** Given a new `AmbientTierPolicy` per exercise — `mode`
      (`off` | `review` | `autonomous`; default `off`), `maxPerMinute`, `maxPerHour`, `topicAllowList`,
      `personaAllowList` — held in a new in-memory `EngineAmbientPolicyRegistry` (sibling of
      `EngineTierPolicyRegistry`, singleton, keyed by `exerciseId`), when no controller has set it (including
      after any process restart), then no ambient content is generated or published. `maxPerMinute` may not
      exceed the exercise's `MaxEnginePostsPerMinute`; topics come from a fixed server-side vocabulary (local
      color, traffic-mundane, food, sports, community events, ...), personas must be personas of THIS exercise;
      anything else is rejected 400. An empty allow-list means "nothing allowed", never "everything".
- [ ] **AC2 Settings API + panel (closes #353/#354 for this field).** Given a controller-role staff session, when
      they read `GET /api/engine/settings`, then `EngineSettingsDto` carries the exercise's `ambientPolicy`
      (additive field); when they `POST /api/engine/settings/ambient-policy` (controller-role gate and
      `actingHumanId`, COR-018, same filters as the other `/api/engine` steering routes), then the policy
      changes for the next tick with no redeploy, an XC-004 event records from→to and the human (reuse the
      steering-change event type #353 uses for tier-policy changes — do not fork the taxonomy), and
      `InMemoryStateNote` states ambient policy resets to `off` on restart. The existing engine settings panel
      (staff world, COBRA, `features/controller/engine/components/EngineSettingsPanel.tsx`) gains an "Ambient
      chatter" section: mode, caps, allow-lists; the mode is shown as text + icon, never colour-only (NFR-001).
- [ ] **AC3 Foreign-exercise and foreign-org tests on the new route.** Given `POST/GET .../ambient-policy`
      (and the new `ambientPolicy` settings field), when a session for exercise B or org B targets exercise A's
      policy (route/body/query is never the scope source — `IExerciseContext` only), then 403/404 and A's policy
      is unchanged; an unresolved scope fails closed (401), a persona id from another exercise is rejected, and
      the cross-exercise cases extend the standing isolation suite (XC-001/COR-001). Composition-root guard:
      the route resolves through the real host (`WebApplicationFactory<Program>`).

Group B — what runs autonomously, and what never does
- [ ] **AC4 Quiet-floor trigger, policy-bounded generation.** Given `mode != off` and engine activity below
      `MinBelievableActivity`, when the loop ticks, then a low-priority decide policy emits an `AmbientFloor`
      intent on the Ambient tier (cheap model; engine-generation-infra 04), sized to the shortfall but clamped by
      `maxPerMinute`, `maxPerHour` and the global `MaxEnginePostsPerMinute`; it yields to any storyline-critical
      intent in the same tick; its personas come only from `personaAllowList` (voice profiles + scenario context,
      persona-voice-engine) and its topic seed only from `topicAllowList`; it reads as ordinary background life,
      never storyline content.
- [ ] **AC5 Lifecycle respected — the engine checks it itself, behind a seam.** Given the exercise is not `live`
      (`build`, `staged`, `paused`, `completed`, `archived`), or its clock is Frozen, or the "Pause engine" /
      Freeze pause tier is active, when an ambient burst is due or finishes generating, then nothing is
      published (a draft finished after the state changed is discarded, never queued late) and a
      `held:lifecycle` reason is recorded in telemetry. The check is a single interface
      (e.g. `IEngineLifecyclePublishGate.CanPublish(exerciseId)`) with an interim implementation that reads
      `Exercise.Status` through the SAME `ExerciseLifecycleStates` literals the participant gate uses (no second
      vocabulary), registered so that A5's gate can replace it by changing one registration. Tested through
      EndEx (`completed`) and Freeze.
- [ ] **AC6 Kill switch within 5 s.** Given ANY safety clamp — the kill switch in either mode (`FullStop` sets
      `IsGenerationStopped`; `DropToSuggest` leaves it false but sets `SafetyClampActive`), a degraded-mode
      clamp, or the cut-to-`Fake` lever (#402) — when ambient autonomy is on, then no ambient post is published later
      than 5 s after the switch: the stop is re-checked **immediately before publish** (not only at tick start,
      since the tick interval defaults to 5 s) and in-flight bursts are discarded. A degraded clamp pauses
      ambient (it lowers; it never silently drops ambient into the review queue). Restoring the engine never
      re-raises ambient autonomy — only a human re-selecting the mode does. The gate reads `SafetyClampActive`
      (not `IsGenerationStopped` alone). Tested with the real tick interval, for **both** kill-switch modes and
      for cut-to-`Fake`.
- [ ] **AC7 Content safety on every ambient post.** Given an ambient burst, when generated, then it passes the
      existing `GenerateStage` path unchanged — `ContentGuard.InspectBurst` fiction/injection guard
      (ADP-023/024), tenant-bounded provider only (NFR-005/ADP-024: persona and world text is untrusted data,
      never instructions) — and ambient-specific cases are ADDED to the `InjectionRedTeam` catalog (an
      allow-list persona whose bio tries to steer the ambient prompt). A guard failure publishes nothing and is
      counted (a re-roll costs money and is recorded). The topic allow-list is enforced at seed time plus the
      guard backstop; state in the PR that there is no post-hoc topic classifier in this story.
- [ ] **AC8 Review stays mandatory for storyline and escalation posts; silence is never approval.** Given any
      intent whose trigger is `Inaction`, `OfficialResponse` or `Amplification`, or any storyline-bound or
      escalation content, when it is generated — whatever the ambient policy says — then it takes the existing
      review-queue path (Queued / Delayed-auto CountingDown) and is never published by the ambient path; the
      autonomous path is selected ONLY by `Trigger == AmbientFloor` AND policy `autonomous`. In `mode = review`,
      ambient drafts enter the queue like any draft; a timed-out draft is **held, never auto-sent** (ADP-040,
      D5-014/1.1 — unchanged), and no code path turns a countdown expiry into a publish for ambient content.
- [ ] **AC9 Engine-sourced everywhere; participants never see a draft; scenario time.** Given an
      autonomously published ambient post, when it lands, then it carries `Origin = "engine"` (existing), its
      `engine.decided/generated/published` events carry trigger `AmbientFloor` and an additive
      `publishPath = ambient-autonomous` flag (wall + scenario time, actor = the engine and the controller who
      set the policy, channel; XC-004), and the evaluator/AAR export labels it engine-sourced (verify the existing
      report row exposes origin; add only if missing); no participant endpoint, feed or SignalR payload ever
      exposes a draft or review item (only the published post, via the existing publish path), and the post's
      time renders in scenario time in the exercise TZ (COR-053), never wall clock. No-enterprise-look (D0 §2)
      holds because ambient posts are ordinary posts in the participant skin.
- [ ] **AC10 User guide (docs-as-done).** `docs/guide/controller-guide.md` §10 "The AI engine" gains an "Ambient
      chatter" subsection (what autonomous means, the caps, the allow-lists, the three modes, resets to Off on
      restart, kill switch / Freeze / EndEx behaviour); the EndEx warning ("the AI engine is not stopped by
      EndEx", ~L162-169) gains ONLY an exception for ambient posting ("ambient posting stops at EndEx and
      Freeze", per AC5). The warning itself and its manual close-out workaround (white noise Off, Pause engine,
      ENGINE · STOPPED, Swamped mode off, before EndEx) STAY for non-ambient bursts: late approvals and
      Swamped-mode auto-sends are not covered by the ambient-only gate and remain until those paths are
      lifecycle-gated (Session A's A5); `docs/guide/planner-guide.md` mentions
      choosing the allow-lists at setup if relevant; the settings-panel screenshot is re-captured
      (`tools/guide-screenshots`).

## Out of Scope
- **Persisting** policy / autonomy / kill-switch state across restarts — wave C3, **after Session A's A1 schema
  is on main** (brief C1 rule 1). Until then it is in process memory by design and resets to `off` (fail-safe).
- **Any schema change or EF migration** in this wave (none is needed; see Technical Notes).
- Quiet-floor definition (storyline-model 04), Haiku/Ambient tiering (engine-generation-infra 04), backdated
  history (COR-023), authored white-noise pool (demo-feedback 05).
- Autonomous publishing of storyline, response-reaction, amplification or escalation content (stays reviewed);
  `AutonomyLevel.Auto` (v1.1); any new participant channel (Portal/News/Press/Weather are Phase 3 stubs).
- A post-hoc topic classifier; per-persona rate limits; replies/DMs from ambient personas (top-level posts only).
- Replacing the interim lifecycle check once A5 lands (a one-registration follow-up, tracked on this story).

## Technical Notes
- **World:** backend + staff panel only; the output is ordinary participant-world posts (skinned, scenario time).
- **Files (all inside existing feature slices):** new `Pulse.Core/Features/Ambient/*` (policy record, decide
  policy `AmbientBehavior` registered next to `ResponseReactionBehavior`, pure rate/allow-list evaluation);
  `Pulse.WebApi/Features/EngineRuntime/EngineAmbientPolicy.cs` (registry + DTO + the lifecycle-gate interface and
  interim impl); endpoint + DTO field in `EngineReviewEndpoints.cs` / `EngineSettingsContracts.cs`; autonomous
  branch in `ReactionLoopDriver` after `GenerateStage` (publish via `EnginePublishService`, never a new publish
  path); DI via `TryAddSingleton` in the slice's existing `AddEngineReview` / `ReactionLoopHostExtensions`;
  frontend section in `features/controller/engine/components/EngineSettingsPanel.tsx` (+ its service/hook).
  `EngineReviewEndpoints.cs`/`EngineReviewService.cs` are shared with autonomy-safety 05 and world-steering —
  coordinate before editing outside this story's lines.
- **Where autonomy/settings live today:** in-memory singletons (`EngineAutonomyRegistry` in
  `EngineReviewService.cs`, `EngineTierPolicyRegistry` in `EngineTierPolicy.cs`) behind `/api/engine/settings`.
  This story adds a third sibling; it persists nothing.
- **Schema need: none.** Origin is an existing column; telemetry rows are the existing `TelemetryEvents` table
  (payload is opaque JSON, so `publishPath` is additive). If a builder concludes one is needed (e.g. a durable
  per-post "auto" flag), STOP and raise it — it waits for A1.
- **Orchestrator-owned files:** none expected (no new `Map*`/`Add*` pair; the endpoint joins
  `EngineReviewEndpoints`, which is already wired, and the panel already has its route). If the builder instead
  adds a new `Map*`/`Add*` pair, that is **one additive line in `Program.cs`, flagged for orchestrator
  clearance in the wiring commit** — not a builder edit. `App.tsx` and `staffRouteRegistry.tsx` are not touched.
- **Frozen/shared types touched (all additive):** `EngineSettingsDto` (+`ambientPolicy`);
  `GenerationIntent` (+ optional ambient topic seed); `EngineEventPayloads` published/decided payloads
  (+`publishPath`). **Not touched:** Session A's frozen `PostView`, session/role types, `ExerciseScopeDto`.
- White noise overlap: ambient should count white-noise posts toward the quiet-floor activity measure (or be
  mutually exclusive via the exercise's noise level) so the floor is not double-filled; decide in the PR and
  note it in the guide.
- Cost: Ambient tier is ~$0.0016/burst (MEASURED-RESULTS.md); the per-hour cap is also the spend cap. Load the
  `claude-api` skill before any model/cost/latency reasoning.
- Effort is L; if it does not fit one sitting, split at the API boundary: edge A (policy + registry + settings
  API + panel, AC1-3, AC10 part) then edge B (decide policy + gates + publish, AC4-9). See implementation.md.

## Dependencies
storyline-model 04 (quiet floor + rate cap); persona-voice-engine; engine-generation-infra 04 (Ambient tier);
reaction-loop; autonomy-safety 01-03 and 05/06 (levels, auto-HOLD, kill switch, settings API/panel); engine-runtime
02 (publish service); world-steering 07 (pause tiers). **Soft:** Session A's A5 lifecycle gate (not landed — hence
the interim gate seam). **Gate (DoD):** the §8 amendment in AC0 is signed before the story is marked Complete or `ambientPolicy.mode = autonomous` is enabled on UAT. **Wave:** C2, after C1 (live provider verified on UAT).

## Tests
- Unit (Pulse.Core): policy validation (caps <= global cap, allow-lists, empty = nothing); decide policy fires only
  below the floor, yields to storyline intents, clamps to per-minute/per-hour/global caps.
- Integration (Pulse.WebApi.Tests): autonomous publish happy path with `Origin = engine`, `publishPath` and
  scenario-time on the participant DTO; non-`live` lifecycle, Freeze, Pause-engine, and EndEx each publish
  nothing; kill switch mid-burst publishes nothing >5 s later; `Inaction/OfficialResponse/Amplification` never take
  the autonomous path; `mode = review` timeout holds, never sends.
- Isolation: foreign-exercise and foreign-org on `POST/GET ambient-policy` and the settings field; foreign
  persona id rejected; `WebApplicationFactory<Program>` composition-root guard.
- Safety: ambient `InjectionRedTeam` cases; ContentGuard failure publishes nothing.
- Frontend (Vitest): panel section renders mode as text+icon, posts the policy, reflects the server value.
- Manual (UAT after #571): turn on `autonomous` with a tight cap, watch the Live World, then kill switch and
  Freeze; re-capture the screenshot.

## Build notes (backend, branch `feature/engine-golive-ambient-backend`, 2026-10-16)

**Status: Built (backend), NOT Complete.** Not Complete until: the frontend panel section (AC2 UI) and AC10 guide work land
(frontend PR); the PROVIDER-GOVERNANCE §8 amendment (AC0) is signed by Tom Bull; the Docker-gated suites below run green
in CI; Tier-2 human sign-off (isolation + a new autonomous publish path). The code merges **dark**:
`Generation:Governance:AmbientAutonomyAuthorized` is `false` in committed `appsettings.json` and in bicep.

What was built (no schema change, no EF migration, no `Program.cs` edit):
- **AC0** — `EngineAmbientGovernanceOptions` bound from `Generation:Governance` (separate from `GenerationOptions`, so the
  NFR-005 startup gate is untouched). `autonomous` is rejected 400 with *"mode 'autonomous' is not authorized by
  PROVIDER-GOVERNANCE §8 …"* while false. Bicep: root param `generationAmbientAutonomyAuthorized` (default false) →
  `webapp.bicep` → app setting `Generation__Governance__AmbientAutonomyAuthorized`; `uat.bicepparam` now states it
  explicitly as `false` (Gate-1 L-5, "NOT authorized until PROVIDER-GOVERNANCE §8 amendment 2 is signed"); `main.json`
  regenerated with Bicep 0.48.1 (re-verified byte-identical after L-5). The loop also re-checks the flag before every autonomous publish
  (defence in depth).
- **AC1** — `Pulse.Core/Features/Ambient`: `AmbientTierPolicy` (+ `AmbientPolicyMode`), fixed vocabulary `AmbientTopics`
  (`local-color, traffic-mundane, food, sports, community-events, pets, local-business, family-school`), pure
  `AmbientPolicyValidator`. `EngineAmbientPolicyRegistry` (WebApi, singleton, `TryAddSingleton` in both `AddEngineReview`
  and `AddReactionLoopHost`) — absent entry = `off`.
- **AC2** — `ambientPolicy` on `EngineSettingsDto` (every settings response); `POST /api/engine/settings/ambient-policy` on
  the existing controller-role `steering` group in `MapEngineReview`; one XC-004 event under the EXISTING
  `engine.tier_policy_changed` type with an `AmbientPolicyChanged` payload (`policy: "ambient"` discriminator, from→to mode,
  caps, lists, reason, acting human). `InMemoryNote` now says ambient resets to off.
- **AC4** — `AmbientBehavior` (Core, pure). NOT registered in `DecideStage` (that registry's `ReactionContext` requires a
  storyline); the driver calls it after all storyline work (`ReactionLoopDriver.Ambient.cs`). Intent: `AmbientFloor`,
  Ambient tier, `StorylineId = Guid.Empty`, Suggest, `AmbientTopicSeed` (new optional field on `GenerationIntent`).
  Per-minute/per-hour caps are rolling **server wall-clock** windows counted at generation (spend), so a time-jump cannot
  reset them; the global `MaxEnginePostsPerMinute` clamp uses the loop's existing per-scenario-minute counter.
- **White-noise overlap (decision):** the floor's activity measure = engine posts this minute + **non-engine posts in the
  trailing scenario minute** (participants, injects, controller-as-persona, **white noise**). White noise therefore fills
  the floor first and ambient only tops up the remainder; they never double-fill. Ambient does not read the noise level.
- **AC5** — `IEngineLifecyclePublishGate` (`RefreshAsync` = the only I/O; `CanPublish` = synchronous) with
  `InterimEngineLifecyclePublishGate`: `ExerciseLifecycleStates.TryParse(...) == live` (legacy `active` folds to live),
  clock not frozen, pause tier not `Engine`/`Freeze`. Registered `TryAddScoped` in `AddReactionLoopHost` — **A5 replaces
  that one registration**. A due burst in a closed world is not generated (`engine.decided` with
  `heldReason: held:lifecycle`, once per hold episode); a draft finishing after the change is discarded
  (`engine.generated` `heldReason: held:lifecycle`), never queued.
- **AC6** — mirrors PR #571's last-boundary re-decision: each ambient post is published individually; before each, the
  gate is refreshed (the one await) and then, with no await before `PublishBurstAsync`, the driver re-reads
  `SafetyClampActive`/`IsGenerationStopped` (both the registration's and the shared registry's state), the cut-to-Fake
  registry, the policy (still autonomous + authorised) and `CanPublish`. A safety hold discards the rest
  (`held:safety`) and **lowers the policy to off**; the kill switch (either mode) and cut-to-Fake also lower it on their
  request path. Restore never re-raises it. Degraded mode lowers it at the next tick (the clamp persists until a human
  restore). Residual: one post already handed to the funnel completes.
- **AC7** — `GenerateStage`/`ContentGuard` unchanged; 4 ambient persona-bio cases added to `InjectionRedTeam.Catalog`.
  A guard drop publishes nothing; the `engine.generated` `guardResult: drop` event is the count. **There is no post-hoc
  topic classifier in this story**: topics are enforced at seed time (server-authored phrase from the allow-list) plus the
  guard backstop.
- **AC8** — only `Trigger == AmbientFloor` + `autonomous` reaches `PublishAmbientAsync`. `review` mode queues a Suggest /
  `Queued` item (`#ambient`, no countdown), so no expiry path can ever publish it.
- **AC9** — publishes via `EnginePublishService` only (`Origin = "engine"`). `engine.decided/generated/published` carry
  `trigger: "ambient-floor"` and `publishPath: "ambient-autonomous"`; actor `kind: engine` + `actingHumanId` = the
  controller who set the policy (via new optional `EngineBurst.Trigger/PublishPath/AuthorizedBy`). The report row already
  labels `engine` (`ExerciseReportBuilder.Source`) — no change. Post scenario time = the exercise clock instant ("O").

Known limitations / follow-ups: ~~`PromptAssembler` has no ambient mode~~ — **addressed by Gate-1 H-1** (below).
Allow-listed personas are voiced only if they are in the loop's seeded cast (`ReactionLoopRegistration.PersonasByHandle`)
— now **reported** to the panel as `ambientPolicy.voiceablePersonaIds` (Gate-1 M-1). "Pause engine" still has no effect on
storyline bursts (pre-existing; only ambient honours it).
**Residual risk (NFR-005):** persona `VoiceNotes` stay unfenced in the trusted part of the prompt (fencing them would
change every storyline prompt and its cache prefix). For that path the `ContentGuard` backstop is the only defence; it is
red-teamed through the real path (Gate-1 M-2). Revisit before any production authorization.

### Gate-1 review fixes (branch `fix/ambient-be`, 2026-10-16) — status remains **Built (backend), NOT Complete**
- **H-1 (addressed)** — ambient bursts no longer travel a storyline/escalation prompt. Additive
  `StorylineBrief.IsAmbient` (default `false`), set by `ReactionLoopDriver.BuildAmbientGenerateRequest` (no magic
  Phase/Title strings drive behaviour). With it, `PromptAssembler` uses an everyday-life opening, puts the exercise
  brief under "## Setting (background only …)", replaces the storyline / public-expectation / minutes-since-response /
  intensity / escalation block with "## Background chatter — topic: {seed phrase}. Ordinary daily life only …", drops
  "advance the storyline / react to the world feed" from the task, and skips persona recent-post exemplars. Storyline
  prompts are unchanged. `AmbientBehavior.AmbientMix` is now Calm 0.75 + Gratitude 0.25 only.
- **M-1 (addressed)** — additive `ambientPolicy.voiceablePersonaIds` (GUID strings, or `null` when the exercise has no
  registered loop): the loop cast's persona ids. POST validation unchanged (any persona of this exercise), so the panel
  can label the rest "not in engine cast".
- **M-2 (addressed)** — `InjectionAttack.Vector` (`WorldFeed` default | `PersonaVoiceNotes`); the four ambient bio cases
  run the REAL unfenced path (`PersonaDossier.VoiceNotes` → `PromptAssembler.AppendPersona`) via
  `InjectionRedTeam.AssembleViaPersonaVoiceNotes`, and an obeyed burst is dropped end to end through `GenerateStage`.
  VoiceNotes are deliberately **not** fenced: it would change every storyline prompt (and its cache prefix); the reason
  is commented at `AppendPersona`. The guard is the defence on that path.
- **L-1** — `autonomous` is rejected 400 (*"engine is stopped or cut to Fake — restore it before enabling autonomous
  ambient"*) while the kill switch (either mode; `SafetyClampActive`, which also covers a degraded clamp) or the cut to
  Fake is active. Review mode stays selectable.
- **L-5** — explicit `param generationAmbientAutonomyAuthorized = false` in `uat.bicepparam`.
- **L-6** — the ambient `engine.tier_policy_changed` shape and the new nullable `trigger` / `publishPath` / `heldReason`
  keys are documented in `engine-telemetry-tuning/01-engine-event-types.md`.
- **L-7** — `PublishAmbientAsync` refuses (logs + `held:policy`, publishes nothing) any intent whose trigger is not
  `AmbientFloor`. Defence in depth; unreachable today, so it has no dedicated test (the method is private).

### AC10 backend facts (for the frontend PR's guide section)
- Three modes: **Off** (default; also after every restart), **Review** (drafts enter the review queue, never auto-sent),
  **Autonomous** (publishes without a click; only selectable when the deployment flag is on, else the API answers 400).
- Caps: per-minute ≤ the exercise's MaxEnginePostsPerMinute (60 by default); per-hour ≤ 60 × that; counted per
  generated post on a rolling wall-clock window (the per-hour cap is the ambient spend cap).
- Allow-lists: topics from the fixed list above; personas of this exercise only, and only ordinary members of the public
  (Resident / Helper — an outlet, agency, troll or bot is rejected 400); only those in the engine's seeded cast are
  voiced. Empty = nothing.
- Ambient fills the quiet floor only after white noise and participant posts are counted.
- Ambient posting stops at EndEx, any non-live state, Freeze and Pause engine; the kill switch (either mode), a degraded
  provider and Cut to Fake switch ambient to **Off** — restoring the engine does not turn it back on.

### Orchestrator review hardening (branch `feature/engine-golive-ambient-hardening`, 2026-10-16) — before §8 amendment 2

Status remains **Built (backend), NOT Complete**. No migration, no `Program.cs` change.

**Done**
- **W-3 (never storyline, now enforced on both sides).** The ambient prompt no longer carries the exercise brief (which
  narrates the incident): `ReactionLoopDriver.BuildAmbientGenerateRequest` passes `AmbientSettingBrief.Build(placeName)`
  — the fictional place name only (new optional `ReactionLoopRegistration.AmbientPlaceName`, seeded from
  `Exercise.WorldName`; generic "An ordinary town on an ordinary day." when unset). Output side: new pure
  `Pulse.Core.Features.Ambient.Services.AmbientOutputFilter` runs in `GenerateStage` for ambient bursts as a third gate
  with the guard's semantics (re-roll, then drop; `engine.generated.guardResult = "drop"`; nothing published or queued).
  A burst fails if any post contains a fixed incident term, an active storyline hashtag, or a storyline title keyword
  (≥ 5 letters, minus stop words) — exclusions built per request from `registration.Storylines`. Matching is at word
  boundaries since Gate-1 W-A (see "Gate-1 follow-up" below for the vocabulary).
  Failing checks: `ambient:incident-term`, `ambient:sentiment`. The offline Fake now emits everyday small talk for an
  ambient request (additive `GenerationRequest.IsAmbient`, set by the assembler) — previously it emitted its tap-water
  incident lines as "ambient" chatter.
- **S-2 (sentiment).** Folded into the filter. A generated post carries a continuous sentiment (−1…+1), not a tone
  category, so "Calm or Gratitude only" is enforced as `Sentiment ≥ −0.1` (`AmbientOutputFilter.MinSentiment`).
- **W-4 (eligible personas).** `AmbientPolicyValidator.EligiblePersonaTypes` = Resident, Helper (**confirmed by
  Tom, 10/16: "Resident + Helper only"**; the single constant). Enforced in the POST (400 naming the persona id, handle and type: the engine
  cast's type when the persona is in the cast, otherwise its stored archetype — only `citizen` maps to an eligible type),
  in `AmbientBehavior.EligibleCast`, and at the publish re-check. `ambientPolicy.voiceablePersonaIds` = engine cast ∩
  eligible types (semantics change only; same key and shape).
- **W-6 (publish re-check reads the current policy).** The no-await block before each publish now also requires, under
  the CURRENT policy: the post's persona still allow-listed, in the cast and of an eligible type; the burst's topic still
  allow-listed; both caps > 0; and the spend already recorded in the rolling windows not above either cap. Otherwise
  `held:policy`.
- **W-7 (review drafts into a closed world).** Before a review-mode draft is queued: lifecycle gate refreshed (the one
  await), then synchronously the policy (not off, still admits the topic/personas/caps) and `CanPublish`. Otherwise the
  draft is discarded with `engine.generated.heldReason` = `held:policy` / `held:lifecycle`.
- **W-2 (attribution).** `POST /api/engine/settings/ambient-policy` resolves the caller through
  `ICurrentStaffSessionAccessor` (verified session token) and stamps `SetBy` — hence every autonomous post's
  `engine.published` actor `actingHumanId` / `EngineBurst.AuthorizedBy` — and the audit event's acting human with the
  `StaffUser.Id`. The body's `actingHumanId` is still required (wire compatibility) but not trusted. No staff session →
  401.
- **S-1 (AAR tagging).** An approved review-mode ambient draft publishes with `trigger = "ambient-floor"` and
  `publishPath = "ambient-reviewed"` (recognised by storyline id `Guid.Empty` + tag `#ambient`; no schema column).
- **W-1 helper.** Pure `AmbientPolicyRaise.IsRaise(AmbientTierPolicy current, EngineAmbientPolicyRequest request)`. A
  **raise** (lead-only once A1c lands): (a) the requested mode is `autonomous` and the current mode is not; or (b) both
  are `autonomous` and the request raises `maxPerMinute` or `maxPerHour` or adds any topic or persona. Everything else
  is **not** a raise: off ↔ review, lowering caps, removing entries, autonomous → review/off; an unparseable mode is not a
  raise (validation 400s), an unparseable persona entry counts as an addition.

**Pending**
- **W-1 lead gate** — not built (Session A's A1c / `Enrollment.IsLead` is not on `main`). One marked
  `// TODO(A1c): .AddEndpointFilter(LeadControllerRaiseFilter.AmbientPolicy)` sits on the route mapping in
  `EngineReviewEndpoints.MapEngineReview`; Session A wires the filter (calling `AmbientPolicyRaise.IsRaise`) and its test.
- **W-5** — disclosed residual, unchanged by this pass; carry the orchestrator review's wording into the amendment.
- **Residual (disclose with W-3):** persona `VoiceNotes` still enter the ambient prompt, and the seeded residents' notes
  reference the incident (e.g. "is the water safe for my kids?"). The output filter is the backstop for that drift.

### Gate-1 follow-up (#168, branch `feature/engine-golive-ambient-hardening`, 2026-10-16)

No migration, no `Program.cs` change.

- **W-A (filter false positives).** `AmbientOutputFilter` no longer matches raw substrings. A post (text + hashtag
  list) is tokenized into lower-cased letter/digit words (hyphens, underscores, apostrophes, punctuation are
  boundaries; a `#tag` is also read as one compact token). Per-exercise exclusions (storyline hashtags without `#`,
  title keywords) match a whole word plus at most one inflection suffix (`s, es, ed, ing, er`): title word `water`
  hits "water / waters / watered" but not "watermelon / waterfront"; hashtag `#Fire` hits "#fire / a fire / fires" but
  not "fireworks / #fireworks" (a hashtag matches as a whole tag in text or hashtag list, never as the prefix of a
  longer tag). Fixed vocabulary — words are consecutive tokens; `*` = word-start stem; other words whole-word +
  inflection:
  `emergenc*`, `evacuat*`, `evacuee*`, `contamina*`, `hazmat*`, `outage*`; `boil water`, `boil notice`,
  `boil advisory`, `boil order`; `officials said`, `officials say`, `officials announced`, `officials confirmed`,
  `officials warn*`, `officials urg*`; `shelter in place`; `weather alert`, `severe weather`, `alert issued`,
  `warning issued`, `advisory issued`. Bare `officials`, `shelter`, `alert`, `warning` were dropped (sports officials,
  animal shelter, "spoiler alert", "fair warning" collide with allow-listed topics). **Accepted false positives:** a
  generic title word still drops its everyday use (for "Water main contamination fears", "a glass of water" / "the
  dog's water bowl" are dropped — on-incident vocabulary for that exercise), and "boil water for the pasta" trips the
  `boil water` phrase. Dropping chatter is free; leaking the incident is not.
- **W-B (re-rolls count against the caps).** Each guard / diversity / ambient-filter re-roll is a real provider call.
  The driver still records the burst's `intent.Count` at generation; once the burst is settled (dropped, queued, held
  or published) it also records `(GenerateStageResult.Attempts − 1) × intent.Count` into the same wall-clock window, so
  `maxPerMinute` / `maxPerHour` bound provider spend (posts requested), not only accepted bursts. The extra spend is
  recorded after settlement so it limits the NEXT decision and never retro-holds the burst that already passed. A
  provider call that throws mid-re-roll is not counted (the tick faults and is logged).
- **S-1 (attribution).** The autonomous publish stamps `EngineBurst.AuthorizedBy` from the CURRENT policy snapshot
  `PublishHold` just admitted (still inside the no-await block), not the tick-start snapshot.
- **S-3.** The stored `citizen` archetype is compared case-insensitively in `IneligibleAmbientType`.
- **S-2 (residual, doc only).** The exclusions come from `registration.Storylines`, frozen when the reaction loop is
  seeded. A storyline injected at runtime must refresh the registration (and so the exclusions); until it does, only
  the fixed vocabulary covers it.

## Tests (backend)
- `AmbientPolicyValidatorTests.*` (AC0, AC1); `AmbientBehaviorTests.*` (AC4, white-noise overlap)
- `InjectionRedTeamTests.Catalog_CarriesAmbientPersonaBioSteeringCases` + the catalog theories (AC7)
- `InjectionRedTeamTests.Catalog_CarriesPersonaVoiceNotesVectorCases`,
  `.PersonaVoiceNotesAttack_ReachesTheTrustedPromptUnfenced_AndItsObeyedFormIsCaught`,
  `GenerateStageTests.GenerateAsync_AmbientBurst_SteeredViaPersonaVoiceNotes_ObeyedOutputIsDropped` (AC7, Gate-1 M-2)
- `PromptAssemblerTests.Assemble_Ambient_CarriesNoStorylineOrEscalationFraming`,
  `.Assemble_Ambient_CarriesTheTopicSeed_TheBackgroundSetting_AndTheTask`, `.Assemble_Ambient_SkipsPersonaRecentPosts`,
  `.Assemble_NonAmbient_KeepsTheStorylineFraming_AndRecentPosts`; `AmbientBehaviorTests.TheAmbientMix_IsCalmAndGratitudeOnly`
  (AC4/AC7, Gate-1 H-1)
- `EngineAmbientPolicyRegistryTests.TheSettingsSnapshot_ReportsTheLoopCast_AsVoiceablePersonaIds_OnlyForThisExercise`,
  `.TheSettingsSnapshot_VoiceablePersonaIds_IsNull_WhenNoLoopIsRegistered` (AC2, Gate-1 M-1)
- `EngineAmbientPolicyServiceTests.Autonomous_WhileTheKillSwitchIsEngaged_Is400_AndChangesNothing`,
  `.Autonomous_WhileCutToFake_Is400_AndIsAcceptedAgainAfterRestore` (AC2/AC6, Gate-1 L-1)
- `EngineAmbientPolicyRegistryTests.*` (AC0 flag binding/committed false, AC1 registry, AC5 interim gate)
- `EngineAmbientPolicyServiceTests.*` (AC0, AC2, AC3 foreign persona/unresolved scope, AC6 request-path demotion)
- `AmbientAutonomousPublishTests.*` (AC4-AC9 through the real driver; both kill-switch modes, degraded, cut-to-Fake,
  EndEx/Freeze/Pause engine, guard failure, review never auto-sends)
- `AmbientKillSwitchRealTickTests.AfterTheLever_NoAmbientPostIsPublished_WithinTheRealTickInterval` (AC6, real 5 s tick,
  FullStop / DropToSuggest / CutToFake)
- `AmbientCompositionRootWiringTests.*` (AC3 composition-root guard, `WebApplicationFactory<Program>`)
- Docker-gated (`[RequiresDockerFact]`): `AmbientPolicyIsolationTests.*` (AC3 foreign exercise, foreign org, 401, body
  `exerciseId` ignored, foreign persona — real `Program` + real sessions), `AmbientRealPublishTests.*` (AC9 real SQL
  publish), `EngineSettingsEndpointsTests` (route added to the #297 role-gate drift guard + contract key)
- Orchestrator review hardening: `AmbientOutputFilterTests.*`, `AmbientSettingBriefTests.*` (W-3/S-2);
  `PromptAssemblerTests.Assemble_FlagsTheTransportRequest_AmbientOnlyForAnAmbientBrief` (W-3);
  `AmbientBehaviorTests.AnAllowListedPersonaOfAnIneligibleType_IsNeverVoiced`, `.EligiblePersonaTypes_AreResidentAndHelperOnly`,
  `EngineAmbientPolicyServiceTests.APersonaOfAnIneligibleArchetype_Is400_NamingThePersonaAndItsType`,
  `.APersonaInTheEngineCast_IsJudgedByItsEngineType`,
  `EngineAmbientPolicyRegistryTests.TheSettingsSnapshot_VoiceablePersonaIds_IsTheCast_IntersectedWithEligibleTypes`,
  `AmbientHardeningTests.AnAllowListedOutlet_IsNeverVoiced_EvenIfThePolicyNamesIt` (W-4);
  `AmbientHardeningTests.TheAmbientPrompt_CarriesThePlaceName_NeverTheIncidentBrief`,
  `.WithNoPlaceName_TheAmbientPrompt_UsesTheGenericSetting`,
  `.AnAmbientPostThatDriftsTowardTheIncident_IsDroppedLikeAGuardFailure` (W-3/S-2);
  `.APolicyNarrowedBetweenGenerationAndPublish_HoldsThePublish`, `.APersonaRemovedAfterTheFirstPost_HoldsTheRestOfTheBurst` (W-6);
  `.AReviewDraft_FinishingAfterFreeze_IsDiscarded_NotQueued`, `.AReviewDraft_FinishingAfterEndEx_IsDiscarded_NotQueued`,
  `.AReviewDraft_WhosePolicyWasTurnedOffMidGeneration_IsDiscarded` (W-7);
  `.AnApprovedAmbientDraft_PublishesWithAmbientFloorTrigger_AndTheReviewedPublishPath` (S-1);
  `EngineAmbientPolicyServiceTests.NoAuthenticatedStaffUser_Is401_AndChangesNothing`,
  `.ASpoofedActingHumanId_DoesNotBecomeSetBy_OrTheAuditActor` (W-2); `AmbientPolicyRaiseTests.*` (W-1 helper)
- Gate-1 follow-up: `AmbientOutputFilterTests.WaterStoryline_EverydayWordsThatOnlyContainATerm_Pass`,
  `.StormStoryline_EverydayWordsThatOnlyContainATerm_Pass`, `.WaterStoryline_TruePositives_StillFail`,
  `.WaterStoryline_TheStorylineHashtagInTheHashtagList_Fails_WithOrWithoutTheHash`, `.StormStoryline_TruePositives_StillFail`,
  `.AGenericTitleWord_StillDropsAnOnIncidentEverydayUse_ByDesign`, `.AFixedIncidentTerm_Fails` (W-A);
  `AmbientHardeningTests.ReRolledAttempts_CountAgainstTheHourlyCap_WithoutHoldingTheBurstThatPassed`,
  `.ADroppedBurst_CountsEveryAttemptAgainstTheCaps`, `.AFirstTimeAcceptedBurst_CountsOnlyItsOwnPosts` (W-B);
  `.AnAutonomousPublish_IsAuthorizedByTheCurrentPolicySetter_NotTheTickStartOne` (S-1);
  `EngineAmbientPolicyServiceTests.ACitizenArchetype_IsEligible_WhateverItsStoredCase` (S-3)
