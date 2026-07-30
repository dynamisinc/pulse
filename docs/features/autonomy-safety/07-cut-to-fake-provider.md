# Story: Cut generation to the Fake provider (runtime egress safety lever)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-042 (kill-switch family — extends the "one manual control, only ever less" lever
to the provider/egress axis), NFR-005 / ADP-025 (the governed-endpoint boundary this lever must not
cross)  ·  **Design decisions:** none  ·  **Issue:** #402

## Context
Today, "which generation provider runs" is a **startup-only** decision: `AddEngineGeneration`
(`Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs:35-55`) switches on `Generation:Provider`
once and registers **either** the real provider (`AzureOpenAIGenerationProvider` /
`ClaudeFoundryGenerationProvider`, as a singleton typed `HttpClient`) **or** `FakeGenerationProvider` —
never both. Changing it requires an app-setting edit and an App Service restart. There is no runtime
path, and no control a controller can reach mid-exercise if the live provider needs to stop egressing
right now (a cost spike, an unexpected model behavior, a live incident unrelated to the exercise
itself, or simply "we're done with the live pass, go back to canned content").

This is the missing manual lever at the **provider** layer, structurally the same shape as the
existing **kill switch** (`03-kill-switch.md`, ADP-042) at the **autonomy** layer and the **automatic
circuit-breaker degraded path** (`IProviderHealthListener.OnDegradedAsync`,
`ServiceCollectionExtensions.cs:117`) at the **health** layer: all three exist so an operator (human or
automatic) can only ever reduce what the engine is doing, never expand it (architecture §8.2). The
`GET /api/engine/settings` read (`EngineSettingsContracts.cs`) already documents the boundary this
lever must respect in as many words — the endpoint "can never change which deployment/model a tier
resolves to (NFR-005 / ADP-025 — that would let an operator route traffic to an unattested endpoint,
defeating the startup governance gate)" (`EngineSettingsContracts.cs:30-34`).

**The central design invariant — read this before writing a line of code.** This lever is a **binary
between the startup-configured provider and Fake — never a provider chooser.** The reachable-endpoint
set stays exactly what `GenerationGovernance.Validate` signed off at startup; nothing this story adds
can make a new endpoint reachable. That asymmetry is the whole story:

- **Cutting live → Fake is in scope.** It only ever *reduces* egress — same shape as the kill switch
  and the circuit breaker.
- **Restoring Fake → the startup-configured provider is in scope**, because it can never exceed the
  governed baseline: it returns to exactly what the signed startup config already authorized. This is
  the direct sibling of `RestoreFromSafety` (kill switch) — same "human-only raise, capped at what was
  already permitted" shape (§8.2).
- **Selecting any provider other than the startup-configured one is explicitly OUT of scope** — see
  Out of Scope. That is a Tier-2 governance change against `PROVIDER-GOVERNANCE.md` §8 (currently
  **UNSIGNED**), not a feature this story builds.

`PROVIDER-GOVERNANCE.md` §8 is unsigned today and UAT runs `Provider=Fake`, so this lever is currently
inert in every deployed environment — it becomes load-bearing the moment §8 is signed and a live
provider goes reachable. Building it now (ahead of that signature) means the safety brake exists
*before* the live endpoint does, not after.

## Acceptance Criteria
- [ ] Given the exercise's startup-configured provider is a real (egressing) provider, when a
      controller-role staff `POST`s the cut (`actingHumanId` required, COR-018), then that exercise's
      reaction loop generates its next burst through `FakeGenerationProvider` instead — immediately,
      with **no restart, no config change, no effect on any other exercise**. The set of registered
      `IGenerationProvider` instances is exactly what startup created; this only changes which
      **already-registered** instance a given exercise resolves to.
- [ ] Given a cut is active, when a controller-role staff `POST`s restore, then the exercise's next
      burst reverts to generating through the **startup-configured** provider and no other — restore
      can never land on a provider that was not already running at startup (mirrors kill switch's
      `RestoreFromSafety`: a human-only raise, capped at the pre-existing baseline).
- [ ] Given the startup-configured provider is **already** `Fake` (the committed default; every CI run
      and, as of this story, UAT) — cutting is a no-op that reports `alreadyFake: true` rather than a
      false "I just locked something down" signal; restoring when no cut is active is likewise a no-op.
      Both are idempotent, not errors.
- [ ] Given the wire contract, when any caller inspects or exercises it, then there is **no field, no
      route, and no accepted literal anywhere that selects a provider by name** — the cut/restore
      endpoints take only `actingHumanId` (+ optional `timeZone`, matching the existing settings
      convention). A request that attempts to pass a provider selector is rejected 400 (or ignored and
      the ignored-field is asserted in a test) so the endpoint shape itself cannot become a chooser by
      a later, smaller change slipping in unreviewed.
