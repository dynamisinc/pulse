# Story: Link cards and QR codes

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-011, COR-017 (part: handing out credentials at StartEx)  ·  **Design decisions:** none (EL-5, EL-6, EL-12)  ·  **Issue:** #469
**Stack:** backend  ·  **Review:** Tier-1 (staff-only; reveals credentials in bulk, so isolation and `no-store` are checked at Gate 1)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** S

## Context

The printed card sheet needs, per person: name, QR, link, sign-in name. The frontend may not add an npm
package this week, so the QR is generated **on the server** with the QRCoder NuGet package (EL-12) and returned
as an SVG data URI that the page drops into an `<img>`. This story is that one endpoint. It reads active links
that story 02/03 created and decrypts them with story 01's protector; it never creates or changes a link.

World: staff (the data feeds the print preview in story 12). The QR encodes exactly the personal join URL
(`{FrontendBaseUrl}/join/{token}`).

## Acceptance Criteria

- [ ] **Given** `POST /api/staff/roster/cards` *(amended: was GET, see EL-20)*, **then** it answers `200 RosterCardsDto` with `exerciseName` and one
      `RosterCardDto` per participant whose account is enabled, whose link is active and whose token decrypts:
      `name`, `agency`, `role`, `signInName`, `joinUrl` and `qrSvgDataUri`. Ordered by name. `?id=` (repeatable)
      limits it to those accounts; no `id` means every eligible participant.
- [ ] **Given** the QR, **then** `qrSvgDataUri` is `data:image/svg+xml;base64,…` for an SVG that encodes **exactly**
      the card's `joinUrl` (QRCoder `SvgQRCode`, error correction M, quiet zone included, a `viewBox` so it scales,
      black on white). The SVG contains no `<script>`, no `<image>`, no `href`/`xlink:href` and no external
      reference. A test compares the rendered module matrix to `QRCodeData` generated from the same URL, and the
      SVG is well-formed XML.
- [ ] **Given** a requested or eligible participant who cannot get a card, **then** they appear in `skipped` with
      a reason: `notFound` (unknown **or** from another exercise: identical), `noActiveLink`, `disabled`, or
      `tokenUnrecoverable` (the protected copy no longer decrypts). The request still succeeds with the others.
- [ ] **Given** `Authentication:FrontendBaseUrl` is unset, **then** the endpoint answers `409` ProblemDetails
      ("join links are not configured") and no card is produced; `GET /api/staff/roster` already reports
      `joinLinksAvailable: false` (story 02). **Given** more than `MaxCardsPerRequest` (500) ids, **then** `400`.
- [ ] **Given** any successful response, **then** it carries `Cache-Control: no-store` (it contains credentials).

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** only the caller's exercise's links are read (central filter); an `id` from
      another exercise yields the same `notFound` skip as an unknown id, with no difference in status or body.
      Extends the standing suite.
- [ ] **Telemetry (XC-004):** one `roster.cards.generated` event per request with the card count (staff actor with
      role and acting human), in one unit of work. No URL, token or name in the payload.
- [ ] **Authorization (EL-13):** behind `EngineCockpitStaffAuthorizationFilter` + `RosterStaffRoleFilter`: 401 with
      no staff session, 403 for an evaluator or an unassigned user; a participant session never reaches it.
- [ ] **Content security (NFR-004):** names are returned as plain strings for the page to render as text (they were
      sanitized at ingest in story 02); the SVG is generated server-side from the URL only, never from user text.

## Out of Scope

Printing and the page layout (story 12). Issuing or rotating links (03). Embedding a logo or the exercise brand in
the QR. PNG output. Server-side PDF generation. Emailing (13).

## Technical Notes

Backend. New folder `Features/Identity/LinkCards/`: `LinkCardEndpoints`, `LinkCardService`, `QrSvgRenderer`
(`AddLinkCards()` / `MapLinkCardEndpoints()`). Use only QRCoder's cross-platform renderers: `QRCodeGenerator`,
`QRCodeData`, `SvgQRCode` with the **string-colour** `GetGraphic` overload (the `System.Drawing.Color` overloads are
Windows-only) and `SizingMode.ViewBoxAttribute`. The `QRCoder` package reference is added by story 01 (so the csproj is not contended);
pin the version it chose. Reuse `JoinUrlBuilder`, `IParticipantLinkTokenProtector`, `ExerciseFactsReader` and
`RosterLinkDtoFactory`. Register the literal `/api/staff/roster/cards` route; it must not collide with story 03's
`{id:guid}` routes (`guid` constraint). Keep the service allocation-light: 100 cards is the normal case, 500 the cap.
See `implementation.md` (story 04, gotchas 3, 5).

