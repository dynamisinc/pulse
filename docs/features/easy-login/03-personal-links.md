# Story: Personal links: join, revoke, reissue, disable

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-011, COR-012, COR-017 (part: force-logout, credential reset), NFR-009  ·  **Design decisions:** none (EL-5 to EL-8, EL-11, EL-16)  ·  **Issue:** #468
**Stack:** backend  ·  **Review:** Tier-2 (a new anonymous credential endpoint and session termination; always-Critical class)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** L

## Context

The personal link is the headline feature: one tap or scan and a participant is signed in as themselves, with
their persona and composer, no typing. It is a **bearer credential** held by a phone, so it must be
unguessable, revocable, reprintable by staff (cards get lost), and it must never reveal whether a token exists.

This story is the whole backend life of that credential: the real `IParticipantLinkIssuer` (story 02 calls it
for each new participant), the anonymous exchange `POST /api/auth/join`, and the staff controls: revoke,
reissue, disable and enable. It also adds the person-level kill switch (EL-8): disabling an account ends its
sessions and makes every participant sign-in path refuse it, including the existing password login.

The token and URL primitives come from story 01. Nothing here creates or edits an account over an anonymous
route (COR-011).

## Acceptance Criteria

- [ ] **Given** an active link in the host-resolved exercise, an enabled account, and an exercise in
      Staged/Live/Paused, **when** `POST /api/auth/join { "token": "…" }` is called, **then** it answers
      `200` with exactly the `/api/auth/login` envelope (`token`, `refreshToken`, `session` with `personaId` when
      the account has one, `isReadOnly: false`), built with `ParticipantSessionRequests`. It sets the link's
      `LastUsedAt` and `UseCount` and the account's `LastLoginAt`. The link can be used again and again until
      revoked or reissued; it does not expire on use.
- [ ] **Given** any other outcome, **then** the answer is the **same bodyless `401`** with the same shape and
      timing class: an unknown token, a malformed token, a **revoked** link, a **superseded** (reissued) link, a
      token that belongs to another exercise, a disabled account, an exercise that is Build/Completed/Archived,
      and an unresolved host scope. The lookup is one hash comparison against `ParticipantLink.TokenHash`, so
      "unknown" and "revoked" are the same code path. A missing body or empty `token` is `400`; an oversized body
      is refused by the 16 KiB login body limit. The route is rate-limited by its own `easy-login-join` policy
      (default 30 per minute per IP, `429` beyond it, from `EasyLoginOptions`).
- [ ] **Given** `POST /api/staff/roster/{id}/link/reissue`, **then** a new token replaces the old (`Generation`
      + 1, new hash and protected copy, `RevokedAt` cleared), the old URL stops working at once, **every
      non-revoked session of that account in this exercise is ended**, including one whose access token has lapsed but
      whose refresh window is still open (`RevokedAt` set; their refresh tokens then fail), and the
      response is `RosterActionResultDto` with the new `joinUrl` and `sessionsEnded`. It works for an account with
      no link yet (issues the first one) and for one whose link `needsReissue`.
- [ ] **Given** `POST /api/staff/roster/{id}/link/revoke`, **then** the link gets `RevokedAt`, its protected copy
      is cleared (no `joinUrl` afterwards), live sessions are ended, and `sessionsEnded` is returned. Revoking
      again is a no-op `200` with `sessionsEnded: 0` (idempotent), not an error. The participant can still sign in
      with the day word unless disabled; that is the documented difference between revoke and disable.
- [ ] **Given** `POST /api/staff/roster/{id}/disable`, **then** `Account.DisabledAt` is set, live sessions are
      ended, and from then on `/api/auth/join`, `/api/auth/word` (story 05) **and** `POST /api/auth/login` all
      refuse that account with their normal rejection (the password login answers its existing `401`, with the same
      telemetry as a wrong password). `…/enable` clears `DisabledAt` and changes nothing else. Both are idempotent.
- [ ] **Given** the real `IParticipantLinkIssuer.EnsureActiveAsync`, **then** it returns the existing active link
      unchanged, otherwise creates a first link (or re-activates a revoked one with a fresh token), stamping
      `ExerciseId` from the account's own scope; it never rotates an active link. Registered by `AddPersonalLinks()`
      so it **replaces** story 01's null default.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** the account is found under the central filter, so an `{id}` from another
      exercise is a `404` indistinguishable from an unknown id; the **session termination carries an explicit
      `ExerciseId` and `AccountId` predicate** (`Session` is unscoped), and a test proves exercise B's sessions are
      untouched by an action in A. A token minted in exercise B and presented on exercise A's host is the uniform
      `401`. Extends the standing isolation suite.
- [ ] **Telemetry (XC-004):** every join emits `login` with `method: "link"` (success: participant actor; failure:
      `system`, identity-less, **no target and never the token**). Staff actions emit
      `participant.link.reissued` / `.revoked` and `participant.disabled` / `.enabled` with the staff role and acting
      human and the `sessionsEnded` count, in the same unit of work as the mutation. A grep-style test asserts no raw
      token appears in any emitted payload, log message or response body other than the staff `joinUrl` field.
