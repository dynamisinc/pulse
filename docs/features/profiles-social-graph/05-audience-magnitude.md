# Story: Audience magnitude & follower affordance

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-054  ·  **Design decisions:** D1-012  ·  **Issue:** #113

## Context
Every account has an **audience magnitude** (from the E1 template band, evolving with activity)
distinct from the real follow graph. Displayed follower **count** = audience magnitude + real edges.
Follower **lists** render real edges plus a "…and ~48.2K others" affordance — **never a fabricated
scrollable list** (SOC-054, D1-012). Reach/impressions (E10 EVL-012) and amplification velocity (E8
ADP-004) are defined as functions of magnitude — the formula lives here and is shared.

## Acceptance Criteria
- [x] A profile's displayed follower **count** = audience magnitude (magnitude-formatted, e.g. "48.2K")
      + real edges. — **unit layer only.** `displayedFollowerCount()` +
      `formatMagnitude()` in `services/audience.ts`; covered by
      `services/audience.test.ts:38-62` (the sum, disjoint populations, the optional-edge case) and
      `:64-107` (the "48.2K" form and its boundaries). The *profile* rendering of that count is
      deferred — see below.
- [x] Expanding Followers lists the **real edges**, then an italic **"…and ~48.2K others"** — never a
      fabricated scrollable list (D1-012). — `components/FollowerList.tsx`; covered by
      `components/FollowerList.test.tsx:57-88` (edges then the affordance, in document order) and
      `:90-142` (the hard rule: row count === `edges.length` from magnitude 0 → 1.5M; no list at all
      when there are zero real edges). The *expand* interaction is deferred — see below.
- [x] Audience magnitude is defined (band from E1 COR-020/SOC-054, evolving with activity) and this
      story owns the **reach/velocity formula** consumed by E8 (ADP-004) and E10 (EVL-012). —
      `audienceReach()` + the frozen `AUDIENCE_REACH_MODEL` (stamped `modelVersion: 'v0'`, #371) in
      `services/audience.ts`; covered by `services/audience.test.ts:109-200` (reach over the model,
      sub-linear amplification, fail-closed inputs), `:202-237` (velocity scales with magnitude and
      intensity; velocity is provably the initial slope of the accrual curve), `:239-293`
      (scenario-time accrual, COR-053) and `:295-362` (frozen contract, model version, totality).
      Magnitude itself is the E1 band-derived `Persona.followerCount` (`personas/seedCast.ts`);
      "evolving with activity" is an E8 concern that consumes this module, not a change to it.
- [ ] Counts are exercise-scoped (COR-001). — **deferred to the integration pass** (see below); the
      unit layer has nothing to scope, since neither module queries.

## Deferred to the integration pass
The unit layer is built, reviewed (Gate 1 clean) and green, but **this story is not Complete**: it
owns two components that nothing mounts yet. `Profile.tsx` and `SocialChannel.tsx` are
orchestrator-owned, so the following land in the integration pass, not here:

- **(a) Profile wiring.** `Profile.tsx` still renders the raw `persona.followerCount`
  (`toLocaleString`) rather than `formatMagnitude(displayedFollowerCount(magnitude, edges))`, and
  there is no Followers **expand** entry point mounting `<FollowerList>`. Until that lands, AC1 and
  AC2 are satisfied at the unit layer only — no participant sees either.
- **(b) The AC4 exercise-scope test.** Vacuous today: `audience.ts` fetches nothing and
  `<FollowerList>` renders the edges it is handed. `FollowerEdge` deliberately carries `exerciseId`
  so the assertion ("every rendered edge belongs to the active exercise") is *expressible* the
  moment the Followers view is wired to a real read (COR-001/XC-001).
- **(c) WR-005 — telemetry on expand (XC-004).** When the integration pass mounts `<FollowerList>`
  behind a toggle, that toggle **MUST** emit an XC-004 event on expand; otherwise "the participant
  went looking at who follows this account" is invisible in the AAR — a real evaluator signal about
  how a participant assessed a source's credibility. `<FollowerList>` stays **presentational**: the
  emit belongs at the toggle that owns the interaction, not inside a component that only renders
  rows it was handed.

## Out of Scope
The E10 reach metric UI (E10); E8 amplification behavior (E8 ADP-004); the follow action (story 02).

## Technical Notes
Participant world display + a shared magnitude/reach formula module (the single source E8/E10 import).
See implementation.md (story 05).

**The formula contract (frozen for E8/E10).** SOC-054 fixes the shape ("reach and velocity are
functions of audience magnitude") but the epics park the coefficients for a definition workshop
(#371). `services/audience.ts` therefore states a defensible default rather than leaving two epics
to guess, with every coefficient exported frozen in `AUDIENCE_REACH_MODEL` and its rationale in the
JSDoc: `baseExposureRate 0.12` (reach is a fraction of the audience, never "everyone saw it"),
`intensityLift 1.0` (full intensity at most doubles attention — the dial cannot manufacture
unbounded reach), `amplificationExponent 0.75` (audiences overlap, so N reposts ≠ N× fresh eyes),
`spreadTimeConstantMinutes 45` in **scenario** minutes with τ = 45 / intensityFactor (a hot storyline
spreads faster as well as further), and velocity defined as the initial slope of that same curve so
rate and total cannot drift apart. `modelVersion` (`'v0'`) is stamped so #371's retune is never
silently compared against figures computed under these numbers.

**Fail-closed by contract.** Optional inputs distinguish OMITTED (documented default) from BROKEN
(negative/NaN/Infinite → clamped to the conservative end): a broken `elapsedScenarioMinutes` accrues
nothing rather than reporting peak reach to an evaluator, and a broken `meanAmplifierMagnitude`
contributes zero rather than substituting a plausible peer default. Every returned field is finite
and non-negative.

## Dependencies
E1 audience-magnitude band (COR-020); story 02 (real edges). Shared by E8 (ADP-004) + E10 (EVL-012).

## Tests
- Unit: count = magnitude + edges; reach/velocity formula; follower list shows edges + "…and ~N
  others", never fabricated rows.

**Delivered (52 tests, all green):**
- `src/frontend/src/features/social/services/audience.test.ts` — 36 tests: the count sum, the
  magnitude-format boundaries, the reach/velocity formula at its boundaries, scenario-time accrual,
  the fail-closed input semantics, output totality, and the frozen model/version contract.
- `src/frontend/src/features/social/components/FollowerList.test.tsx` — 16 tests: real edges + the
  affordance, the never-fabricate rule at four magnitudes, honest empty states, and the a11y
  contract (labelled region, real list, the affordance announced and kept OUT of the list so the
  item count never lies).
- **Not yet covered (integration pass):** the profile-rendered count, the Followers expand
  interaction, the AC4 exercise-scope assertion, and WR-005's XC-004 emit on expand.
