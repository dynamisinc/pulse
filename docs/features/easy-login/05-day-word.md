# Story: Day word: staff controls and word sign-in

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-012, COR-017 (part: credential reset), NFR-009  ·  **Design decisions:** none (EL-9, EL-11, EL-13, EL-16)  ·  **Issue:** #470
**Stack:** backend  ·  **Review:** Tier-2 (a new anonymous, guessable-secret sign-in path; always-Critical class)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

"Password for a day": staff pick or generate one short word for the exercise day and read it to the room; each
participant types their **sign-in name plus that word**. It exists for the person who is not holding their card
or whose phone cannot scan. Tom accepted the trade-off in the open: **anyone who knows the word can sign in as
any sign-in name they know or guess**, and simple names (`jsmith`) are fine. The controls that make that
tolerable are the ones in this story: the word is per day, it can be rotated in one click and takes effect on the
very next attempt, it is stored only as a slow hash, the per-IP limiter stays, and a failure never says which half
was wrong.

Two design points are deliberate (EL-9). The word is verified **before** the sign-in name is looked up, so a
guesser needs both at once and learns nothing from either alone. And there is **no exercise-wide failed-attempt
lockout** (unlike the shared view-only credential): such a lockout would let one script lock every participant
out at StartEx.

This story is two surfaces: the staff API that sets the word, and the anonymous `POST /api/auth/word`. "Today" is
the **real date in the exercise time zone**, never scenario time.

## Acceptance Criteria

- [ ] **Given** `PUT /api/staff/day-word` with `{ word?, date? }`, **then** the word is set for `date` (default
      today in the exercise time zone; up to 14 days ahead; a past date is `400`). With no `word` the server
      **generates** one (`adjective-noun-NN`, lower-case, from curated lists of unambiguous words, so it can be
      read aloud) and `generated` is true. A supplied word must normalise to 6 to 64 characters (NFKD, accents
      stripped, lower-cased, only `a-z0-9` kept) or it is `400`. The response is `DayWordSetResultDto` and carries
      the **plaintext once**; storage holds only the `ISharedCredentialHasher` hash, and no later call can read it.
      Setting a date that already has a word **replaces** it in place (`replaced: true`, `ReplacedCount` + 1): a
      rotation. It takes effect on the very next sign-in attempt.
- [ ] **Given** `GET /api/staff/day-word`, **then** it answers `DayWordStatusDto`: the zone, today's date, when
      today ends, whether today's word is set, who set it (display name, from a `StaffUsers` read bounded with
      `.InOrganization(...)`) and when, how many times it was replaced, and the dates with words pre-set (never the
      words). **Given** `DELETE /api/staff/day-word[?date=]`, **then** that date's row is removed (`204`,
      idempotent) and the word path is closed for it until a new word is set.
- [ ] **Given** a request to `POST /api/auth/word { signInName, word }` with today's word and an **enabled**
      participant account of that sign-in name in the host-resolved exercise (name matched case-insensitively,
      trimmed), in an exercise that is Staged/Live/Paused, **then** it answers `200` with exactly the
      `/api/auth/login` envelope (built with `ParticipantSessionRequests`, persona and acting human as the account
      has them) and sets the account's `LastLoginAt`. The word is normalised the same way on both sides, so
      `Maple Harbor 42`, `maple-harbor-42` and `MAPLEHARBOR42` are the same word.
- [ ] **Given** any other outcome, **then** the answer is the **same bodyless `401`**: wrong word, wrong or unknown
      sign-in name, no word set for today, **yesterday's** word, a disabled account, an account from another
      exercise, a staff or read-only identity, an exercise that is Build/Completed/Archived, an unresolved host.
      Exactly one slow-KDF verification runs on every path (the real hash, or `VerifyDecoy` when no word is set), and
      it runs **before** the account lookup, so response time does not distinguish the cases. A missing or oversized
      field is `400`. The route has its own `easy-login-word` rate-limit policy (default 10 per minute per IP,
      `429` beyond it, from `EasyLoginOptions`) and `WithLoginBodyLimit()`.