- [ ] **Authorization and abuse (EL-13, NFR-009):** the four staff routes sit behind
      `EngineCockpitStaffAuthorizationFilter` + `RosterStaffRoleFilter` (401/403 as in story 02). The join route is
      marked `.AllowAnonymousPreAuth()` and `.WithLoginBodyLimit()`; the orchestrator adds it to `PreAuthAllowlist`
      in the seam commit. The route never creates or modifies an account (COR-011).

## Out of Scope

The roster list and CSV (02). QR and cards (04). The day word (05). The day-long refresh window (06). The SPA
`/join` page (08). Emailing the link (13). Unlocking password accounts (`identity-auth-roles/08`). A bulk
"reissue everyone" action. Ending sessions that were created by the day word when the word is rotated.

## Technical Notes

Backend. New folder `Features/Identity/PersonalLinks/`: `JoinEndpoints` + `JoinLoginService` (mirror
`ParticipantLoginService` for scope/exercise handling and the rate-limit/body-limit/pre-auth idiom from
`AccountEndpoints.MapAccountEndpoints`), `ParticipantLinkService : IParticipantLinkIssuer`,
`ParticipantAccessEndpoints` (`/api/staff/roster/{id:guid}/…`), `AddPersonalLinks()` /
`MapPersonalLinkEndpoints()`. The one edit outside the folder is `Accounts/ParticipantLoginService.cs`:
treat `account.DisabledAt != null` as `RejectedCredential` **after** the password check has run, so timing and
telemetry match a wrong password. Revoke/reissue/disable end sessions with the `SharedCredentialLifecycleService.RevokeAsync`
pattern; read the exercise through `ExerciseFactsReader` (gotcha 3). Rate-limit policy registration is an
additive `services.AddRateLimiter(...)` reading `EasyLoginOptions`. Do not log the request body. See
`implementation.md` (story 03, gotchas 2, 4, 5, 6, 8).

A join that races a staff revoke, reissue or disable is caught by re-reading the link and account after the session is
minted (Gate-1 W-001). Gate-2 W-001/S-2/S-4/S-6: `/api/auth/login` and `/api/auth/word` take the same mint-then-re-read step against Disable, and Disable commits `DisabledAt` BEFORE it reads the sessions to end (then saves the terminations and its one `participant.disabled` event together, so the event shares a unit of work with the terminations, not with `DisabledAt`), which closes the Disable race; refresh renews a participant session only while an enabled account of its exercise exists; the join's use counter is a conditional `UPDATE` on the token hash (a reissue's reset is never overwritten; a join that loses that race is refused); and join admits only `participant`/`pio` accounts, like the word.

## Dependencies

Story 01. Story 02 calls the issuer this story implements (they build in parallel; the seam commit wires both).
Consumed by 04, 08, 10, 12, 13.

## Tests

`Pulse.WebApi.Tests/Features/Identity/PersonalLinks/`: `JoinLoginServiceTests` (success envelope, the full
uniform-401 matrix, last-used bookkeeping, reuse after use), `JoinEndpointsHttpTests` (400/401/429, body limit,
no body on 401), `ParticipantLinkServiceTests` (ensure/reissue/revoke idempotency, generation, protected copy
cleared), `ParticipantAccessTests` (sessions ended, refresh fails afterwards, disable blocks join/word/password,
enable restores), `PersonalLinkIsolationTests` (`[RequiresDockerFact]`: cross-exercise id 404, token on the wrong
host, session predicate), `PersonalLinkTelemetryTests` (events valid, no token anywhere). Extend
`Accounts/ParticipantLoginServiceTests` for the disabled account.

### Test linkage

AC numbers follow the order of the criteria above: AC-1 join success, AC-2 the uniform refusal (with 400, body limit
and rate limit), AC-3 reissue, AC-4 revoke, AC-5 disable/enable, AC-6 the real issuer, AC-7 Isolation, AC-8
Telemetry, AC-9 Authorization and abuse.

- **AC-1** `JoinLoginServiceTests.Join_ActiveLink_IssuesTheSameSessionAsAPasswordSignIn_AndRecordsTheUse`,
  `.Join_TheSameLink_WorksAgainAndAgain_UntilRevokedOrReissued`, `.Join_IsAdmitted_InEveryParticipantAccessibleState`,
  `.Join_Success_BookkeepingAndTelemetry_ShareOneSaveChanges`; `JoinEndpointsHttpTests.Join_Success_Is200_WithExactlyTheLoginEnvelope`.
