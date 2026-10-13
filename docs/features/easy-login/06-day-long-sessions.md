# Story: Day-long participant sessions

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-012 (refined, not relaxed)  ·  **Design decisions:** none (EL-10, EL-11)  ·  **Issue:** #471
**Stack:** backend  ·  **Review:** Tier-2 (changes how long a credential stays live)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** S

## Context

Tom: a participant "stays signed in for the exercise day": surviving a closed tab and a locked phone, until the
end of the day, EndEx, or a staff revoke. Two things stand in the way, and this story fixes the server half
(story 07 fixes where the browser keeps the token).

Today `SessionOptions` gives an access token of 60 minutes and a refresh window of 720 minutes, **and the refresh
slides**: `SessionService.RefreshAsync` sets `RefreshExpiresAt = now + 720 min` on every refresh. So a session
that keeps being used never ends, and one left alone for 12 hours dies mid-day. Neither matches "until end of day".

COR-012 says sessions are *short-lived with refresh*. That stays true: the **access token stays 60 minutes**, and
the SPA's silent refresh keeps it fresh. What changes, for `participant`-kind sessions only, is the **refresh
window**: it ends at the **end of the exercise day** in the exercise time zone (EL-10), recomputed on each refresh
so it can never slide into the next day. "Until EndEx" is already enforced by the lifecycle gate and by story
03/05 refusing new sign-ins (EL-11); this story deliberately does **not** make refresh refuse at `completed`,
which would bounce participants off the COR-054 EndEx overlay.

If this story slips, the existing 12-hour window is an acceptable degraded behaviour for the demo; story 07 is the
part testers will feel.

## Acceptance Criteria

- [ ] **Given** a `participant`-kind session issued by **any** login method (password, link, word), **then**
      `RefreshExpiresAt` is the end of the exercise day (`ExerciseDay.EndOfDayUtc` for the session's exercise zone and
      `DayRolloverHour`) and `ExpiresAt` is `min(now + SessionLifetime, that instant)`. Staff and read-only sessions
      are **unchanged** (same lifetimes as today).