- [ ] **Given** the day boundary, **then** a word set for date D works until the exercise-zone rollover that ends
      D (midnight plus `DayRolloverHour`) and not a second after, and a word for D+1 does not work before it. Tests
      use a fake `TimeProvider` and cover `America/New_York` across a DST change, `Asia/Kolkata`, and a rollover
      hour of 3, with no real sleeping.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** `ExerciseDayWord` and `Account` are read under the central filter, so
      exercise B's word does not open A, A's staff cannot set or clear B's word, and a B account named on A's host
      with A's word is the uniform `401`. Extends the standing suite.
- [ ] **Telemetry (XC-004):** each word sign-in emits `login` with `method: "word"` (success: participant actor;
      failure: `system`, identity-less, target = the **sanitized attempted sign-in name**, never the word). Set emits
      `credential.rotated` (`first`, `generated`, `date`) and clear emits `credential.revoked`, both targeting
      `dayWord` with the staff role and acting human. **No word, attempted or stored, appears in any event, log line,
      exception message or response body** other than the one-time `DayWordSetResultDto.word`; a test asserts it.
- [ ] **Content security and abuse (NFR-004, NFR-009):** `signInName` and `word` are length-bounded and the name is
      sanitized as `/api/auth/login` does; the route never creates or modifies an account (COR-011); the route is
      marked `.AllowAnonymousPreAuth()` (the seam commit adds it to `PreAuthAllowlist`).
- [ ] **Authorization (EL-13):** the three staff routes sit behind `EngineCockpitStaffAuthorizationFilter` +
      `RosterStaffRoleFilter` and answer `Cache-Control: no-store`; a participant or read-only session never
      reaches them.

## Out of Scope

Ending sessions that were created with the word when the word is rotated (rotation stops new sign-ins only; staff
use revoke/disable for a person). An exercise-wide or per-name lockout. Re-showing a stored word. Email or SMS of
the word. The staff UI (11) and the sign-in page tab (09). The existing "Exercise code" (view-only shared
credential) is unchanged.

## Technical Notes

Backend. New folder `Features/Identity/DayWord/`: `DayWordEndpoints` (`AddDayWord()` / `MapDayWordEndpoints()`),
`DayWordService` (staff side), `WordLoginService` (anonymous side), `DayWordNormalizer`, `DayWordGenerator`
(model: `SharedCredentialPasswordGenerator`; `RandomNumberGenerator`, never `System.Random`). Hash with
`ISharedCredentialHasher` (`Hash`, `Verify`, `VerifyDecoy`). Use `ExerciseDay` and `ExerciseFactsReader` from story
01, and inject `TimeProvider` (story 01 registers `TimeProvider.System`) so the boundary tests are deterministic.
Mirror `ParticipantLoginService` for sanitizing the name, resolving scope, and building telemetry. Rate-limit
policy registration is an additive `services.AddRateLimiter(...)` reading `EasyLoginOptions`. Do not log the
request body. See `implementation.md` (story 05, gotchas 2, 5, 6, 8).

## Dependencies

Story 01. Independent of 02/03 for its own tests (seed `Account` rows directly). The disabled-account refusal here
relies on `Account.DisabledAt` from story 01; story 03 sets it. Consumed by 09, 11, 14.

## Tests

`Pulse.WebApi.Tests/Features/Identity/DayWord/`: `DayWordNormalizerTests`, `DayWordGeneratorTests` (alphabet,
shape, two calls differ), `DayWordServiceTests` (set, generate, replace/rotate, pre-set, past date, clear,
plaintext never persisted), `WordLoginServiceTests` (success, the full uniform-401 matrix, decoy path taken when no
word, name case-insensitivity, lifecycle refusal), `DayWordBoundaryTests` (fake clock, DST, zones),
`DayWordEndpointsHttpTests` (200/204/400/401/403/429, `no-store`, body limit), `DayWordIsolationTests`
(`[RequiresDockerFact]`), `DayWordTelemetryTests` (events valid, the word appears nowhere).

### Linked tests (builder)