- **AC-2** `JoinLoginServiceTests.Join_EveryOtherOutcome_IsTheSameRefusal_WithOneIdentitylessTargetlessEvent` (unknown,
  malformed, revoked, superseded, other exercise's token, disabled account, build, completed, archived),
  `.Join_WithNoResolvedScope_IsRefused_WithNoEvent`, `.Join_OnAHostScopeWithNoExerciseRow_IsRefused_WithNoEvent`,
  `.Join_AMissingOrEmptyToken_IsInvalid_BeforeAnyLookup`; `JoinEndpointsHttpTests.Join_AMissingBodyOrEmptyToken_Is400ProblemDetails`,
  `.Join_WithNoResolvedHost_IsABodyless401`, `.Join_EveryRefusal_IsTheSameBodyless401_OverTheRealPipeline`,
  `.Join_TheThirtyFirstRequestInAMinute_Is429_ByDefault`, `.Join_TheLimit_ComesFromEasyLoginOptions`,
  `.Join_AnOversizeBody_IsRefusedWith413_WhileItIsRead`,
  `.Join_RacingAStaffAction_BetweenTheLookupAndTheIssue_IsTheUniform401_AndLeavesNoLiveSession` (Gate-1 W-001:
  disable, reissue, revoke).
- **AC-3** `ParticipantAccessTests.Reissue_EndsEveryLiveSession_TheirRefreshFails_TheOldUrlStops_AndTheNewOneWorks`,
  `.Reissue_WorksForAPersonWithNoLinkYet_AndForALinkThatNeedsReissue`;
  `ParticipantLinkServiceTests.Reissue_RotatesInPlace_GenerationPlusOne_NewHashAndCopy_RevokedAtCleared`,
  `.Reissue_ActiveLink_AlsoRotates_AndANeedsReissueLinkBecomesRecoverable`, `.Reissue_NoLinkYet_IssuesTheFirst`.
- **AC-4** `ParticipantAccessTests.Revoke_EndsSessions_ClearsTheCopy_IsIdempotent_AndLeavesOtherSignInMethodsAlone`;
  `ParticipantLinkServiceTests.Revoke_StampsTheRevoke_ClearsTheProtectedCopy_KeepsTheHash_AndIsIdempotent`.
- **AC-5** `ParticipantAccessTests.Disable_EndsSessions_AndBlocksTheLinkAndThePassword_EnableRestoresBoth_AndChangesNothingElse`;
  `ParticipantLoginServiceTests.Login_DisabledAccount_WithTheRightPassword_IsRefusedExactlyLikeAWrongPassword`;
  the `DisabledAccount` row of the AC-2 matrix. The `/api/auth/word` refusal is story 05's half (it must check
  `Account.DisabledAt`).
- **AC-6** `ParticipantLinkServiceTests.EnsureActive_NoLink_StagesAFirstLink_StampedFromTheAccount_AndOnlyTheCallerSaves`,
  `.EnsureActive_ActiveLink_IsReturnedUnchanged_EvenWhenItsCopyCannotBeDecrypted`,
  `.EnsureActive_RevokedLink_IsReactivated_WithAFreshToken`, `.EnsureActive_TwiceInOneUnitOfWork_ReturnsTheStagedLink`,
  `.EnsureActive_AnAccountWithNoExercise_IsRefused`,
  `.EnsureActiveAndReissue_RefuseAnAccountOutsideTheResolvedScope_WithAReadableError` (Gate-1 S-004),
  `.AddPersonalLinks_ReplacesTheNullIssuer_InEitherRegistrationOrder`.
- **AC-7** `PersonalLinkIsolationTests.StaffActions_OnAnotherExercisesAccountId_Are404_IndistinguishableFromAnUnknownId_AndTouchNothing`,
  `.ATokenMintedInB_PresentedOnAsHost_IsTheUniform401_AndLeavesBUntouched`,
  `.SessionTermination_IsBoundedByExerciseAndAccount_BsSessionsSurviveEveryActionInA`,
  `.StaffActions_WithAnUnsetOrEmptyScope_ReachNothing`,
  `.StaffActions_ByAStaffSessionBoundToAnotherExercise_FailClosed_EvenIfTheScopeSaysA`; the `OtherExercisesToken` row
  of the AC-2 matrix.
- **AC-8** `PersonalLinkTelemetryTests.EveryStaffAction_EmitsOneValidEvent_WithTheStaffRole_ActingHuman_AndSessionsEnded`,
  `.EveryStaffAction_CommitsItsMutationSessionsAndEvent_InOneSaveChanges`,
  `.NoRawToken_JoinUrl_SessionToken_OrSessionId_AppearsInAnyEventLogOrResponseBody_ExceptTheStaffJoinUrl`; the event
  assertions in the AC-1 and AC-2 join tests.
- **AC-9** `ParticipantAccessTests.StaffRoutes_AreGated_401WithoutAStaffSession_403ForAnEvaluator_AndAnotherExercisesStaffFindsNothing`,
  `.StaffRoutes_AnUnknownOrMalformedId_Is404`; `JoinEndpointsHttpTests.Join_Route_IsPreAuth_BodyLimited_AndOnItsOwnRateLimitPolicy`;
  `ParticipantLinkServiceTests.AddPersonalLinks_RegistersTheEasyLoginJoinRateLimitPolicy`.