## Dependencies

Story 01 (protector, URL builder, DTOs, QRCoder reference). Reads data created by 02/03 but is testable alone by
seeding `ParticipantLink` rows. Consumed by story 12.

## Tests

`Pulse.WebApi.Tests/Features/Identity/LinkCards/`: `QrSvgRendererTests` (matrix equals QRCoder's for the URL,
well-formed, no script/href/image), `LinkCardServiceTests` (eligible, each skip reason, join base unset,
>500, `id` filter), `LinkCardEndpointsHttpTests` (200/400/409/401/403, `no-store`),
`LinkCardIsolationTests` (`[RequiresDockerFact]`: cross-exercise id is `notFound`), `LinkCardTelemetryTests`.
Manual check in UAT: scan a card QR with a phone camera (see `feature.md` walk-through step 4).

### Test linkage

AC numbers follow the order of the criteria above: AC-1 the 200 sheet, AC-2 the QR, AC-3 the skip reasons, AC-4 the
409 and 400, AC-5 `no-store`; then AC-6 Isolation, AC-7 Telemetry, AC-8 Authorization, AC-9 Content security. The
route is `POST` with `{ participantIds }` or `{ all: true }` (EL-20, Gate-1 W-1/W-2), so "`?id=` limits it / no `id`
means everyone" in AC-1 reads as "`participantIds` limits it / `all: true` means everyone". Shared seeding and the
frontend-gate mirror live in `LinkCardTestWorld` (`FrontendQrGate` is `safeQrDataUri.ts`'s regex and 512 KB cap,
transcribed); the HTTP suite runs on a self-hosted `LinkCardTestHost` with the real filters and the real token-backed
`CurrentStaffSessionAccessor` (TestServer, or real Kestrel on a loopback port for the request-limit tests), because
`Program.cs` does not map the route until the seam commit.

- **AC-1** `LinkCardServiceTests.EligibleParticipants_GetACardEach_WithEveryField_OrderedByName`,
  `.AllTrue_MeansEveryParticipant_AndEveryoneWithoutACard_IsSkippedWithTheReason`, `.Ids_LimitTheSheet_ToThoseAccounts`,
  `.ARepeatedId_GivesOneCard`, `.TheService_ChangesNoLink`; `LinkCardEndpointsHttpTests.AController_Gets200_InTheFrozenShape_WithNoStore`,
  `.APlanner_Gets200`, `.ParticipantIds_LimitTheSheet_DeduplicatedCaseInsensitively`, `.OnRealKestrel_500Ids_Is200`,
  `.OnlyPost_IsMapped_TheOldGetIsGone`.
- **AC-2** `QrSvgRendererTests.TheRenderedModuleMatrix_EqualsQRCodersMatrix_ForTheSameUrl_AtErrorCorrectionM`,
  `.TheRenderedMatrix_IsNotTheMatrixOfAnyOtherErrorCorrectionLevel`, `.AnotherUrl_GivesAnotherMatrix`,
  `.TheSvg_IsWellFormedXml_WithAViewBoxTheSizeOfTheMatrix_AndNoWidthOrHeight`,
  `.TheSvg_IsBlackModulesOnAWhiteBackground_ThatCoversTheWholeCode`, `.TheQuietZone_IsDrawn_AndHoldsNoDarkModule`,
  `.TheSvg_HasNoScriptImageHrefOrExternalReference`, `.TheDataUri_IsTheBase64OfTheUtf8Svg`,
  `.TheDataUri_PassesTheFrontendGate_RegexAndSizeCap`, `.AnEmptyUrl_IsRefused`,
  `.TheRenderer_IsTheCrossPlatformSvgPath_NeverSystemDrawing`;
  `LinkCardServiceTests.EveryCardsQr_EncodesItsOwnJoinUrl_AndPassesTheFrontendGate`;
  `LinkCardSourceGuardTests.TheLinkCardSlice_NeverReferencesSystemDrawing_TheBitmapRenderers_OrColor`,
  `.TheGuard_CatchesTheThingsItBans`.
