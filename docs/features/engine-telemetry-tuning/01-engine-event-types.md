# Story: Engine event types (extend XC-004)

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress
**Requirements:** ADP-041, XC-004  ·  **Design decisions:** none  ·  **Issue:** #173

## Context
Every engine action is logged with its trigger and storyline (ADP-041), extending the XC-004 v0 event
schema — **not** forking it (a schema mistake is a cross-phase migration, adversarial review D2). The
engine event types (architecture §11): `engine.observed`, `engine.decided`, `engine.generated`,
`engine.reviewed`, `engine.published`, `engine.measured`, and `storyline.state_changed` (plus the
v1.1 `rumor.*` family, reserved). Each carries wall + scenario time, actor, channel.

**Attribution note — read before trusting the checkboxes below.** This story was authored *after* the
emissions it describes had already shipped, in `engine-runtime` and `autonomy-safety`. **Five of its six
ACs were satisfied by pre-existing code before any work started on this story**; only AC5's enforcement
half was a genuine gap. The per-AC list below states plainly, for each AC, whether it was already true or
whether this commit is what made it true — do not read a ticked box here as "built by #173" without
checking which case it is.

## Acceptance Criteria
- [x] Given each engine loop stage/action, when it occurs, then it emits the corresponding event type
      (`engine.observed`/`decided`/`generated`/`reviewed`/`published`/`measured`,
      `storyline.state_changed`) carrying its **trigger** and **storyline** (ADP-041).
      **Satisfied, pre-existing.** All seven types are emitted: `ReactionLoopHost.cs:654` (`Observed`),
      `:671` (`Decided`), `:701` (`Generated`); `EngineReviewService.cs:1026` (`Reviewed`);
      `EnginePublishService.cs:208` (`Published`); `MeasureStage.cs:98` (`StorylineStateChanged`),
      `:116` (`Measured`). Trigger is carried only on `engine.observed`'s payload — it is not a column
      on the other event types, matching architecture §11 (each stage's payload carries what only that
      stage knows; not every payload repeats every earlier field).
- [x] Given any engine event, when emitted, then it carries wall-clock + **scenario** time, actor
      (incl. the human behind a shared org account, COR-018), and channel — per the XC-004 v0 schema.
      **Satisfied, pre-existing.** `EngineTelemetryContext` makes `WallClockTime`, `ScenarioTime`,
      `TimeZone`, `Channel`, and `Actor` `required` members (`IEngineTelemetryEmitter.cs:41-54`), so no
      caller can build an event missing any of them. This commit additionally pins the property with a
      new taxonomy-wide test (`EveryEngineEventType_CarriesWallAndScenarioTimeActorAndChannel`) rather
      than relying on the compiler alone.
- [x] Given the XC-004 v0 taxonomy, when engine events are defined, then they **extend** it (shared
      envelope, additive event types) so E10 metrics + E9's INT-031 stream consume them without a
      migration.
      **Satisfied, pre-existing.** `TelemetryEvent.EventType` is a plain open string;
      `TelemetryEnvelopeRules` carries no event-type allowlist (only conditional-attribution rules);
      `Payload` is opaque `nvarchar(max)`, never parsed server-side. No EF migration exists, or was
      needed, for any event type in this taxonomy — including the two added by this commit.
- [x] Given `engine.reviewed`, when a review action occurs, then the action is captured
      (approve / edit / veto / re-roll / **hold-on-expiry** / auto-send) with the actor.
      **Satisfied, pre-existing.** The two timer-driven actions were the assumption most likely to be a
      gap going in — they were not; they are the best-covered of the six.
      `EngineReviewService.cs:648` emits `EngineReviewAction.AutoSend` (the swamped-mode timeout-publish
      path) and `:654` emits `EngineReviewAction.HoldOnExpiry` (the "silence is never approval" D5-014/1.1
      path), and both are asserted end-to-end in `EngineReviewSafetyInvariantTests.cs`
      (`AutoHold_CountdownExpiresWithNoDecision_Holds_NeverPublishes_EmitsHoldOnExpiry`,
      `AutoHold_SwampedModeAndEffectiveDelayedAuto_AutoSends_EmitsAutoSend`).
