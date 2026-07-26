# Story: "Who to follow" suggestions (backend)

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-053, SOC-052, COR-001, XC-002  ·  **Design decisions:** D1-R1, D1-008  ·  **Issue:** #88 (Gate-2 finding CR-001)
**Stack:** backend

## Context
Story 04 shipped `<WhoToFollow>` and the final integration pass mounted it on the participant feed
(capped to three rows). Its read seam calls **`GET /api/personas/suggestions`, which did not exist
anywhere in `Pulse.WebApi`** (verified by grep before this build). Under `VITE_USE_MOCK_DATA=true`
(UAT's own setting) a mock adapter renders three believable rows; against the live backend the call
404s, `useWhoToFollow` fails closed, and **every participant sees a permanent "Suggestions aren't
available right now." panel above their feed on every load**. That is the same failure class already
recorded twice in this repo — a unit-green seam that does nothing live (the pause / dial / live-AI
controller features), and a slice merged with its composition-root wiring never executed (#310→#317).
This story makes story 04 real rather than mock-only.

## Acceptance Criteria
- [x] **`GET /api/personas/suggestions`** serves the exercise-scoped suggestion order for the caller's
      session persona.
- [x] **Planner-seeded ordering — no invented ranking.** Deterministic and stable; no relevance score,
      popularity weight, or "recommended for you" heuristic. The docs define no formula (SOC-053 says
      planner-seeded, live-adjustable by controllers via E7 CTL-021), and a score a later pass would
      have to strip out is worse than none.
- [x] **Excludes the caller's own persona and everyone they already follow — SERVER-side.** The
      frontend filtered both client-side; serving rows it will never render is wasteful, and the
      already-followed filter racing the client's own follow write can re-suggest an account the
      participant just followed.
- [x] **An impersonator / unverified lookalike MUST be eligible.** No filter or sort on `Verified` —
      steering attention onto a lookalike is a legitimate controller lever and the module never
      vouches for anyone (D1-R1/D1-008).
- [x] **`Castable` is NOT a filter here.** It gates whether the ENGINE may voice a persona; it says
      nothing about whether a human may follow one. Both seeded SOC-052 accounts ship
      `Castable = false`, so reusing it as an eligibility filter would silently delete the impersonator
      from the module and defeat the training (SOC-052). Called out in a comment at the query itself —
      this is the trap the next reader will fall into.
- [x] **Exercise-scoped (COR-001)** via `IExerciseContext` + the central query filter; no
      client-suppliable `exerciseId` on any path, body, or query string.
- [x] **XC-002 / SOC-052 wire shape.** Ids only. No `personaType`, no `castable`, no `verified`, no
      archetype-derived value — story 06 closed that machine-readable impersonator tell on the
      participant wire and this story does not reopen it.
- [x] **`limit` supported** (the mount uses `limit={3}`).
- [x] **Fails closed** — unresolved scope `401`, no session persona `403`; never an unscoped or
      default set behind a `200`.
- [x] **Composition-root wiring verified through the real `WebApplicationFactory<Program>`** — route
      mapped exactly once AND its services resolve.

## Out of Scope
The `<WhoToFollow>` module UI and `useWhoToFollow` (story 04 — already built; **no frontend file is
touched by this story**). The E7 CTL-021 write path that lets a controller add/remove/reorder
suggestions live (`world-steering/01`, Not Started) — this story only reads. The portal placement
(E3, Phase 3). Follow mechanics themselves (story 07). Flipping `VITE_USE_MOCK_DATA` off (orchestrator-owned).

## Technical Notes

**No migration. No schema change.** The endpoint reads existing `Persona` and `Follow` rows only. A
`SuggestionOrder` column would be the natural home for CTL-021's planner-seeded order, but nothing
writes it yet, so adding one would be an un-specced column with no writer — and this is not a
seam-freeze wave.

### As built

1. **Response shape — a BARE JSON array of id strings**, `["<guid>", ...]`, *not* the
   `{ personaId, personaIds, count }` envelope the sibling follow reads use. This is the frozen client
   contract, not a style choice: `resolveSuggestedFollowIds` (`whoToFollowService.ts`) type-guards the
   body with `isStringArray` and **throws** on anything else, so an envelope would fail closed into
   the exact error panel this story removes. Ids-only also keeps the XC-002/SOC-052 promise
   *structurally* — there is no field on this wire that could carry an archetype tell — and the caller
   resolves each id against `GET /api/personas`, whose per-world split (story 06) is therefore not
   duplicated or drifted from. (`followService.ts` records the inverse mistake being caught: a bare
   array typed against an envelope endpoint.)
2. **Order = `Persona.Handle` ascending.** Deterministic, stable, and a **total** order with no
   tiebreak needed, because handle is unique per exercise (`IX_Personas_ExerciseId_Handle`, CI
   collation). It carries no credibility, archetype, or recency signal. When CTL-021 lands a persisted
   planner order, exactly one `OrderBy` changes and nothing else does.
   **Why NOT `JoinedAt`:** seeded join instants are archetype-derived — `PersonaCastSeeder.DeriveJoinedAt`
   backdates a `bad-actor` persona 3-6 days and everyone else 90-730 — so ordering on it would park the
   SOC-052 lookalike at a predictable end of every list. That is a *positional* machine-readable tell,
   the same class of leak story 06 closed by dropping `personaType` from the participant wire.
3. **The already-followed exclusion reuses `FollowService.GetFollowingAsync`** (story 07 built that read
   as "the set 04-who-to-follow needs"), rather than a second parallel edge query.
4. **`limit` is an optional query parameter** (`?limit=3`), validated: a value below 1, or a
   non-integer, is a `400` — never silently ignored, which would serve *more* rows than the caller
   asked for and hide the typo. **Note for the orchestrator:** the frozen client does **not** send it
   today (`<WhoToFollow limit={3}>` is a display cap applied client-side after resolution, and
   `resolveSuggestedFollowIds()` takes no argument). The server-side cap is therefore available and
   tested but currently unused; wiring it is a one-line frontend change nobody needs to make urgently.
5. **`Guid.ToString()` runs in C#, never in the LINQ projection.** SQL Server renders a
   `uniqueidentifier` in UPPERCASE, so translating the conversion into the query would return ids that
   no longer string-match the lowercase ids `GET /api/personas` emits — `useWhoToFollow` would silently
   skip every unresolvable row and render an empty module while every call returned `200`.
   `SuggestedIds_MatchThePersonaReadsIdsExactly_SoTheClientCanResolveEveryRow` pins it.
6. **Composition root — no `Program.cs` edit.** `/api/personas/suggestions` is a literal segment on the
   persona resource, so `SuggestionEndpoints.AddSocialSuggestions()`/`MapSocialSuggestionEndpoints()`
   are composed into the already-wired `PersonaEndpoints.AddSocialPersonaRead()`/
   `MapSocialPersonaEndpoints()` — the same composition `FollowEndpoints` uses. Registration is
   `TryAdd`-based. Proven executing on the real host (AC10).
7. **No telemetry.** This is a read; XC-004 emits one event per *mutation*. Nothing here mutates.
8. **Read-only/observer sessions ARE served** (D1-011): the module still renders for an observer, only
   its Follow controls are absent, and that gate lives on the write path
   (`useFollow`/`ReadOnlySessionWriteFilter`). The route is deliberately not mapped through
   `DenyReadOnlySessions()`.

### Id-shape finding (the reviewer's open question) — no frontend change needed
Live persona ids are GUIDs; the mock's `MOCK_SUGGESTED_FOLLOW_IDS` are `persona-<handle>` strings. The
two **cannot disagree at runtime**, because both the suggestion seam and the persona seam flip on the
**same** `USE_MOCK_DATA` constant (`@/core/config/mockData`): mock mode resolves `persona-<handle>` ids
against the `persona-<handle>` mock cast, live mode resolves GUIDs against the GUID persona read. The
only way to mix them would be to mock one seam and not the other, which no code path does. Verified
end-to-end by the id-shape test above (a live suggestion set is a strict subset of the live
`GET /api/personas` id set, lowercase for lowercase).

### Open decision for the orchestrator (flagged, not silently resolved)
A caller with **no session-bound persona** gets `403`, per this story's AC. That is right for a
scope/identity guarantee, but it has a product consequence worth a deliberate call: the *frontend*
renders the module for a no-persona session (`WhoToFollow.noPersona.test.tsx` asserts rows still
appear, with the Follow control absent), so in live mode such a session will see the "Suggestions
aren't available right now." panel. Who is affected: **only** sessions with no `PersonaId` — a
participant not yet bound to a persona, and staff sessions. Read-only/observer participant sessions
**do** carry a persona binding and are unaffected. If the platform later wants an unbound viewer to
see the un-personalized list, the change is one branch in `SuggestionService` (serve the in-scope
order with no viewer exclusions) plus its test — it is not a redesign.

## Dependencies
`social-api/04` (`GET /api/personas` — the read the client resolves these ids against); story 07
(`FollowService.GetFollowingAsync`, the exclusion set; `FollowEndpoints`' composition pattern);
`identity-auth-roles/03`/`05`/`10` (the session persona binding the viewer resolves from); story 06
(the per-world persona projection this wire deliberately does not duplicate). Unblocks: story 04 going
live (Gate-2 CR-001), and E7 CTL-021, which will replace this story's `OrderBy` with a persisted order.

## Tests
xUnit, `src/Pulse.WebApi.Tests/Features/Social/Suggestions/`. Tests marked **[docker]** are
`[RequiresDockerFact]` (real SQL Server: Testcontainers in CI, or `PULSE_TEST_SQL_CONNECTION` locally);
the wiring test is a plain `[Fact]` and runs everywhere. Every **[docker]** test drives the REAL
`Program` host through real host→exercise resolution and real session authentication — nothing stubs
the scope or the viewer's persona.

**Deterministic order (AC2)**
- `SuggestionEndpointTests.Suggestions_AreReturnedInAStableDeterministicOrder_AcrossRepeatedReads` [docker]

**Server-side exclusions (AC3)**
- `SuggestionEndpointTests.Suggestions_NeverIncludeTheCallersOwnPersona` [docker] — the viewer's handle
  sorts in the MIDDLE of the seeded cast, so its absence cannot be an ordering/cap artifact
- `SuggestionEndpointTests.Suggestions_ExcludeAlreadyFollowedAccounts_ServerSide` [docker] — follows
  through the real `POST /api/personas/{id}/follow` first

**The lookalike is eligible (AC4, AC5)**
- `SuggestionEndpointTests.AnUnverifiedLookalike_CanAppearInTheSuggestions_TheModuleNeverVouchesForAnyone` [docker]
  — appears AND holds its natural position (not sorted down)
- `SuggestionEndpointTests.ANonCastablePersona_IsNotExcluded_CastableGatesTheEngineNotAHumanFollow` [docker]
  — positively asserts the row really is `Castable = false` first, so the test cannot false-pass

**Wire shape — XC-002 / SOC-052 (AC7)**
- `SuggestionEndpointTests.Response_IsABareArrayOfIdStrings_WithNoPersonaTypeCastableOrArchetypeTell` [docker]
- `SuggestionEndpointTests.SuggestedIds_MatchThePersonaReadsIdsExactly_SoTheClientCanResolveEveryRow` [docker]
  — the id-shape/collation guard (see As-built 5)

**`limit` (AC8)**
- `SuggestionEndpointTests.Limit_CapsTheResponse_ToThePrefixOfTheSameOrder` [docker]
- `SuggestionEndpointTests.Limit_LargerThanTheCast_ReturnsTheWholeEligibleSet_NotAnError` [docker]
- `SuggestionEndpointTests.Limit_ThatIsNotAPositiveInteger_Is400_NeverSilentlyIgnored` [docker]

**Cross-exercise isolation (AC6, always-Critical)**
- `SuggestionEndpointTests.Suggestions_NeverContainAnotherExercisesPersona_AndTheRowsProvablyExist` [docker]
  — asserts exercise B's cast exists via `IgnoreQueryFilters` first, then that none of its ids appear in
  A's body and that the response LENGTH does not leak B's cast size
- `SuggestionEndpointTests.ASessionFromAnotherExercise_IsRefused_RatherThanServedThisExercisesCast` [docker]

**Fail-closed (AC9)**
- `SuggestionEndpointTests.UnresolvedScope_Returns401_NotAnEmptyOk` [docker]
- `SuggestionEndpointTests.NoSessionPersona_Returns403_RatherThanADefaultOrUnscopedSet` [docker] — also
  asserts the refusal body carries no cast data

**Composition-root wiring (AC10, regression class)**
- `Features/Social/CompositionRootWiringTests.ProgramCs_MapsTheSuggestionsRouteExactlyOnce_AndResolvesItsServices`
  — plain `[Fact]`, boots the real `WebApplicationFactory<Program>`, asserts the route is mapped exactly
  once AND that `SuggestionService` resolves from the real composition root
