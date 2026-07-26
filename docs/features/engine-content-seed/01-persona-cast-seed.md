# Story: Persona cast seed — the engine's minimum viable cast  `[backend]`

**Feature:** engine-content-seed  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Complete
**Requirements:** E8 arch §5/§14 (eligible cast the reaction loop needs to voice a burst) — narrow,
engine-scoped; explicitly NOT COR-020/021 (`persona-management` remains the templates/cast-authoring
feature — see feature.md "Naming disambiguation")  ·  **Design decisions:** none  ·  **Issue:** #325

> **SUPERSEDED IN PART — read before trusting the "six personas" wording below.** This story
> originally shipped a fixed **six**-persona catalog that deliberately excluded any SOC-052
> impersonation/low-credibility persona (see the original Context/AC1/Tests below, kept for history).
> `profiles-social-graph/06-persona-presentation-fields-api.md` (#369, Complete) later extended this
> exact seeder (`PersonaCastSeeder.cs`, the same file this story owns) to a **nine**-persona catalog —
> adding `@FairhavenWaterUpd` (unverified SOC-052 lookalike), `@TheScoopHQ` (low-credibility outlet),
> and `@dreyes_fh` (an ordinary resident) — and added the `Persona.Castable` gate (defaults `true`;
> the two new low-credibility rows ship `false`) so the engine's eligible cast still excludes them
> without withholding the rows participants can browse. **The cast is nine personas today, not six,
> and the exclusion below is no longer current** — see `feature.md`'s reconciled note and story 06 for
> the authoritative current state. `Castable`'s *storage* is done; a live UI/surface to flip it for a
> running scenario remains unbuilt.

## Context
The publish path already works and already fails closed correctly: `EngineReviewService`'s
`ResolvePersonaHandlesAsync` resolves each draft post's persona handle against real `Persona` rows and,
per `PublishDecisionAsync`'s WR-002/SG-001 guard, an unresolved handle means the burst is **not** marked
Published and the approve call surfaces `PublishFailed`. That guard is correct and stays untouched — but
today it always fails, because no production path ever writes a `Persona` row for a bootstrapped
exercise. `PersonaEndpoints` (`GET /api/personas`) is read-only by design (its own doc: "no persona
authoring/seeding write path"), and `login/05`'s `BootstrapService` seeds `Exercise` +
`StaffAssignment`/`SharedCredential` + one participant `Account` — no `Persona` at all.

This story adds the minimum write path: a fixed, idempotent starter cast of six `Persona` rows, matching
the shipped frontend org-library mock's Fairhaven water-contamination cast
(`src/frontend/src/features/personas/personaTemplates.ts`) so that once posts start publishing, the
already-built participant feed renders authors that are internally consistent with the persona picker /
avatar treatment already shipped elsewhere — not a mismatched placeholder set. No schema change: the `B0`
`Persona` entity already has every field this story needs (`DisplayName`, `Handle`, `Kind`, `Verified`,
optional `PersonaTemplateId`).

See `feature.md`'s "Naming disambiguation" note before assuming this satisfies COR-020/021 — it does not.

## Acceptance Criteria
- [x] **As originally shipped by this story:** **Given** an exercise with no seeded personas, **when**
  `PersonaCastSeeder.SeedAsync(exerciseId, ct)` runs, **then** it creates exactly six `Persona` rows
  stamped with that `exerciseId`: `FairhavenWater`
  ("Fairhaven Water Utility", `org`, verified), `FulcoEM` ("Fulton County EM", `org`, verified),
  `Newsline7` ("Newsline 7", `org`, verified), `mvega_fh` ("Marisol Vega", `human`, unverified),
  `tbrandt41` ("Tom Brandt", `human`, unverified), `kwardFH` ("Keisha Ward", `human`, unverified).
  **SUPERSEDED (profiles-social-graph/06, #369):** `PersonaCastSeeder.Catalog` now seeds **nine** rows
  — the six above plus `FairhavenWaterUpd` (unverified SOC-052 lookalike, `Castable = false`),
  `TheScoopHQ` (unverified low-credibility outlet, `Castable = false`), and `dreyes_fh` (unverified
  resident). This AC's "exactly six" is no longer what the seeder does; see the superseding story for
  the current catalog and its own AC4/tests.
- [x] **Given** the same exercise already has some or all of these personas (matched by `Handle` within
  the exercise), **when** `SeedAsync` runs again, **then** no duplicate rows are created — the existing
  row's `Id` is returned and reused, never overwritten (idempotent, safe to re-run — the same non-
  clobbering contract `BootstrapService` already uses for its own rows).
- [x] **Given** `SeedAsync`'s result, **when** a caller (story 03) consumes it, **then** each seeded
  persona is paired with a real `PersonaDossier` (`Handle`, `DisplayName`, `Type`, non-empty
  `VoiceNotes`, a distinguishing `PersonaStyle`, an `AudienceBand`) — not a placeholder/empty dossier —
  so the already-built diversity gate (`BurstAcceptancePolicy`) has real per-persona style to check a
  burst against, and a future live-provider swap (`engine-runtime/04`) has real voice material to work
  with.
- [x] Every seeded persona's `Kind` (`org`/`human`) is set correctly and `Verified` is set exactly as
  listed above — no seeded persona invents a false verified badge (SOC-052 stays honest: verification
  is a trainable signal, not a default).
- [x] **Isolation (XC-001/COR-001).** Every created/reused row is confined to the caller-resolved
  `exerciseId` — never `Guid.Empty`, never another exercise's id. Because this ops seam has **no**
  per-request `IExerciseContext` (mirroring `BootstrapService`'s own documented stopgap — there is no
  session to resolve one from), idempotency reads use `IgnoreQueryFilters()` **plus an explicit
  `ExerciseId` predicate** rather than relying on the (fail-closed-to-empty) global query filter, which
  would otherwise see zero rows and duplicate on every call.
- [x] **Content security (NFR-004).** `DisplayName` / `Handle` / `VoiceNotes` pass through the same
  sanitization the account-import/post paths already use (reuse `PostSanitizer.Sanitize` or the
  `AccountFieldRules` normalization pattern — do not reinvent a third sanitizer) before being persisted.
  These are developer-authored constants today, not attacker input, but the funnel must be the same one
  a future request-body-driven variant would need, and a stored value must never be able to carry an
  executable payload regardless of its origin.

## Out of Scope
`PersonaTemplate` library rows or any planner-facing authoring UI (`persona-management` owns that).
**Bad-actor / impersonator personas — SUPERSEDED.** This section originally excluded the SOC-052
lookalike training pair from this story's own scope (see `feature.md` Design notes, since rewritten);
`profiles-social-graph/06` (#369) later added them to the SAME catalog this story owns, gated by
`Persona.Castable` rather than by omission. Avatar images (COR-024). Believable derived state beyond a
fixed placeholder as originally shipped — **superseded**: `profiles-social-graph/06` added real
`AudienceMagnitude`/`JoinedAt` derivation (varied follower counts, backdated join dates) to this exact
seeder; COR-021's remaining job is the planner-facing template-authoring UI, not the derived-state
values themselves. Any change to `PersonaEndpoints.cs`'s read-only posture (`GET /api/personas` still
never writes; story 06 changed what it *projects*, not that constraint).

## Technical Notes
Backend, ops-only — no UI, no COBRA, no participant surface of its own. Owns
`src/Pulse.WebApi/Features/Ops/EngineContentSeed/PersonaCastSeeder.cs`.

**Reuse, do not reinvent** (see `implementation.md`): `Pulse.WebApi.Data.PulseDbContext.Personas` +
`Pulse.WebApi.Data.Entities.Persona` (no migration — every field already exists);
`Pulse.Core.Features.Generation.Models.PersonaDossier`/`PersonaStyle`/`PersonaType` (the same dossier
shape `EnginePersona` and the generate stage already consume — see `ReactionLoopHost.cs`'s
`EnginePersona` record); `Pulse.WebApi.Features.Social.PostSanitizer.Sanitize` (or
`Pulse.WebApi.Features.Identity.Accounts.AccountFieldRules`'s normalization pattern) for the NFR-004
funnel.

**The six starter personas' dossiers, as originally shipped by this story** (handle → `PersonaType` →
voice-note gist), matching the shipped frontend mock exactly (same handles/names/kind/verified so `GET
/api/personas` and this seed never disagree once persona-management's real authoring lands and can
reconcile against these rows). **`profiles-social-graph/06` (#369) added three more rows to this same
catalog** (`FairhavenWaterUpd`, `TheScoopHQ`, `dreyes_fh`) — see that story for their dossiers; not
repeated here to avoid two documents drifting on the same table:

| Handle | Display name | Kind | Verified | `PersonaType` | Voice gist |
|---|---|---|---|---|---|
| `FairhavenWater` | Fairhaven Water Utility | org | true | `Agency` | Measured, factual, procedural; never speculates |
| `FulcoEM` | Fulton County EM | org | true | `Agency` | Authoritative but calm; plain-language advisories |
| `Newsline7` | Newsline 7 | org | true | `Outlet` | Broadcast-news cadence, headline first |
| `mvega_fh` | Marisol Vega | human | false | `Resident` | Concerned resident, practical questions |
| `tbrandt41` | Tom Brandt | human | false | `Resident` | Skeptical, a little cynical |
| `kwardFH` | Keisha Ward | human | false | `Resident` | Level-headed, community-minded |

**Exports** (the contract story 03 composes): `PersonaCastSeeder.SeedAsync(Guid exerciseId, CancellationToken)`
→ `IReadOnlyList<SeededPersona>` where `SeededPersona` is a small record pairing the persisted
`Persona.Id` (`InstanceId`) with its `PersonaDossier` — directly assignable into
`ReactionLoopHost.EnginePersona(InstanceId, Dossier)` at the registration seam (story 03 does that
assembly; this story does not construct `EnginePersona`/`ReactionLoopRegistration` itself, keeping its
file footprint disjoint from story 02/03).

## Dependencies
A bootstrapped `Exercise` already exists (`login/05`'s `POST /api/ops/bootstrap-exercise`) — this story
does not create exercises, only personas within one the caller (story 03) has already resolved. No
dependency on story 02 (storyline) — file-disjoint, can build in parallel.

## Tests
xUnit (`Pulse.WebApi.Tests`, real SQL via `RequiresDockerFact` where a DB round-trip matters, mirroring
`ReactionLoopHostTests`' harness): as originally shipped, seeding a fresh exercise created exactly six
rows with the exact handles/kind/verified table above (SUPERSEDED — now nine, see below); seeding
twice creates zero additional rows and returns the same ids; seeding exercise A never creates or reads
rows scoped to exercise B (extends the standing isolation suite, `IgnoreQueryFilters()` + explicit
predicate proven against a second exercise's pre-existing same-handle personas); each returned
`SeededPersona.Dossier.VoiceNotes` is non-empty and distinct across personas (a quick sanity check
that the diversity gate has real material, not five copies of one note).

**Delivered tests** (`Pulse.WebApi.Tests/Features/Ops/EngineContentSeed/PersonaCastSeederTests.cs`, `[RequiresDockerFact]`).
**Renamed/superseded by `profiles-social-graph/06` (#369), confirmed against the current file:**
- `SeedAsync_FreshExercise_CreatesExactlyNinePersonas_WithTheExactHandlesKindVerified` (AC1, AC4 —
  this test's original name was `...CreatesExactlySixPersonas...`; renamed when the catalog grew)

**Still current, unchanged by story 06:**
- `SeedAsync_RunAgain_CreatesNoDuplicates_AndReturnsTheSameIds` (AC2)
- `SeedAsync_EachReturnedDossier_HasNonEmptyDistinctVoiceNotes_AndRealTypeAndStyle` (AC3)
- `SeedAsync_ForExerciseA_NeverCreatesOrReadsExerciseBRows_EvenWithSameHandles` (AC5 — isolation, fails closed)
- `SeedAsync_StoredFreeText_PassesThroughTheSanitizationFunnel` (AC6 — NFR-004, now also covers `Bio`)

See `profiles-social-graph/06-persona-presentation-fields-api.md`'s own Tests section for the full set
of NEW tests that story added (the impersonation pair, `Castable`, the backfill/reconciliation
behavior, the per-world DTO split) — not duplicated here.