AC numbering: AC1 set/generate/replace, AC2 status/clear, AC3 word sign-in success, AC4 uniform 401 / 400 / limiter,
AC5 day boundary; XC-ISO isolation, XC-TEL telemetry, XC-SEC content security and abuse, XC-AUTH authorization.

- `DayWordNormalizerTests.Normalize_MatchesTheClientsVectors` (shared vectors with `dayWordNormalize.test.ts`),
  `.Normalize_SpellingsOfOneWord_AreTheSameWord`, `.Normalize_AppliesCompatibilityDecomposition`,
  `.Normalize_ALoneSurrogate_IsDroppedNotThrown`, `.IsAcceptableLength_BoundsAre6And64`,
  `.TheClientNormaliser_IsStillTheChainThisServerMirrors` (AC1, AC3)
- `DayWordGeneratorTests.Generate_HasTheReadAloudShape_FromTheCuratedLists`, `.Generate_TwoCallsDiffer`,
  `.TheCuratedLists_AreLowerCaseAsciiLetters_Unique_AndReadable`, `.TheWordSpace_IsAbout22Bits`,
  `.Generate_IsAlwaysAnAcceptableWord_AndNormalisesToItsLettersAndDigits` (AC1)
- `DayWordServiceTests.Set_ASuppliedWord_DefaultsToToday_ReturnsThePlaintextOnce_AndStoresOnlyTheHash`,
  `.Set_WithNoWord_GeneratesOne`, `.Set_ADateThatHasAWord_ReplacesItInPlace`,
  `.Set_UpTo14DaysAhead_IsAPreset_AndTheFifteenthDayIsNot`, `.Set_ABadDate_Is400`,
  `.Set_AWordShorterThanSixOnceNormalised_Is400_AndTheReasonNeverQuotesIt`,
  `.Set_AWordLongerThan64OnceNormalised_OrOverTheRawBound_Is400`, `.Set_AnAccentedWord_IsAcceptedOnItsFoldedLength`,
  `.Set_WhenAnotherFirstSetWinsTheRace_RetriesOnceAsARotation` (AC1)
- `DayWordServiceTests.Status_WithNoWord_ReportsTheZoneTodayAndItsEnd`,
  `.Status_WithWords_ReportsWhoWhenHowOftenAndThePresetDates_NeverAWord`,
  `.Status_ASetterOutsideTheExercisesTenant_IsNotNamed`, `.Status_InAnUnknownZone_FallsBackToUtcAndSaysSo_AndWarnsOnce`,
  `.Status_InAKnownZone_DoesNotWarn`,
  `.Clear_RemovesThatDatesWord_AndIsIdempotent`, `.Clear_ABadOrOutOfRangeDate_Is400` (AC2);
  `.NoStaffSession_OrNoScope_IsUnauthorized`, `.AStaffUserWithoutControllerOrPlanner_IsForbidden`,
  `.APlanner_MayManageTheWord` (XC-AUTH)
- `WordLoginServiceTests.Success_IssuesTheLoginSession_RecordsLastLoginAt_AndRunsExactlyOneKdf`,
  `.TheName_IsMatchedCaseInsensitively_AndTrimmed`, `.TheWord_IsNormalisedOnBothSides`,
  `.ParticipantAccessibleLifecycleStates_Admit` (AC3)
- `WordLoginServiceTests.WrongWord_IsRefused_AfterTheRealWordCheck`, `.UnknownName_IsRefused_AfterTheRealWordCheck`,
  `.NoWordSetToday_IsRefused_AfterTheDecoy`, `.YesterdaysWord_AndTomorrowsPresetWord_AreRefused`,
  `.ADisabledAccount_IsRefused_EvenWithTheRightWord`, `.AnAccountOutsideTheParticipantWorld_IsRefused`,
  `.AnExerciseOutsideStagedLivePaused_IsRefused`, `.AnUnresolvedOrEmptyHost_IsRefused_AfterTheDecoy_WithNoTelemetry`,
  `.AWordThatCannotBeValid_StillPaysTheDecoy`, `.TheWordIsVerifiedBeforeTheNameLookup_AndEveryRefusalRunsTheSameStatements`,
  `.AMissingField_IsInvalid_BeforeAnyWork`, `.AnOversizedField_IsInvalid_AndTheReasonNeverQuotesIt` (AC4);
  `.TheRoute_NeverCreatesOrChangesAnAccount` (XC-SEC);
  `.AnUnknownTimeZone_FallsBackToUtc_AndWarnsOncePerExercise_WithOnlyTheIdAndZone` (AC5)
