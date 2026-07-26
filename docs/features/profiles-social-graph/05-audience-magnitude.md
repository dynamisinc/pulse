# Story: Audience magnitude & follower affordance

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete except
AC4 — the exercise-scope assertion has no test yet; see AC4 and "AC4 status" below.
**Requirements:** SOC-054  ·  **Design decisions:** D1-012  ·  **Issue:** #113

## Context
Every account has an **audience magnitude** (from the E1 template band, evolving with activity)
distinct from the real follow graph. Displayed follower **count** = audience magnitude + real edges.
Follower **lists** render real edges plus a "…and ~48.2K others" affordance — **never a fabricated
scrollable list** (SOC-054, D1-012). Reach/impressions (E10 EVL-012) and amplification velocity (E8
ADP-004) are defined as functions of magnitude — the formula lives here and is shared.

## Acceptance Criteria
- [x] A profile's displayed follower **count** = audience magnitude (magnitude-formatted, e.g. "48.2K")
      + real edges. *(Unit layer: `displayedFollowerCount()` + `formatMagnitude()` in
      `services/audience.ts`; covered by `services/audience.test.ts:38-62` (the sum, disjoint
      populations, the optional-edge case) and `:64-107` (the "48.2K" form and its boundaries).
      **Now also wired and rendered:** `pages/Profile.tsx` renders
      `formatMagnitude(persona.followerCount)` in the header (`persona.followerCount` is the
      **server-composed** count — magnitude + real inbound edges — per backend story 07/#370, so no
      separate frontend composition is needed at this call site). Covered by
      `pages/Profile.test.tsx:97-119` ("renders banner, avatar, name, handle, bio and follower
      counts" — asserts the rendered text equals `formatMagnitude(persona.followerCount)`, not the
      raw integer).)*
- [x] Expanding Followers lists the **real edges**, then an italic **"…and ~48.2K others"** — never a
      fabricated scrollable list (D1-012). *(Unit layer: `components/FollowerList.tsx`; covered by
      `components/FollowerList.test.tsx:57-88` (edges then the affordance, in document order) and
      `:90-142` (the hard rule: row count === `edges.length` from magnitude 0 → 1.5M; no list at all
      when there are zero real edges). **Now also wired:** `Profile.tsx`'s Followers control (a
      `<button>` around the follower count, `aria-expanded`) toggles a collapsed/expanded
      `<FollowerList>`, resolving real edges via `resolveFollowers(personaId)` and passing
      `magnitude={persona.audienceMagnitude ?? 0}`. Covered by
      `pages/Profile.test.tsx:122-151` ("Profile — Followers expand (story 05, D1-012 + XC-004)" —
      collapsed by default, expands on click, `aria-expanded` toggles).)*
- [x] Audience magnitude is defined (band from E1 COR-020/SOC-054, evolving with activity) and this
      story owns the **reach/velocity formula** consumed by E8 (ADP-004) and E10 (EVL-012). —
      `audienceReach()` + the frozen `AUDIENCE_REACH_MODEL` (stamped `modelVersion: 'v0'`, #371) in
      `services/audience.ts`; covered by `services/audience.test.ts:109-200` (reach over the model,
      sub-linear amplification, fail-closed inputs), `:202-237` (velocity scales with magnitude and
      intensity; velocity is provably the initial slope of the accrual curve), `:239-293`
      (scenario-time accrual, COR-053) and `:295-362` (frozen contract, model version, totality).
      Magnitude itself is the E1 band-derived **`Persona.audienceMagnitude`** — backend-persisted
      (story 06/#369) in live mode, and composed the same way by the mock adapter, so the two modes
      agree; "evolving with activity" is an E8 concern that consumes this module, not a change to it.
      *(WR-004 correction, Gate 2: this line — and `services/audience.ts`'s own header/JSDoc — used to
      name `Persona.followerCount` as the magnitude. That was true before backend story 07 and is now
      FALSE: the server composes `followerCount = audienceMagnitude + inbound follow edges`, so an E8
      or E10 consumer passing `followerCount` as `magnitude` alongside a `followEdges` term computes
      `magnitude + edges + edges`. `audience.ts` is the designated cross-epic source of the formula,
      so it now states this explicitly with a ✅/❌ pair.)*
- [ ] Counts are exercise-scoped (COR-001). **UNTICKED — no test covers this yet.** `Profile.tsx`
      resolves follower ids against the already exercise-scoped `usePersonas()` cast, so it is
      structurally scoped, but no test feeds it a foreign-exercise id and asserts it is dropped.
      Do not tick this box until that test exists.

## AC4 status (exercise-scope) — genuinely open, not a formality
`Profile.tsx`'s `followerEdges` (the list `<FollowerList>` renders) is computed by resolving
`resolveFollowers(personaId)`'s returned ids against `usePersonas()`'s already exercise-scoped cast —
`personas.find(p => p.id === id)`, dropping any id the cast doesn't contain. **Structurally**, this
means a foreign-exercise id could never render (the cast it's matched against has none), but **no test
actually exercises that** — `pages/Profile.test.tsx` never feeds `resolveFollowers` a foreign-exercise
id and asserts it is dropped. Backend-side, story 07's `FollowGraphIsolationTests` (extending
`exercise-isolation/07`) do cover this at the API layer (a cross-exercise follow edge is rejected and
never appears in either exercise's follow graph) — but that is the backend's own AC6, not a test of
*this* frontend composition. **What would close this AC:** a `Profile.test.tsx` case that stubs
`resolveFollowers` to return an id absent from the exercise-scoped `personas` fixture and asserts it
is silently dropped from the rendered `<FollowerList>` (never rendered as a placeholder row). Leaving
this unticked until that test exists, per this story's own review discipline (WR-005's precedent
below — do not claim a behavior closed before there is a test pinning it).

## Deferred (small residuals, not integration gaps — the integration pass itself has landed)
- **WR-005 — telemetry on expand (XC-004) — RESOLVED.** `Profile.tsx`'s `toggleFollowers` emits
  exactly one XC-004 `view` event on OPEN (never on collapse), target `` `${persona.id}:followers` ``.
  Covered by `pages/Profile.test.tsx:122-151` (asserts the event count increments by exactly 1 on
  expand and does not increment again on collapse). `<FollowerList>` itself stays presentational, as
  designed — the emit lives at the toggle, not the component.
- **AC4 (exercise-scope test)** — see above; the one remaining open item in this story.

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

**Delivered (59 tests, all green):**
- `src/frontend/src/features/social/services/audience.test.ts` — 44 tests: the count sum, the
  magnitude-format boundaries (incl. the `T` unit and the bounded `"9007.1T"` ceiling), the spoken
  AT form, the reach/velocity formula at its boundaries, scenario-time accrual, the fail-closed
  input semantics, output totality, and the frozen model/version contract.
- `src/frontend/src/features/social/components/FollowerList.test.tsx` — 15 tests: real edges + the
  affordance, the never-fabricate rule at four magnitudes, honest empty states, and the a11y
  contract (labelled region, real list, the affordance announced, kept OUT of the list so the item
  count never lies, and its accessible name spelling out the approximation).
- `src/frontend/src/features/social/pages/Profile.test.tsx` — the profile-rendered magnitude-formatted
  count (`:97-119`), the Followers expand interaction + its exactly-once XC-004 emit on open,
  none-on-collapse (`:122-151`).
- **Not yet covered (still open):** the AC4 exercise-scope assertion — see "AC4 status" above for
  exactly what test would close it.
