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
- [x] **`limit` supported** (the mount uses `limit={3}`), and threaded from the client so the wire
      carries only the rows that will be rendered — **all three hops, reaching production**:
      `<WhoToFollow limit={3}>` → `useWhoToFollow(limit)` → `?limit=3`. See As-built 4.
- [x] **Fails closed on the boundary that is one** — unresolved exercise scope `401`; a session bound
      to *another* exercise `403`. A caller with **no** persona binding is **served** the
      un-personalized in-scope list (`200`), not refused — resolved by the coordinator, reasoning
      recorded below.
- [x] **Composition-root wiring verified through the real `WebApplicationFactory<Program>`** — route
      mapped exactly once AND its services resolve.

## Out of Scope
The `<WhoToFollow>` module UI (story 04 — already built; the only frontend files this story touches are
`services/whoToFollowService.ts`, `hooks/useWhoToFollow.ts` and the one-line `limit` hand-off in
`components/WhoToFollow.tsx`, for the `limit` thread, plus their tests). The E7 CTL-021 write path that lets a controller add/remove/reorder
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
   asked for and hide the typo. A capped response is a strict **prefix** of the uncapped one.

   **Client threading — ALL THREE HOPS DONE; the cap is reached in production.**
   `resolveSuggestedFollowIds(limit?)` puts `?limit=N` on the wire, `useWhoToFollow(limit?)` forwards
   it, and `WhoToFollow.tsx` passes its `limit` prop straight into the hook — so the mounted
   `<WhoToFollow limit={3}>` in `SocialChannel` really does send `?limit=3` and the whole cast is no
   longer fetched to render three rows. (An earlier revision of this file recorded the third hop as
   outstanding, with the parameter "unused in production and the fetch still uncapped". That was true
   when written and is **no longer true**; the one-line change landed in `WhoToFollow.tsx`, which keeps
   its own display slice as a belt-and-braces bound on what it renders.) The **mock adapter honours the
   same parameter** — it parses `?limit=` back out of the URL the live path sends, so a `?limit=` vs
   `?count=` mismatch fails in mock too; mock/live divergence is this feature's most productive defect
   class.

   **The exclusion/cap ORDER is part of the contract (WR-001).** The server excludes self +
   already-followed and only then `Take(limit)`, so a capped read always carries `limit` renderable
   rows. The mock adapter originally capped FIRST and left both exclusions to `useWhoToFollow`, which
   re-applies them after the fetch — so the moment a participant followed one of the first three
   suggestions and the module remounted, mock rendered two rows, then one, then none, while live
   rendered three throughout. The adapter is now viewer-aware (it reads the shared `followEdgeStore`
   the follow mock already writes) and excludes before it slices. Pinned by
   `whoToFollowService.test.ts`'s WR-001 block and `useWhoToFollow.mockParity.test.ts`.

   One residual behavioural note, unchanged: the hook skips ids `usePersonas()` cannot resolve, so a
   server-side cap of 3 would render fewer than 3 rows if one of the three were unresolvable, where an
   uncapped fetch would backfill. In practice the suggestion set is a strict subset of the persona-read
   id set from the same exercise-scoped cast (As-built 5 pins the id shape), so an unresolvable id
   would itself be a bug rather than a case to design around.
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

### The unbound viewer — RESOLVED (coordinator decision, folded in the second commit)
The first build refused a caller with **no session-bound persona** (`403`). That is now a **`200`
carrying the un-personalized in-scope list**, and the reasoning is worth keeping because the two cases
look alike and are not:

- **What was wrong with the refusal.** `SocialChannel` mounts only on the participant shell, so staff
  never reach this module — but a **participant not yet bound to a persona does**, and refusing handed
  exactly that population the permanent "Suggestions aren't available right now." panel *this story
  exists to remove*. It was CR-001 again, merely narrowed to a smaller group.