- [x] Given v1.1 rumor work, when the schema is defined, then the `rumor.*` event family + the
      `rumorRef`/`mutationOf` lineage fields are **reserved** so v1.1 needs no migration.
      **Was partial before this commit; now satisfied.** The other assumption that turned out wrong: all
      five `rumor.*` names were already on `main` (`EngineEventTypes.Rumor`, added by the `engine-runtime`
      Wave-0 seam-freeze commit `e7dce0b`), and the lineage slots were already reserved in all three
      places that matter (the `Published` payload's optional fields, the emitter, and the doc prose). The
      real gap was that **nothing tested any of it** — an unenforced reservation is a comment, not a
      guarantee. This commit is what turns the reservation into an enforced property: see the four new
      tests in the AC↔test table below.
- [x] Events are **staff/evaluator-facing** (XC-002); exercise-scoped (COR-001).
      **Satisfied, pre-existing.** `TelemetryEvent : IExerciseScoped`, covered by the standing
      `Data/QueryFilterIsolationTests` suite including its fail-closed and `IgnoreQueryFilters` cases.
      Structural note: there is **no read surface over telemetry at all yet** — story 02
      (`engine-telemetry-tuning/02`) owns that — so this story adds no new participant-facing (or even
      staff-facing) read path; it only extends the write-side vocabulary.

## What this commit actually delivered

Given the audit above, the real work in this pass was three things, not a re-derivation of the whole
taxonomy:

1. **Ratified `engine.provider_changed`** (`EngineEventTypes.cs:66-85`, `EngineEventPayloads.cs:236-271`)
   — accepted **as built** from `autonomy-safety/07` (PR #403). The "PENDING RATIFICATION" prose is
   replaced with a ratified rationale: one event per settings-style posture change with a from→to payload
   matches the sibling `AutonomyDefaultChanged`/`TierPolicyChanged` events, and a `cut`/`restore` `reason`
   discriminator on a single event type is a smaller taxonomy footprint than a cut/restore event pair.
   **No rename** — nothing already emitting has to change. This **discharges `autonomy-safety/07`'s AC8**,
   and closes the loop already recorded as a comment on issue #173.
2. **Completed the taxonomy** by naming two event types that existed as emissions but not as named
   vocabulary: `EngineEventTypes.ContentSeeded` (`engine.content_seeded`) and `EngineEventTypes.AutonomyChanged`
   (`engine.autonomy_changed`). Two honesty notes worth keeping on the record here, not glossing over:
   - `engine.content_seeded` (`EngineContentSeedService.cs`) builds its **own** envelope rather than going
     through `IEngineTelemetryEmitter` — this is pre-existing and correct, not a gap: the guarded ops seed
     has no resolved per-request engine context to build a `EngineTelemetryContext` from.
   - `engine.autonomy_changed` has **no server-side emitter at all**. The **frontend is its sole audit
     trail** (`useEngineControl.ts:267`, via `POST /api/telemetry`). That is a genuine gap in the audit
     story for this one event type specifically — recorded here as a gap, not implied to be fixed by
     naming it.
3. **`EngineEventTaxonomyTests.cs`** — 11 new model-only `[Fact]` tests that turn the reservations and the
   additivity claim into enforced properties instead of comments. All 11 were neuter-verified to fail
   before being accepted: an unratified constant, a renamed `rumor.spread`, `"re-roll"` renamed to
   `"reroll"`, and `mutationOf` renamed to `mutated_of` each independently red the suite.
4. **Corrected a stale doc claim.** The `Published` payload's doc comment advertised an `engine-edited`
   origin per architecture §11, but the build settled — in four places — that the approve/edit
   distinction is telemetry-only, carried on `engine.reviewed`'s `action` field, not on `Published`'s
   `origin`. Doc-only correction; the emission itself always wrote `"engine"` and nothing behavioral
   changed.

**The full live event-type set, for reference (this file is the taxonomy of record):**
12 emitted — `engine.observed`, `.decided`, `.generated`, `.reviewed`, `.published`, `.measured`,
`storyline.state_changed`, `engine.autonomy_default_changed`, `.tier_policy_changed`, `.provider_changed`,
`.content_seeded`, `.autonomy_changed` — plus 5 reserved (v1.1, not emitted) —
`rumor.seeded`/`.mutated`/`.spread`/`.countered`/`.killed`.

## AC ↔ test linkage

| AC | New this commit | Pre-existing |
|---|---|---|
| AC1 (emits type + trigger + storyline) / AC3 (additive, no migration) | `EngineEventTaxonomyTests.Taxonomy_DeclaresExactlyTheRatifiedEngineEventTypes`, `.Taxonomy_EveryEventTypeName_IsANamespacedLowerSnakeLiteral`, `.Taxonomy_IsAdditiveToTheLockedV0Envelope_NoEventTypeTripsAConditionalRule` | `ReactionLoopHostTests`, `MeasureStageTests`, `EnginePublishServiceTests` |
| AC2 (wall + scenario time, actor, channel) | `EngineEventTaxonomyTests.EveryEngineEventType_CarriesWallAndScenarioTimeActorAndChannel` | `EngineTelemetryEmitterTests.BuildEvent_StampsLockedV0Envelope` |
| AC4 (six review actions incl. timer-driven) | `EngineEventTaxonomyTests.ReviewActions_AreExactlyTheSixFrozenWireLiterals` | `EngineReviewSafetyInvariantTests` — hold-on-expiry (`AutoHold_CountdownExpiresWithNoDecision_Holds_NeverPublishes_EmitsHoldOnExpiry`) + auto-send (`AutoHold_SwampedModeAndEffectiveDelayedAuto_AutoSends_EmitsAutoSend`) cases |
| AC5 (`rumor.*` family + lineage fields reserved) | `EngineEventTaxonomyTests.Taxonomy_ReservesExactlyTheFiveV11RumorLineageEventTypes`, `.ReservedRumorEventTypes_AreEmittedByNothingInV1`, `.PublishedPayload_ReservedLineageSlots_AreNullOmittedWhenUnsetInV1`, `.PublishedPayload_ReservedLineageSlots_CarryLineageWhenSet_NoMigrationNeeded` | — |
| AC6 (staff/evaluator-facing, exercise-scoped) | — | `Data/QueryFilterIsolationTests` (isolation + fail-closed + `IgnoreQueryFilters` cases) |
| Ratification (`engine.provider_changed`, discharges `autonomy-safety/07` AC8) | `EngineEventTaxonomyTests.ProviderChangedPayload_RatifiedShape_IsFromToPlusReasonDiscriminator`, `.ProviderChangedPayload_ReasonDiscriminator_IsExactlyCutOrRestore` | — |

## Out of Scope
The tuning/observability surface that renders them (story 02); E10's metric computation (E10); the
XC-004 v0 base schema definition itself (E1 owns it — this story *extends* it); the rumor mechanics
(rumor-model, v1.1 — this reserves their event slots); a server-side emitter for `engine.autonomy_changed`
(recorded above as a known gap, not addressed by this commit).

## Technical Notes
Staff/backend. Additive event types on the XC-004 envelope; emitted by every E8 feature via the shared
telemetry emitter. Reserve `rumor.*` + lineage fields now (architecture §10.1/§14 schema-now note).
See implementation.md (story 01) and architecture §11.

**Merge-coordination flag.** `engine.provider_changed` now exists, independently, in two branches: this one
(`feature/engine-telemetry-tuning`, ratified) and `feature/autonomy-safety-cut-to-fake` / PR #403
(pending-ratification). Whichever merges to `main` second will hit a git conflict in the same region of
both `EngineEventTypes.cs` and `EngineEventPayloads.cs`. **Resolution: take this branch's side** — the
name, payload shape, and `cut`/`restore` literals are identical between the two; only the caveat prose
differs (this branch's says "ratified", #403's says "pending ratification"). This fails loud, not
silent — a duplicated `const string ProviderChanged` declaration is a compile error, not a silent drift —
but flagging it here so whoever resolves the merge knows the answer is "take ratified, drop pending"
rather than needing to re-derive it.

## Dependencies
E1 XC-004 v0 emitter (base schema); every E8 feature (emits these); E10 + E9 INT-031 (consumers).

## Tests
- Unit: each engine action emits its event type with trigger + storyline + wall & scenario time +
  actor + channel.
- Unit: event types validate against the XC-004 v0 envelope; `rumor.*` + lineage fields reserved.

## Build notes

**Status detail.** Built and merged to the umbrella `feature/engine-telemetry-tuning` (head `c79c2a8`).
Gate clean: 0 warnings, 389/389 Core, 1739/1739 WebApi (0 skipped) under the LocalDB hatch — 11 new
model-only tests over `main`'s 1728 baseline, all `[Fact]` (no DB, no host).

Following this feature's and `autonomy-safety`'s convention that **Complete requires verified-in-UAT**:
this story adds **no user-visible surface** (no new endpoint, no new read path — story 02 owns the read
side), so "verified in UAT" here means something narrower than usual: that the taxonomy's events continue
to appear in the deployed event log. That was checked this session by querying the UAT database directly:
ten of the twelve emitted event types have real rows. The two absent are `engine.tier_policy_changed`
(nobody has changed tier policy in UAT yet — an activity gap, not a wiring gap) and `engine.provider_changed`
(not on `main` yet — it lives only on this umbrella and on PR #403 pending the merge noted above). Status
is left at **In Progress** rather than Complete pending that merge landing on `main` and this umbrella
itself reaching `main`.
