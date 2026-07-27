# Story: Reach model: definition workshop, exercise-scoped config + admin surface

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-012, SOC-054, ADP-004  ·  **Design decisions:** none  ·  **Issue:** #371

## Context
`profiles-social-graph/05` (#113) has shipped `src/frontend/src/features/social/services/audience.ts`
— the single source of the reach/velocity formula (`audienceReach()`), imported by **E8 ADP-004**
(amplification velocity) and **E10 EVL-012** (reach & traction's impressions proxy). Its
`AUDIENCE_REACH_MODEL` export freezes four coefficients, each with a stated engineering rationale:

| Coefficient | Value | Rationale as shipped |
|---|---|---|
| `baseExposureRate` | 0.12 | Reach is a fraction of audience (real platforms 5–15% organic), never "everyone saw it" |
| `intensityLift` | 1.0 | Full intensity at most doubles attention — bounded so the E7 dial cannot manufacture unbounded reach |
| `amplificationExponent` | 0.75 | Sub-linear; audiences overlap, so 10 reposts reach ~5.6× fresh eyes, not 10× |
| `spreadTimeConstantMinutes` | 45 | τ, scaled by intensity — a hot storyline spreads faster *and* further |

But `docs/10-evaluation-aar.md` F10.2's open-questions list explicitly parks the exact numbers for a
**definition workshop**: "reach computes over the audience-magnitude model (SOC-054); the specific
formula still needs a definition workshop before metric stories are written." The coefficients above
are, in the module's own words, "a defensible default contract" — engineering placeholders, not
ratified evaluation semantics. `audience.ts` already anticipates this story: it exports a frozen
`modelVersion: 'v0'` field and a "MODEL VERSIONING (#371)" doc block instructing that any coefficient
change bump the version in the same commit and stamp it onto anything that persists or exports a
reach figure.

**Why this is governance, not a runtime knob.** These coefficients determine the reach/impression
numbers an evaluator reads in E10 metrics (`evaluation-metrics/03`) and the AAR export
(`aar-export/01`). If they were adjustable mid-exercise, two exercises would stop being comparable and
AAR data would stop being reproducible — nobody could tell whether reach rose because the storyline
worked or because someone moved a slider. `autonomy-safety/05` (#353) sets the precedent this story
follows: autonomy level and tier *policy* are runtime-settable, but the concrete model/deployment
resolution each tier resolves to was **deliberately excluded** from runtime reach and kept as governed
config behind `GenerationGovernance.Validate`'s fail-closed startup gate, specifically so an operator
could not silently defeat a Tier-2 sign-off. The reach-model coefficients are the same category of
decision — they belong in governed, versioned, build-time config, **not** on the `autonomy-safety/06`
(#354) engine settings panel alongside runtime autonomy/tier controls.

This story does three things: (1) runs the definition workshop and records its outcome, (2) turns the
coefficients into exercise-scoped, versioned, build-time config read through the existing single
source, and (3) gives evaluators/admins a read surface that explains what each coefficient does,
sourced from the rationale already written in `audience.ts`.

## Acceptance Criteria
- [ ] Given the reach-model definition workshop runs, when its outcome is recorded, then each
      coefficient's ratified (or replaced) value is documented **alongside its rationale**, not the
      value alone — mirroring the level of detail already in `audience.ts`'s module header, so a
      future reader can tell why a number is what it is, not just what it is.
- [ ] Given a ratified reach model, when it is loaded for an exercise, then it is **exercise-scoped and
      fixed at build/config time** — no control surface (including the `autonomy-safety/06` engine
      settings panel) allows a coefficient to change while the exercise is running, per the
      `autonomy-safety/05` precedent (runtime policy vs. governed model config are different
      categories).
- [ ] Given a coefficient set is changed (workshop revision, tuning pass, or a future addition per
      `audience.ts`'s "add the term HERE" instruction), when the change ships, then it produces a
      **new `modelVersion`** rather than silently overwriting the existing one — extending the
      `AUDIENCE_REACH_MODEL.modelVersion` field already exported for this purpose.
- [ ] Given the AAR export (`aar-export/01`), when it bundles a reach/traction figure, then the
      artifact is stamped with the `modelVersion` that produced it, so a reach number always travels
      with the model that computed it and two exercises run under different coefficient sets are
      never silently compared as if they were the same measurement.
- [ ] Given the admin/read surface for the reach model, when a controller or evaluator views it, then
      each coefficient is presented with a **plain-language description of what it does and its
      evaluation impact** (e.g. "baseExposureRate: the share of an audience that organically sees a
      post — raising it inflates every reach number exercise-wide") — sourced from the rationale
      already authored in `audience.ts`'s JSDoc; this is a surfacing job over existing prose, not new
      authoring.
- [ ] Given the existing consumers of the model (E8's `ADP-004` amplification velocity, E10's
      `EVL-012` reach & traction panel), when they compute a reach or velocity figure, then both read
      the versioned model through the same single `audienceReach()`/`AUDIENCE_REACH_MODEL` source —
      neither hardcodes a coefficient of its own, preserving the "one model, cannot drift apart"
      guarantee the module header states.

## Out of Scope
The reach & sentiment metric UI itself (`evaluation-metrics/03` — this story only versions and
documents the model it reads); the E8 amplification behavior consuming velocity (`ADP-004` — this
story does not touch amplification simulation, only the coefficients it draws on); runtime engine
settings (`autonomy-safety/05`/`06` — autonomy default and tier-policy mode stay runtime-settable;
reach-model coefficients deliberately do not join that surface); building a new formula shape (the
workshop may retune coefficients, but changing the model's structure — new terms, a different curve —
is a separate follow-on per `audience.ts`'s "add the term HERE" note, not this story).

## Technical Notes
Staff world (the admin/read surface is a controller/evaluator-facing config view; COBRA styling,
`@/theme/styledComponents`). Single source of truth: `src/frontend/src/features/social/services/
audience.ts` — `AUDIENCE_REACH_MODEL` (the coefficient set + `modelVersion`), `audienceReach()` (the
computation), `AudienceReachInput`/`AudienceReachResult`. This story does not fork that module; it
(a) governs how its coefficients are ratified/versioned/loaded per exercise, and (b) builds a thin
read/admin surface over its existing JSDoc rationale. Coordinate the AAR-stamping AC with
`aar-export/01`'s `useAarExport.ts` bundling job so the exported metrics artifact carries
`modelVersion` alongside every reach figure it packages. No backend contract exists yet for
"exercise-scoped model config" — until one does, the versioned model is build-time/config-file bound
(mirroring `autonomy-safety/05`'s governed-`appsettings` pattern for tier/model resolution), not a
per-exercise database row. See `implementation.md`.

## Dependencies
`profiles-social-graph/05` (#113 — `audience.ts`, `audienceReach()`, `AUDIENCE_REACH_MODEL`, already
shipped); `evaluation-metrics/03` (the reach & traction panel this model feeds); `aar-export/01` (the
export artifact this story's AC stamps with `modelVersion`); the `autonomy-safety/05` governance
precedent (runtime policy vs. governed model config) this story's boundary follows.

## Tests
- Manual/process check: definition-workshop outcome recorded with rationale (not code — a documentation
  deliverable; verify the record exists and cites a rationale per coefficient).
- Unit: a coefficient change bumps `modelVersion`; the previous version's stamped figures remain
  distinguishable from the new one.
- Integration: an AAR export contains `modelVersion` alongside every reach/traction figure it bundles.
- Component (RTL): the admin/read surface renders each coefficient's plain-language description and
  never exposes an edit control that would mutate it during a running exercise.
- Static check: no hardcoded reach coefficient exists outside `audience.ts` in E8/E10 consumer code.