- `DayWordBoundaryTests.NewYork_RolloverZero_TheWordEndsAtLocalMidnight_ToTheSecond`,
  `.NewYork_FallBack_The25HourDayEndsAtTheNextLocalMidnight`, `.NewYork_SpringForward_The23HourDayEndsAtTheNextLocalMidnight`,
  `.Kolkata_AHalfHourOffsetZone_RollsOverAt1830Utc`, `.RolloverHourThree_TheDayEndsAtThreeLocal`,
  `.RolloverHourTwo_OnTheSpringForwardNight_EndsTheDayWhenTheClocksJump`,
  `.TheStaffSide_FlipsTodayAndThePastAtTheSameInstant`, `.TheStaffSide_HonoursTheRolloverHour` (AC5)
- `DayWordEndpointsHttpTests.StaffRoutes_WithNoStaffSession_Are401_AndNoStore`, `.AnEvaluator_Is403_AndNoStore`,
  `.AParticipantOrReadOnlySession_OrAnAnonymousCaller_NeverReachesTheStaffRoutes` (XC-AUTH);
  `.AController_GetsPutsAndDeletes_AndEveryResponseIsNoStore`, `.ABadDate_Is400ProblemDetails_WithAReadableDetail` (AC1, AC2);
  `.WordSignIn_EndToEnd_AnswersTheLoginEnvelope_AndARotationTakesEffectOnTheNextAttempt` (AC1, AC3);
  `.WordSignIn_NullBody_Is400ProblemDetails`, `.WordSignIn_AMissingField_Is400ProblemDetails`,
  `.WordSignIn_AnOversizedField_Is400_AndNeverEchoesIt`, `.WordSignIn_OnAnUnresolvedHost_IsTheBodyless401`,
  `.WordSignIn_IsRateLimitedPerIp_TenAMinuteByDefault`, `.WordSignIn_RateLimit_ComesFromEasyLoginOptions`,
  `.TheRoutes_AreMappedOnce_WithTheirMetadata` (AC4, XC-SEC); `.AddDayWord_SharesTheHasherWithTheViewOnlyCredential`,
  `.AddDayWord_ComposesIntoTheRealProgramHost` (composition)
- `DayWordIsolationTests.ExerciseBsWord_NeverOpensA`, `.ABAccountNamedOnAsHost_WithAsWord_IsTheUniformRefusal`,
  `.AsStaff_CannotSeeSetOrClearBsWord`, `.StaffAssignedOnlyToB_AreForbiddenOnA`,
  `.AnUnsetOrEmptyScope_SeesZeroRows_WhileTheRowsExist_AndAByIdReadAcrossExercisesIsNull`,
  `.OverHttp_TheHostDecidesTheExercise_AndBsWordIsRefusedOnAsHost` (XC-ISO)
- `DayWordTelemetryTests.ASuccess_EmitsOneLoginEvent_WithTheParticipantActor`,
  `.AWrongWord_KeepsThePlainSanitizedSignInName_AsTheTarget`, `.A_ANameEqualToTheAttemptedWord_IsNotRecorded`,
  `.B_TodaysWordTypedIntoTheNameBox_IsNotRecorded`, `.WithNoWordSet_TheNameIsStillChecked_AgainstTheDecoy_AndKept`,
  `.SetAndReplace_EmitCredentialRotated_WithFirstGeneratedAndDate`, `.Clear_EmitsCredentialRevoked_AndANoOpClearEmitsNothing`,
  `.TheWord_SetOrAttempted_AppearsInNoEventLogLineOrResponseBody_ButTheOneTimeSetResult` (XC-TEL)