- [ ] **Given** a refresh of a participant session before the end of day, **then** both tokens rotate exactly as
      today, `ExpiresAt` is again `min(now + 60 min, end of the current day)`, and `RefreshExpiresAt` is the end of
      the **current** day (never `now + 720 min`, never the next day). **Given** a refresh at or after that instant,
      **then** it is `401` (a full sign-in is needed: tap the link again, or use the new day's word).
- [ ] **Given** a session that staff revoked (link revoke, reissue, disable, logout), **then** the next refresh with
      its refresh token is `401` and the next authenticated request is `401` (regression guard for the new ending
      paths; the mechanism already exists).
- [ ] **Given** `Authentication:Session:ParticipantDayLong = false`, **then** participant sessions behave exactly as
      they do today (60 min / sliding 720 min). The default is `true`.
- [ ] **Given** an exercise whose stored time zone is blank or unknown, **then** the cap falls back to UTC and a
      warning is logged **once per exercise per process**, not per request. The rollover hour is bounded 0 to 6.
- [ ] **Given** an exercise that is `completed` or `archived`, **then** an already-issued participant access token
      still gets the existing lifecycle-gate behaviour (participant data routes `403`, `/api/overlay-state` served in
      `completed`), and refresh is **not** newly refused; a test pins this so a later change does not break the EndEx
      overlay.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** the time zone is read for the session's own bound `ExerciseId` through
      `ExerciseFactsReader`; there is no new `Exercises` read. A session for exercise A is never capped by exercise
      B's zone.
- [ ] **Telemetry (XC-004):** `session.refreshed` is emitted exactly as today (no new event types); a refresh that
      fails because the day has ended emits no event and answers the existing `401`.

## Out of Scope

Where the browser stores the token (07). Per-exercise configuration of the day boundary beyond the global
`DayRolloverHour`. Changing staff or read-only lifetimes. Refusing refresh at EndEx (deliberately not done). A
"stay signed in across days" option.

## Technical Notes

Backend. Edits only `Features/Identity/Sessions/SessionIssuer.cs`, `SessionService.cs` (`RefreshAsync`) and
`SessionOptions.cs` (`ParticipantDayLong`). Both call a small private helper that, for `Kind == "participant"`
and the option on, asks `ExerciseFactsReader` for the zone and `ExerciseDay.EndOfDayUtc` for the cap. Keep the
helper in one place so issue and refresh cannot disagree. `SessionIssuer` currently has no exercise read;
`SessionService` already loads the exercise for telemetry, so reuse that fetch rather than adding a second.
Existing `SessionIssuerTests` / `SessionServiceTests` expectations for participant kind change; update them, do not
delete them. Both classes read `DateTimeOffset.UtcNow` directly today; give each a `TimeProvider` constructor
parameter (story 01's `AddEasyLoginFoundation()` registers `TimeProvider.System` with `TryAddSingleton`) so the end-of-day
boundary is testable without sleeping, and pass `TimeProvider.System` in the tests that construct them by hand.
See `implementation.md` (story 06, gotchas 3, 4).
Gate-2 W-001: refresh also refuses a `participant` session whose account is disabled, exactly like a revoked one (401, no event, no write), reading the account by the session's own `ExerciseId` + `AccountId` rather than the request's scope (`SessionServiceTests.Refresh_ParticipantWhoseAccountIsDisabled_IsRefusedLikeARevokedSession_WithNoEventAndNoWrite`).

## Dependencies

Story 01 (`ExerciseDay`, `ExerciseFactsReader`, `EasyLoginOptions.DayRolloverHour`). Pairs with 07 (frontend
persistence). Independent of 02 to 05.

## Tests

`Pulse.WebApi.Tests/Features/Identity/Sessions/`: extend `SessionIssuerTests` and `SessionServiceTests`
(`[RequiresDockerFact]`) for participant vs staff vs read-only expiry, refresh before/at/after end of day, flag off,
unknown zone, revoked-session refresh; add `ParticipantSessionCapTests` (fake `TimeProvider`/clock across DST and
a 3 a.m. rollover) and a lifecycle-pin test in `ExerciseLifecycleGatingTests` territory for the `completed` case.

**Built (test linkage):**

- **AC-1 (issue, any login method):** `SessionIssuerTests.Issue_Participant_MidDay_RefreshEndsAtEndOfExerciseDay_AccessIsTheLifetime`,
  `.Issue_Participant_LateInTheDay_AccessExpiryIsCappedAtTheDayEnd`, `.Issue_Participant_WithAThreeAmRollover_BelongsToThePreviousDayUntilThree`,
  `.Issue_StampsShortLivedExpiryAndRefreshWindow_ServerSide` (updated), `.Issue_Staff_IsUnchanged_EvenLateInTheExerciseDay`,
  `.Issue_SharedReadOnly_IsUnchanged_EvenLateInTheExerciseDay`; `ParticipantDayLongLoginTests.PasswordLogin_OnExerciseDayN_GetsARefreshWindowEndingAtDayNsEnd`
  (Gate-1 S-6, end to end through `ParticipantLoginService`); `ParticipantSessionCapTests.AppliesTo_OnlyParticipantKind_AndOnlyWithTheOptionOn`,
  `.Windows_Uncapped_AreNowPlusTheConfiguredLifetimes`, `.Windows_Capped_MidDay_AccessIsTheLifetime_RefreshIsTheDayEnd`,
  `.Windows_Capped_LateInTheDay_AccessIsCappedAtTheDayEnd`. The cap keys on `Kind == "participant"` at the one issuer, so
  password, link and word sessions (all built by `ParticipantSessionRequests.For` / `ParticipantLoginService`) are covered alike.
- **AC-2 (refresh before / at / after end of day):** `SessionServiceTests.Refresh_Participant_BeforeEndOfDay_RotatesAndCapsAtTheEndOfTheCurrentDay`,
  `.Refresh_Participant_LateInTheDay_AccessExpiryIsCappedAtTheDayEnd`, `.Refresh_Participant_ExactlyAtTheEndOfDay_Is401_WithNoEvent`,
  `.Refresh_Participant_AfterTheEndOfDay_Is401_WithNoEvent`, `.Refresh_Participant_WhoseStoredWindowCrossesMidnight_Is401OnceItsDayHasEnded_AndIsRevoked` (Gate-1 S-2: a legacy row refused at
  day end is revoked, no event, not retried),
  `.Refresh_Participant_RepeatedRefreshes_NeverSlidePastTheDay`, `.Refresh_Staff_IsUnchanged_SlidesByTheRefreshLifetimeAcrossTheDayEnd`,
  `.Refresh_SharedReadOnly_IsUnchanged_SlidesByTheRefreshLifetimeAcrossTheDayEnd`;
  `ParticipantDayLongHttpTests.Refresh_AfterTheExerciseDayEnded_Is401_ExactlyLikeALapsedRefreshToken`,
  `.Refresh_InsideTheExerciseDay_ReturnsTheDayCappedSession`.
- **AC-3 (revoked session):** `SessionServiceTests.Refresh_ParticipantSessionRevokedByStaff_Is401_AndTheAccessTokenIs401`,
  `.Refresh_ParticipantSessionLoggedOut_Is401_AndTheAccessTokenIs401`;
  `ParticipantDayLongHttpTests.ARevokedDayLongSession_Is401OnRefresh_AndOnItsNextAuthenticatedRequest`.
- **AC-4 (`ParticipantDayLong = false`, default true):** `SessionIssuerTests.Issue_ParticipantDayLongOff_StampsTheConfiguredLifetimes_AsBefore`;
  `SessionServiceTests.Refresh_Participant_WithParticipantDayLongOff_SlidesExactlyAsBefore`;
  `SessionRegistrationTests.AddSessions_BindsSessionLifetimeDefaults`, `.AddSessions_BindsParticipantDayLongOff_FromAuthenticationSession`.
- **AC-5 (unknown zone, warn once, rollover 0 to 6, DST):** `SessionIssuerTests.Issue_Participant_UnknownOrBlankZone_IsCappedAtTheEndOfTheUtcDay`;
  `SessionServiceTests.Refresh_Participant_UnknownZone_IsCappedAtTheEndOfTheUtcDay`,
  `.Refresh_ParticipantWithNoExerciseRow_FallsBackToUtc_AndTheWallClockScenarioTime`;
  `ParticipantSessionCapTests.UnknownOrBlankZone_FallsBackToTheUtcDay`, `.UnknownZone_IsWarnedOncePerExercisePerProcess_NotPerRequest`,
  `.KnownZone_IsNeverWarned`, `.TheFallbackWarning_SaysWhatHappenedAndWhichDefaultWasUsed_AndEchoesNoStoredValue` (Gate-1 S-4),
  `.RolloverHour_OutsideZeroToSix_IsBoundedIntoRange`, `.EasyLoginOptions_ValidatesTheRolloverHourZeroToSix`,
  `.SpringForward_RolloverZero_TheTwentyThreeHourDayEndsAtLocalMidnightInDaylightTime`,
  `.SpringForward_ThreeAmRollover_TheDayEndsAtThreeLocalDaylightTime`,
  `.FallBack_RolloverZero_TheTwentyFiveHourDayEndsAtLocalMidnightInStandardTime`,
  `.FallBack_ThreeAmRollover_TheDayEndsAtThreeLocalAfterTheClocksFall`, `.AtTheDayEndExactly_TheNextDayHasBegun`.
- **AC-6 (completed / archived, lifecycle pin):** `ParticipantDayLongLifecyclePinTests.AfterEndEx_ADayLongParticipantSession_StillRefreshes_AndTheGateBehavesAsBefore`
  (completed: feed 403, overlay 200; archived: feed 403, overlay 403; refresh succeeds in both and the refreshed token
  resolves a live session, Gate-1 S-1);
  `SessionServiceTests.Refresh_Participant_InACompletedOrArchivedExercise_IsNotRefused`.
- **Isolation (XC-001):** `SessionIssuerTests.Issue_Participant_IsCappedByItsOwnExercisesZone_NeverAnotherExercises`,
  `SessionServiceTests.Refresh_Participant_IsCappedByItsOwnExercisesZone_NeverAnotherExercises`; `OrganizationScopeSweepTests`
  unchanged (no new `Exercises` read: issue and refresh read through `ExerciseFactsReader`).
- **Telemetry (XC-004):** `SessionServiceTests.Refresh_Participant_SessionRefreshedEnvelope_IsUnchanged`; the AC-2 day-ended tests
  assert zero `session.refreshed` events; the existing per-kind actor-shape tests still pass.
- **Composition:** `SessionRegistrationTests.AddSessions_RegistersTheDayCapInputs_WithoutOverridingAHostsOwnClock`.