- [ ] Given `GET /api/engine/settings`, when it reports the active provider, then **configured** and
      **effective** are two distinguishable facts on the wire (see Technical Notes — this changes the
      currently-single `provider` field's implied meaning and must be handled as a deliberate,
      additive contract change, not an overload); the staff console visibly and honestly labels when
      the effective provider differs from the configured one (text, not color alone — folds into the
      NFR-001 AC below) so a controller can never lose track of "we are currently running on Fake."
- [ ] **Isolation, fail-closed (COR-001/XC-001):** every cut/restore/read resolves the exercise only
      from `IExerciseContext`; an unresolved scope is `401`, **never** a default/unscoped snapshot
      (matches the existing `EngineSettingsResult.ScopeUnresolved` contract exactly — this is an
      additive sibling to that result type, not a new fail-open path). A cut applied in exercise A
      never affects exercise B's provider resolution.
- [ ] **Staff-only, fiction-preserving (XC-002 / D0 §2 / SOC-003):** the lever and its indicator live
      only on the staff console (COBRA), never a participant path. Participants must **never** learn
      the world is running on Fake — this is exercise-fiction-breaking information, not merely an
      internal detail, so the effective-provider fact is staff-only by construction (no participant
      API, feed, or persona surface projects it, directly or inferably).
- [ ] **Telemetry (XC-004):** the server — not only the frontend — emits an event on both cut and
      restore, carrying wall + scenario time, the acting human (COR-018, including the human behind a
      shared org account), the exercise, and the from/to provider names. This is a deliberate
      correction of the existing gap: kill-switch/restore emit **no** server-side telemetry today
      (frontend emission is the sole audit trail) — this story does not repeat that gap. Whether the
      event rides a new `engine.provider_cut_to_fake` / `engine.provider_restored` pair or an existing
      steering/autonomy-change taxonomy entry is an **open question to align with
      `engine-telemetry-tuning/01-engine-event-types.md` (#173)** before either vocabulary is
      finalized — flag it for that alignment, do not fork the taxonomy unilaterally in this story.

## Out of Scope
- **Selecting any provider other than the startup-configured one.** Not a smaller version of this
  feature — a different, Tier-2 governance decision against `PROVIDER-GOVERNANCE.md` §8 (unsigned).
  The wire contract must not even have a slot for it (see AC4).
- **The §8 go-live itself** (signing off `generationProviderLive`/`generationTenantBounded`/
  `generationNoTrainingAttested`) — unrelated human sign-off this story does not touch or gate.
- **Spend caps or auto-cutting on a cost threshold.** Already named as a deliberate non-goal in
  `engine-telemetry-tuning/feature.md`'s later-phase note (#401) — cross-reference it; do not
  re-litigate an automatic-trigger version of this lever here. This story is the **manual** control
  only, same as the kill switch is manual and the circuit breaker is its automatic sibling.
- **Persisting the cut/restore state across a restart.** In-memory, per-exercise, consistent with
  every existing autonomy/tier-policy lever (`EngineSettingsDto.InMemoryState`/`InMemoryNote`) — name
  this as deferred, not solved, and report it honestly through the same note (see Technical Notes).
- **Refactoring `EngineControlBar`'s kill-switch cycle** or inventing a second toolstrip surface — this
  reuses story 06's existing "ENGINE" flyout/hook, it does not add a new console extension point.
- **A scheduled or automatic version of this cut.** The automatic sibling already exists (the
  circuit-breaker degraded path, generation-infra story 05) and operates on health signals, not egress
  policy; this story does not merge the two mechanisms.

## Technical Notes
Staff world (COBRA console; XC-002). This story has a real backend seam and a thin frontend seam;
cross-reference `implementation.md` before scheduling either half.

**The composition-root change — flag, do not pre-assign.** `AddEngineGeneration` registers exactly one
`IGenerationProvider` today (`ServiceCollectionExtensions.cs:35-55`). A runtime cut needs an
indirection: a selector/decorator registered as the actual `IGenerationProvider` the reaction loop
resolves, which consults a per-exercise cut-state registry and delegates to either the
startup-configured provider or a `FakeGenerationProvider` instance. **Both must therefore be
registered** — the real provider's `AddHttpProvider<TProvider>` branch and the Fake branch, no longer
either/or. This is a change to the composition root (`Pulse.Core.Core.Extensions.
ServiceCollectionExtensions`) and, per the orchestration playbook, is **orchestrator-owned** — call it
out at planning time, do not let a builder wave silently absorb it as an incidental edit.

**State location — mirrors the existing levers, do not invent a second channel.** Per-exercise, in
process memory, alongside `EngineAutonomyRegistry`/the tier-policy-mode store from story 05 (a
`ConcurrentDictionary<Guid, bool>`-shaped registry is the obvious fit). This lever's state must be
reported through the **same** `EngineSettingsDto` snapshot that already carries `InMemoryState`/
`InMemoryNote` — do not add a second "is this exercise messing with the engine's config" read. Because
`InMemoryNote` is a shared `const` (`EngineSettingsContracts.cs:23`, tests and the panel read it
verbatim), adding this lever to what resets on restart means **editing that string**, which is a wire
and test-fixture change, not an additive-only one — call it out in review.

**Wire contract — `provider` becomes two facts, handle it as a deliberate contract change.**
`EngineSettingsDto.Provider` is today `required string`, documented read-only, and implicitly assumed
by every existing consumer to be "what's actually running." Once a cut can be active, that is no
longer true. Add a new field (e.g. `effectiveProvider`) rather than repurpose `provider`'s meaning —
same shape as story 05's `exerciseDefaultLevel`/`effectiveLevel` split (WR-003: a consumer must never
re-derive "cut active ⇒ effectively Fake" by comparing two fields; read the effective field directly).
Keep `provider` meaning "the startup-configured provider, unchanged" so existing tests/consumers that
read it for that meaning do not silently start lying.

