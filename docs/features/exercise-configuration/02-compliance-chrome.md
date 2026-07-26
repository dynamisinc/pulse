# Story: Compliance chrome — per-exercise config

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
*(The slice is **built, wired and green** — `Features/ExerciseConfiguration/Chrome/*`,
`ChromeConfigProjection`, the `ComplianceChromeGuard`, `ComplianceChromePanel` and ~1,400 lines of
passing tests, Gate 1 clean. `AddComplianceChromeConfig()` / `MapComplianceChromeEndpoints()` are in
`Program.cs` and `<ComplianceChromePanel />` is mounted in `ExerciseSettingsPage`, all three guarded.
It stays In Progress because the `feature/exercise-configuration` umbrella is **unmerged** — see "Why
this is In Progress, not Complete" below.)*
**Requirements:** COR-031 (XC-003, NFR-008)  ·  **Design decisions:** R-006 (banner presentation deferred to D7); D7 SHELL-CONTRACT §1 / D7-008 (chrome-off is legal)  ·  **Issue:** #68

## Context
Government exercises require classification/exercise markings. Compliance chrome is configurable
top/bottom banners (text, e.g. "UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY"; colors) rendered as
**persistent environment chrome outside the simulated app frame**, consistently on every channel — the
Looking Glass green-bar precedent. It can be disabled per exercise, but **never simultaneously with
in-content watermarks off** (COR-031, XC-003, NFR-008).

> **The chrome itself already ships.** `participant-shell/01` (Complete, #185) delivered
> `features/participant-shell/components/ComplianceChrome.tsx` + the `chromeConfig.ts` config seam:
> two config-driven banners outside the app frame, chrome-off legal, and the NFR-008
> `isWatermarkRequired()` fallback signal. The backend serves the config from
> `GET /api/chrome-config` — but as a **hardcoded constant** in
> `Features/ParticipantShell/ParticipantShellEndpoints.cs`, identical for every exercise, editable by
> nobody.
>
> **This story is therefore scoped to:** make that config **per-exercise, staff-editable and
> persisted**, serve it through the **unchanged frozen `ChromeConfigResponse` shape**, and enforce the
> NFR-008 chrome↔watermark mutual guard **server-side** so it cannot be defeated by a client.

> **Presentation stays frozen (R-006 / D7).** Banner count, placement, classification voice and styling
> are owned by the D7 shell contract (`docs/design/D7-application-shells/SHELL-CONTRACT.md` §1) — do not
> respec them here, and do not restyle the shipped component.

## Acceptance Criteria
- [x] Given a planner with a staff session, when they edit the compliance-chrome config (enabled,
      top/bottom banner text + fg/bg colors) and save, then it persists on that exercise and is
      unchanged for every other exercise.
      *(`ChromeSettingsEndpointsTests` against real SQL, plus the panel's round-trip tests. The staff
      routes are live — `MapComplianceChromeEndpoints()` is in `Program.cs` and pinned by
      `CompositionRootWiringTests.ProgramCs_MapsTheStaffChromeSettingsRoutesExactlyOnce`.)*
- [x] Given a saved chrome config, when a participant calls `GET /api/chrome-config`, then the response
      carries that exercise's values in the **existing frozen `ChromeConfigResponse` shape**
      (`{ enabled, top{text,fg,bg}, bottom{text,fg,bg} }`) — the constant is gone, the DTO is unchanged,
      and `chromeConfig.ts`'s `isChromeConfig` guard and `ComplianceChrome.tsx` need no change.
      *(`ChromeConfigCompositionTests` end to end, incl. the frozen-key-count test; the frontend half is
      `chromeConfigWireContract.test.tsx`, which drives the shipped `useChromeConfig()` through a mocked
      adapter and proves the private guard accepts the per-exercise body. No file in
      `participant-shell` changed.)*
- [x] **NFR-008 guard, server-side:** given an exercise whose in-content watermark is off, when a
      planner attempts to disable compliance chrome (or vice versa), then the write is rejected with a
      400 and an explanatory message — chrome and watermark are never both off, and the rule holds
      regardless of what the client sends.
      *(`ComplianceChromeGuardTests` — the invariant truth table both ways — plus the four `Put_…`
      endpoint cases and the read-side `ChromeConfig_WithAStoredRowThatHasBothMarkingsOff_ServesEnabledTrue_NFR008`.
      The client refusal in `ComplianceChromePanel` is a convenience, not the enforcement.)*
- [x] **Content security (NFR-004):** given banner text is free text rendered on every participant
      channel, when it is saved, then it is length-bounded and sanitized server-side **through the
      shipped `Features/Social/PostSanitizer.cs`**; a stored `<script>` in a banner never executes in a
      participant session. **Strip, never entity-encode** — an `HtmlEncoder` here ships banner text
      reading `UNCLASSIFIED &#47;&#47; EXERCISE` on every participant channel.
      *(`ChromeSettingsDtos.cs` calls `PostSanitizer.Sanitize` at the one write boundary — no second
      sanitizer; pinned end to end by `Put_MarkupInBannerText_IsStrippedNotEncoded_AllTheWayToTheParticipantSurface`.)*
- [x] **The override actually resolves (projection-override contract):** given a fully composed service
      provider wired in the orchestrator's order, when `IChromeConfigProjection` is resolved, then the
      **contributed** implementation comes back — registered via `services.Replace(...)`, **never
      `TryAddScoped`, which against 01b's already-present default is a silent no-op that leaves the
      constant serving** — and `/api/chrome-config` returns per-exercise banners end to end. A test of
      the projection class in isolation does not satisfy this AC.
      *(`ChromeProjectionRegistrationTests` (order-independence + single-descriptor) and
      `ChromeConfigCompositionTests` (end to end, with the "without story 02 wired" negative control).
      Since the wiring landed this is additionally asserted against the **real** `Program.cs` host by
      `CompositionRootWiringTests.ProgramCs_CallsAddComplianceChromeConfig_SoChromeIsPerExerciseAndNotTheConstant`.)*
- [x] **Isolation (XC-001/002, COR-001):** given a chrome-config read, when it is served, then the
      exercise comes from the server-resolved scope (`IExerciseContext`), never a client parameter; a
      cross-exercise chrome read/write returns 403/404.
      *(The two cross-exercise cases both verbs, the 401/403 fail-closed set, and — on the client side —
      `chromeSettingsService.test.ts`'s "requests the staff chrome route and NEVER names an exercise".)*
- [x] Given chrome is enabled, when it renders, then its state is not conveyed by color alone (NFR-001)
      and it remains framing outside the fiction — no change to the shipped component's markup is
      required to satisfy this.
      *(Satisfied as written: this story changed nothing in `ComplianceChrome.tsx`, and the staff-side
      panel signals every state with icon + text and binds the NFR-008 message with `aria-describedby`.
      **Bound honestly:** the participant-render half is `participant-shell/01`'s (Complete, #185); what
      is proven here is that this story's config can never drive that component into a color-only or
      both-markings-off state.)*

### Why this is **In Progress**, not Complete — and what each AC depended on

Two different gates, and only one of them is still shut:

**1. The orchestrator wiring — LANDED.** Every AC above was first proven against a host composed
exactly as the orchestrator would compose it (`ChromeTestHost`), while `Program.cs` — orchestrator-owned,
never edited by this story's builder — still called neither extension. That made ACs 1, 2, 5 and 6 green
in test and **inert at runtime**. The three lines landed in `cc83766` (backend + panel mount) and
`eb49fe5` (the panel-mount guard):

| Wiring line | ACs it activates | Standing guard |
|---|---|---|
| `builder.Services.AddComplianceChromeConfig();` | AC5 (and AC2's per-exercise half — without it 01b's `ConstantChromeConfigProjection` keeps serving one identical banner set to every exercise, silently) | `CompositionRootWiringTests.ProgramCs_CallsAddComplianceChromeConfig_SoChromeIsPerExerciseAndNotTheConstant` |
| `app.MapComplianceChromeEndpoints();` | AC1, AC3, AC4, AC6 (the staff read/write pair is 404 until mapped, so nothing can be persisted or rejected) | `CompositionRootWiringTests.ProgramCs_MapsTheStaffChromeSettingsRoutesExactlyOnce` |
| `<ComplianceChromePanel />` in `ExerciseSettingsPage.tsx` (+ the barrel export) | the planner-visible half of AC1 and AC7 | `ExerciseSettingsPage.test.tsx` → "mounts the compliance-chrome panel (story 02)" and "renders every panel INSIDE the page main landmark, exactly once each" |

This is the failure mode recorded for the bootstrap endpoint (#310 → #317): a slice merges fully green
with its `Add*`/`Map*` never called. It is closed here, and the three tests above turn red if any line is
deleted.

**2. The umbrella merge — OPEN, and the only reason this is not Complete.** The whole feature branch
`feature/exercise-configuration` is unmerged; nothing here is on `main` and nothing is deployed to UAT.
`Complete` is claimed after the umbrella PR lands, by whoever lands it — not before.

## Out of Scope
**Building or restyling the banner component** (`participant-shell/01`, shipped; presentation owned by
D7/R-006); the in-content EXERCISE watermark itself (NFR-008 fast-follow, a participant-content
concern — this story only reads/enforces its on/off state); per-channel skins (channel epics); the
real-world Break-Fiction overlay (E7 CTL-024 — a different, alien mechanism); reshaping
`ChromeConfigResponse`.

## Technical Notes
The **config and the guard are backend/staff-world work**; the participant-side render is already
done. The staff editor panel is COBRA (`@/theme/styledComponents`, FontAwesome, MUI 9 `sx`-only) and
lives in `src/frontend/src/features/planner/` — it must never mount a participant brand theme. The
served payload is participant-world data.

The chrome column **and the per-exercise watermark on/off column** ship in story 01a's single migration;
this story owns the projection + guard + panel. It contributes its `IChromeConfigProjection` via
`services.Replace(...)` (implementation.md's projection-override contract) rather than editing
`ParticipantShellEndpoints.cs` or `ParticipantShellConfigService.cs`. **Keep this story's
client-contract types local to `services/chromeSettingsService.ts`** — do not append to
`features/planner/types.ts`, which the other wave-3 builder would also touch. Story 05 (participant exercise identity) may later add a
chrome **content** requirement here. See implementation.md (story 02).

> **Orchestrator wiring — required at merge, and now LANDED (two lines + one JSX line).** Nothing in this
> story edits `Program.cs`, `ExerciseSettingsPage.tsx` or the planner barrel; until the orchestrator wired
> them the slice was inert — `/api/chrome-config` kept serving 01b's constant and the panel was unmounted.
> All three are now in the tree (`cc83766`, `eb49fe5`) and guarded (see "Why this is In Progress, not
> Complete"):
> - `builder.Services.AddComplianceChromeConfig();` — from
>   `Features/ExerciseConfiguration/Chrome/ChromeExtensions.cs`, conventionally **after**
>   `AddExerciseConfiguration()` (`Replace` makes it order-independent, but keep the convention).
> - `app.MapComplianceChromeEndpoints();` — mounts `GET/PUT /api/staff/chrome-settings` only; the
>   participant `/api/chrome-config` route stays where it is, on `MapParticipantShellEndpoints()`.
> - `<ComplianceChromePanel />` in `ExerciseSettingsPage.tsx`'s wave-3 slot, plus the barrel export. The
>   panel is self-contained and takes **no props**.
>
> No middleware-ordering constraint is introduced.

## Dependencies
Story 01 (the settings slice, the constants→service refactor of the shell-config endpoints, and — in its
single migration — **both** the chrome-config column **and the per-exercise watermark on/off column**,
so this story's NFR-008 guard reads real per-exercise state rather than a constant);
`participant-shell/01` (`ComplianceChrome.tsx` + `chromeConfig.ts`, merged).

## Tests
- Integration: per-exercise chrome config persists and is served per exercise; two exercises differ.
- Contract: the response is still accepted by the frontend — **drive `useChromeConfig()` through a
  mocked axios adapter returning the real body and assert it resolves that body rather than falling back
  to `DEFAULT_CHROME_CONFIG`** (the fallback *is* the private guard rejecting the shape). Do not import
  `isChromeConfig`; it is module-private in `participant-shell`, a different Complete feature.
- DI: the contributed `IChromeConfigProjection` wins from a fully composed provider (the override
  contract), not just in isolation.
- Guard: disabling chrome while the watermark is off is rejected server-side (and the reverse).
- Sanitization: a `<script>` payload in banner text is neutralized end to end.

### Shipped test linkage

Backend — `src/Pulse.WebApi.Tests/Features/ExerciseConfiguration/Chrome/` (58 tests; the SQL-touching
classes are `[RequiresDockerFact]`, the pure ones plain `[Fact]`/`[Theory]` OUTSIDE `MsSqlCollection`):

| Test | AC |
|---|---|
| `ChromeSettingsEndpointsTests.Put_PersistsTheChromeBlock_AndTheParticipantEndpointServesIt` | AC1, AC2 |
| `ChromeSettingsEndpointsTests.Put_InOneExercise_LeavesEveryOtherExercisesChromeUnchanged` | AC1, AC6 |
| `ChromeSettingsEndpointsTests.Put_ClearingABannerField_FallsBackToTheShippedConstantRatherThanServingBlank` | AC1, AC2 |
| `ChromeSettingsEndpointsTests.Get_ResolvedExercise_ReturnsTheChromeBlock_WithUnconfiguredFieldsNull` | AC1 |
| `ChromeConfigCompositionTests.ChromeConfig_WithStory02Wired_ServesTheResolvedExercisesOwnBanners_EndToEnd` | AC2, AC5 |
| `ChromeConfigCompositionTests.ChromeConfig_WithoutStory02Wired_StillServesTheShippedConstant` (negative control) | AC5 |
| `ChromeConfigCompositionTests.ChromeConfig_ForTwoExercises_ServesEachItsOwnBanners_AndNeverTheOthers` | AC2, AC6 |
| `ChromeConfigCompositionTests.ChromeConfig_KeepsTheFrozenWireShape_ExactlyThreeKeysAndThreePerBanner` | AC2 |
| `ChromeConfigCompositionTests.ChromeConfig_ForAnUnconfiguredExercise_IsUnchangedFromThePreStory02Constants` | AC2 |
| `ChromeConfigCompositionTests.ChromeConfig_WithAnUnresolvedScope_Returns401_FailClosed` | AC6 |
| `ChromeConfigCompositionTests.ChromeConfig_WithChromeOffAndTheWatermarkOn_ServesEnabledFalse` | AC3, AC7 |
| `ChromeConfigCompositionTests.ChromeConfig_WithAStoredRowThatHasBothMarkingsOff_ServesEnabledTrue_NFR008` | AC3 |
| `ChromeConfigProjectionTests.*` (9 tests: per-exercise output, two exercises differ, constant fallback, blank-column fallback, chrome-off, both-off, frozen slots) | AC2, AC3 |
| `ComplianceChromeGuardTests.*` (5 tests / 11 cases: the invariant truth table both ways) | AC3 |
| `ChromeSettingsEndpointsTests.Put_DisablingChromeWhileTheWatermarkIsAlreadyOff_Returns400_AndWritesNothing` | AC3 |
| `ChromeSettingsEndpointsTests.Put_DisablingTheWatermarkWhileChromeIsOff_Returns400_TheGuardIsMutual` | AC3 |
| `ChromeSettingsEndpointsTests.Put_TurningChromeOffWhileTheWatermarkStaysOn_IsAccepted` | AC3 |
| `ChromeSettingsEndpointsTests.Put_OmittingASwitch_Returns400_RatherThanDefaultingOneOff` | AC3 |
| `ChromeSettingsEndpointsTests.Put_MarkupInBannerText_IsStrippedNotEncoded_AllTheWayToTheParticipantSurface` | AC4 |
| `ChromeSettingsEndpointsTests.Put_AllMarkupBannerText_Returns400_RatherThanStoringABlankMarking` | AC4 |
| `ChromeSettingsEndpointsTests.Put_OverLengthBannerText_Returns400` / `Put_MalformedColor_Returns400_AndWritesNothing` | AC4 |
| `ChromeProjectionRegistrationTests.ChromeProjection_WinsOverTheConstantDefault_InTheOrchestratorsOrder` | AC5 |
| `ChromeProjectionRegistrationTests.ChromeProjection_WinsEvenWhenItRunsBeforeTheDefault` | AC5 |
| `ChromeProjectionRegistrationTests.ChromeProjection_LeavesExactlyOneDescriptor_SoIEnumerableResolutionNeverSeesAStaleDefault` | AC5 |
| `ChromeProjectionRegistrationTests.ResolvedChromeProjection_ProducesPerExerciseOutput_NotTheConstant` | AC5 |
| `ChromeSettingsEndpointsTests.Get_InExerciseA_NeverReturnsExerciseBsChrome` | AC6 |
| `ChromeSettingsEndpointsTests.Put_InExerciseA_NeverTouchesExerciseB_EvenWhenTheBodyNamesIt` | AC6 |
| `ChromeSettingsEndpointsTests.Get_StaffNotAssignedToTheResolvedExercise_Returns403_FailClosed` (+ the `Put_` twin) | AC6 |
| `ChromeSettingsEndpointsTests.Get_NoStaffSession_Returns401_FailClosed` / `Put_NoStaffSession_Returns401_AndWritesNothing` / `Get_UnresolvedScope_Returns401_FailClosed` | AC6 |
| `ChromeSettingsEndpointsTests.Put_EmitsExactlyOneChromeUpdatedTelemetryEvent_ListingTheChangedFields` (+ the no-op and rejected-write twins) | XC-004 |

Composition root — `src/Pulse.WebApi.Tests/Features/ExerciseConfiguration/CompositionRootWiringTests.cs`
(01b's file; these two rows are story 02's and went green when the wiring landed — they boot the **real**
`Program` host with no test-service override, so they are the only place a missing `Program.cs` line is
observable):

| Test | AC |
|---|---|
| `CompositionRootWiringTests.ProgramCs_CallsAddComplianceChromeConfig_SoChromeIsPerExerciseAndNotTheConstant` | AC2, AC5 (the runtime half — the seam resolves either way, so without this line nothing raises and the constant silently keeps serving) |
| `CompositionRootWiringTests.ProgramCs_MapsTheStaffChromeSettingsRoutesExactlyOnce` | AC1, AC3, AC4, AC6 (both verbs, once each) |

Frontend — `src/frontend/src/features/planner/` (38 tests):

| Test | AC |
|---|---|
| `chromeConfigWireContract.test.tsx` — "the shipped `useChromeConfig()` accepts the per-exercise body unchanged" | AC2 |
| `chromeConfigWireContract.test.tsx` — "accepts a chrome-OFF body", "requests the frozen route and never sends the exercise as a parameter", "a RESHAPED body … falls back to the default" (negative control) | AC2, AC6 |
| `chromeSettingsService.test.ts` — `violatesWatermarkInvariant` truth table; "surfaces the server 400 reason verbatim — the NFR-008 rejection reaches the planner" | AC3 |
| `chromeSettingsService.test.ts` — "requests the staff chrome route and NEVER names an exercise"; fail-closed body-guard cases | AC1, AC6 |
| `ComplianceChromePanel.test.tsx` — "refuses to submit when both markings are turned off, and explains why"; "binds the NFR-008 message to the switches with `aria-describedby`"; "allows chrome-off on its own"; "allows watermark-off on its own" | AC3, AC7 |
| `ComplianceChromePanel.test.tsx` — "submits EVERY managed field when only one changed"; "sends null for a field the planner cleared"; "re-renders from the SERVER response, not from local form state" | AC1 |
| `ComplianceChromePanel.test.tsx` — "shows a NOT-CONFIGURED banner field as EMPTY, never as the shipped constant"; "rejects a malformed colour with a message bound to that field" | AC1, AC7 |
| `pages/ExerciseSettingsPage.test.tsx` — "mounts the compliance-chrome panel (story 02)"; "renders every panel INSIDE the page main landmark, exactly once each" (the mount guard, added in `eb49fe5`) | AC1, AC7 (the panel is reachable at all) |