- **What is actually protected here.** The exercise scope, and only the exercise scope. It still comes
  from `IExerciseContext` + the central query filter and is **unchanged** — an unbound caller is
  scoped exactly as a bound one is (pinned by
  `UnboundViewer_IsStillExerciseScoped_NeverAnotherExercisesCast`). What lapses is the two
  *viewer-relative* exclusions, which cannot apply because there is no viewer to exclude against.
  Nothing is exposed that `GET /api/personas` does not already serve the same caller.
- **The frontend already encoded this contract.** `WhoToFollow.noPersona.test.tsx` asserts the module
  renders its rows for a no-persona session (with the Follow control absent, D1-011). The `403` made
  live disagree with a contract the client had already frozen.
- **Still refused, and deliberately distinct:** a session bound to a **different** exercise than the
  request resolved to (`SuggestionOutcome.ForeignSessionPersona` → `403`). An identity that belongs
  somewhere else is not the same as no identity, and the enum member is named so the next reader
  cannot collapse them. The `401` on an unresolved exercise scope is untouched — that one *is* a
  fail-closed boundary.

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

Frontend (vitest), for the client half of the same AC:
- `whoToFollowService.test.ts` — "caps the shipped mock path to a strict PREFIX of the uncapped order",
  "honours the cap in MOCK mode too, so mock and live cannot disagree", "returns the whole eligible set
  when no cap is given", plus the **WR-001** block: "still returns `limit` ids after the viewer follows
  one of the first suggestions", "holds for every one of the first `limit` suggestions in turn, never
  draining the module", "drops a followed account from the UNCAPPED read too, without reordering the
  rest", "restores the suggestion once the viewer unfollows it"
- `whoToFollowService.live.test.ts` — the LIVE branch (`USE_MOCK_DATA = false`): "puts the cap on the
  wire as ?limit=N — the key the server reads", "GETs /personas/suggestions with NO axios config —
  never the mock adapter", "sends no query string at all when no cap is given". The mock-mode file's
  own "wire contract" block cannot cover this: it runs with `USE_MOCK_DATA` true, so its
  `expect.anything()` config matcher was asserting the mock call shape.
- `useWhoToFollow.test.ts` — "passes `limit` through to the read, so the SERVER caps the wire", "sends
  no cap when none is given — the whole eligible set, exactly as before", "re-reads when the cap changes"
- `useWhoToFollow.mockParity.test.ts` — against the SHIPPED seams: a capped read still yields `limit`
  rows after the viewer follows the top suggestion and the module remounts (the third hop, end to end)

**Cross-exercise isolation (AC6, always-Critical)**
- `SuggestionEndpointTests.Suggestions_NeverContainAnotherExercisesPersona_AndTheRowsProvablyExist` [docker]
  — asserts exercise B's cast exists via `IgnoreQueryFilters` first, then that none of its ids appear in
  A's body and that the response LENGTH does not leak B's cast size
- `SuggestionEndpointTests.ASessionFromAnotherExercise_IsRefused_RatherThanServedThisExercisesCast` [docker]

**Fail-closed, and the unbound viewer who is NOT refused (AC9)**
- `SuggestionEndpointTests.UnresolvedScope_Returns401_NotAnEmptyOk` [docker]
- `SuggestionEndpointTests.UnboundViewer_IsServedTheUnpersonalizedList_NotRefused` [docker] — the whole
  in-scope cast, in the same order, with neither viewer-relative exclusion applied
- `SuggestionEndpointTests.UnboundViewer_IsStillExerciseScoped_NeverAnotherExercisesCast` [docker] — the
  half of that path that IS a hard boundary: dropping the viewer exclusions must not drop the scope

**Composition-root wiring (AC10, regression class)**
- `Features/Social/CompositionRootWiringTests.ProgramCs_MapsTheSuggestionsRouteExactlyOnce_AndResolvesItsServices`
  — plain `[Fact]`, boots the real `WebApplicationFactory<Program>`, asserts the route is mapped exactly
  once AND that `SuggestionService` resolves from the real composition root
