# Story: Compliance chrome — per-exercise config

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
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
- [ ] Given a planner with a staff session, when they edit the compliance-chrome config (enabled,
      top/bottom banner text + fg/bg colors) and save, then it persists on that exercise and is
      unchanged for every other exercise.
- [ ] Given a saved chrome config, when a participant calls `GET /api/chrome-config`, then the response
      carries that exercise's values in the **existing frozen `ChromeConfigResponse` shape**
      (`{ enabled, top{text,fg,bg}, bottom{text,fg,bg} }`) — the constant is gone, the DTO is unchanged,
      and `chromeConfig.ts`'s `isChromeConfig` guard and `ComplianceChrome.tsx` need no change.
- [ ] **NFR-008 guard, server-side:** given an exercise whose in-content watermark is off, when a
      planner attempts to disable compliance chrome (or vice versa), then the write is rejected with a
      400 and an explanatory message — chrome and watermark are never both off, and the rule holds
      regardless of what the client sends.
- [ ] **Content security (NFR-004):** given banner text is free text rendered on every participant
      channel, when it is saved, then it is length-bounded and sanitized server-side **through the
      shipped `Features/Social/PostSanitizer.cs`**; a stored `<script>` in a banner never executes in a
      participant session. **Strip, never entity-encode** — an `HtmlEncoder` here ships banner text
      reading `UNCLASSIFIED &#47;&#47; EXERCISE` on every participant channel.
- [ ] **The override actually resolves (projection-override contract):** given a fully composed service
      provider wired in the orchestrator's order, when `IChromeConfigProjection` is resolved, then the
      **contributed** implementation comes back — registered via `services.Replace(...)`, **never
      `TryAddScoped`, which against 01b's already-present default is a silent no-op that leaves the
      constant serving** — and `/api/chrome-config` returns per-exercise banners end to end. A test of
      the projection class in isolation does not satisfy this AC.
- [ ] **Isolation (XC-001/002, COR-001):** given a chrome-config read, when it is served, then the
      exercise comes from the server-resolved scope (`IExerciseContext`), never a client parameter; a
      cross-exercise chrome read/write returns 403/404.
- [ ] Given chrome is enabled, when it renders, then its state is not conveyed by color alone (NFR-001)
      and it remains framing outside the fiction — no change to the shipped component's markup is
      required to satisfy this.

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

> **Orchestrator wiring required at merge (two lines + one JSX line).** Nothing in this story edits
> `Program.cs`, `ExerciseSettingsPage.tsx` or the planner barrel, so until the orchestrator wires them the
> slice is inert — `/api/chrome-config` keeps serving 01b's constant and the panel is unmounted:
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