**Console surface.** The natural home is story 06's existing "ENGINE" flyout
(`EngineSettingsPanel.tsx`/`useEngineSettings.ts`) — add the cut/restore toggle there rather than a new
toolstrip entry, reusing the **await-then-apply, no-optimism** pattern that flyout's rebuild settled on
(see `06-engine-settings-panel.md`'s Build notes): a click flips only a local `pending` flag, the
authoritative `EngineSettingsDto` response is what's ever displayed, and there is no revert path to
get wrong. Label the effective-vs-configured distinction as text (e.g. "RUNNING ON: FAKE (cut from
Azure OpenAI)"), never a color chip alone (NFR-001).

**Backend files this story is expected to touch:** the composition-root indirection described above
(orchestrator-owned edge); a new per-exercise cut-state registry; two new `POST`s
(`/api/engine/generation-provider/cut-to-fake`, `/api/engine/generation-provider/restore`) on the
existing `/api/engine` group in `EngineReviewEndpoints.cs`, gated by the same
`EngineCockpitControllerRoleFilter` every other mutating `/api/engine` route already uses; the
`EngineSettingsDto`/`EngineSettingsContracts.cs` additive field; the `EngineEventTypes.cs`/
`EngineEventPayloads.cs` telemetry vocabulary, pending the #173 alignment noted in AC7.

## Dependencies
Story 03 (kill switch — the precedent this mirrors: "one manual control, only ever less", the
restore-capped-at-baseline shape); story 05 (`EngineSettingsDto`/`EngineReviewService`/the
controller-role gate this story's endpoints extend); story 06 (`EngineSettingsPanel.tsx`/
`useEngineSettings.ts` — the console home this story adds a control to, and the await-then-apply
pattern it reuses); engine-generation-infra (`AddEngineGeneration`, `FakeGenerationProvider`, the
circuit-breaker degraded path this lever is the manual sibling of); `engine-telemetry-tuning/
01-engine-event-types.md` (#173) — the taxonomy alignment named in AC7 must be resolved with that
story, not decided unilaterally here. The composition-root change is a planning-time dependency on
orchestrator sign-off, not a builder-assignable file.

## Tests
- Unit: cutting resolves the loop's next burst through `FakeGenerationProvider`; restoring resolves it
  back through the startup-configured provider; neither call ever selects a third provider.
- Unit: cut/restore are each idempotent when the startup-configured provider is already `Fake`
  (`alreadyFake: true`, no state change, no spurious telemetry).
- Unit: the wire contract accepts no provider-selector field/literal on either endpoint (a fuzz/shape
  test asserting the request DTO has no such property, plus a 400/ignored-field test).
- Unit: `GET /api/engine/settings` reports `provider` (configured, unchanged) and `effectiveProvider`
  (Fake while cut, configured otherwise) as two independently readable fields — no comparison-based
  re-derivation is exercised anywhere in the panel or its tests.
- Unit: isolation — a cut in exercise A never changes exercise B's `effectiveProvider`; unresolved
  scope on any of the three endpoints is `401` with no snapshot.
- Unit: the server emits exactly one telemetry event per cut/restore call, carrying actor + wall +
  scenario time + exercise + from/to provider — pending the #173 vocabulary decision (AC7).
- **UAT (required once `PROVIDER-GOVERNANCE.md` §8 is signed and a live provider is reachable in an
  environment) — not meaningful before then.** With the live provider active: cut to Fake as a
  controller, confirm the next burst is visibly canned/Fake content and the console indicator updates;
  restore, confirm the next burst returns to live-generated content. Until §8 is signed, this story's
  functional tests are provable only against the Fake-startup-configured case (cut/restore no-op path)
  — document that limitation on the story rather than claiming a UAT pass that could not have occurred.