- **AC-3** `LinkCardServiceTests.EachSkipReason_IsReported_AndTheRequestStillSucceedsWithTheOthers` (`noActiveLink`
  for no link and revoked, `disabled` with and without a link, `tokenUnrecoverable` for a lost key ring, a stale copy
  and no copy, `notFound`), `.MalformedOrBlankIds_AreNotFound_AndNeverWidenToEveryone`;
  `LinkCardEndpointsHttpTests.ABlankOrMalformedId_IsANotFoundSkip_EchoedBack_NeverEveryone`.
- **AC-4** `LinkCardServiceTests.UnsetJoinBase_IsJoinLinksUnavailable_AndNoCardIsProduced`,
  `.AJoinBaseThatDisappearsMidRequest_IsJoinLinksUnavailable_NotAPartialSheet`,
  `.MoreIdsThanTheCap_IsTooManyIds_AndExactlyTheCapIsFine`, `.EveryIllShapedBody_IsInvalid_AndReadsNothing`;
  `LinkCardEndpointsHttpTests.NoJoinBase_Is409ProblemDetails_WithNoStore_AndNoCard`,
  `.MoreThan500Ids_Is400ProblemDetails_WithNoStore`, `.EveryOtherBodyShape_Is400ProblemDetails_WithNoStore` (26 shapes:
  unknown, mis-cased, repeated or old-spelling properties, both, neither, empty array, `all` not `true`, wrong types,
  null ids, trailing content, comments, non-object roots, JSON `null`, empty, malformed, non-JSON content types),
  `.OnRealKestrel_ABodyOver64KiB_Is413ProblemDetails_WithNoStore`.
- **AC-5** `LinkCardEndpointsHttpTests.AController_Gets200_InTheFrozenShape_WithNoStore` (and every 400/409/413 test above).
- **AC-6** `LinkCardIsolationTests.AnIdFromAnotherExercise_IsNotFound_ExactlyLikeAnUnknownId`,
  `.Everyone_MeansEveryoneInTheCallersExercise_Only`, `.MixedRequest_GivesCardsOnlyForTheCallersExercise`,
  `.TheExerciseName_IsTheCallersExercise`, `.AControllerOfB_ScopedToA_GetsNothingFromEither`,
  `.AnUnsetOrEmptyScope_ReadsNothing_AndWritesNothing`, `.TheSameAccountRead_UnderTheCentralFilter_IsInvisibleCrossExercise`;
  `LinkCardEndpointsHttpTests.ACrossExerciseId_AndAnUnknownId_GiveTheSameStatusAndBody`.
- **AC-7** `LinkCardTelemetryTests.ASuccessfulRequest_EmitsOneEvent_WithTheCountAndAStaffActor`,
  `.TheScenarioTime_IsTheLiveExerciseClock_WhenItRuns`, `.ARequestThatProducesNoCard_StillEmitsOneEvent_WithCountZero`,
  `.TwoRequests_AreTwoEvents`, `.NoUrlTokenOrName_EverReachesTheEvent`, `.ARefusedRequest_EmitsNothing`,
  `.TheEvent_PassesTheEnvelopeRules`.
- **AC-8** `LinkCardEndpointsHttpTests.AnEvaluator_Is403`, `.AStaffUserNotAssignedToTheExercise_Is403`,
  `.AParticipantSession_NeverReachesIt_401`, `.AnUnresolvedScope_Is401`, `.NoCredential_Is401_BeforeTheBodyOrTheDatabaseIsTouched`,
  `.ComposedIntoTheRealProgramHost_AddLinkCardsAlone_ResolvesTheService`;
  `LinkCardServiceTests.NoStaffSession_OrAnUnresolvedScope_IsUnauthenticated`, `.AnEvaluator_OrAnUnassignedStaffUser_IsForbidden`,
  `.AddLinkCards_IsIdempotent_WithTheRightLifetimes`, `.AddLinkCards_BringsTheEasyLoginKernel_SoAMissingSeamLineCannot500`,
  `.AddLinkCards_NeverDisplacesAReplacedLinkIssuer_WhicheverRunsFirst`.
- **AC-9** `QrSvgRendererTests.TheSvg_NeverCarriesTheUrlItself_OnlyModuleGeometry`, `.TheSvg_HasNoScriptImageHrefOrExternalReference`;
  `LinkCardServiceTests.EligibleParticipants_GetACardEach_WithEveryField_OrderedByName` (names returned verbatim).
