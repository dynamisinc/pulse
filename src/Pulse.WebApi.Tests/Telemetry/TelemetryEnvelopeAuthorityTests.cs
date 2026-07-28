namespace Pulse.WebApi.Tests.Telemetry;

using System;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Telemetry;

/// <summary>
/// Story <c>identity-auth-roles/13</c> (#362) — <see cref="TelemetryEnvelopeAuthority"/>, the rule set that makes
/// a <c>POST /api/telemetry</c> envelope's exercise scope and actor identity server-authoritative. Unit-level and
/// host-free: the HTTP wiring, the ordering against v0 validation, and the persisted round-trip are asserted by
/// <see cref="TelemetryIngestTests"/>.
/// </summary>
/// <remarks>
/// The forgeries these tests reproduce are the ones <c>ENDPOINT-AUTH-AUDIT.md</c> finding 2 confirmed against the
/// sandbox: an <c>exerciseId</c> naming an exercise that does not exist, a fabricated
/// <c>actor.kind: 'participant'</c>, and a fabricated <c>actingHumanId</c> — the last two being the fields AAR and
/// evaluator scoring attribute actions to individual humans with (COR-018).
/// </remarks>
public class TelemetryEnvelopeAuthorityTests
{
    private static readonly Guid SessionExercise = Guid.Parse("11111111-0000-4000-8000-000000000001");
    private static readonly Guid OtherExercise = Guid.Parse("22222222-0000-4000-8000-000000000002");
    private static readonly Guid BoundPersona = Guid.Parse("33333333-0000-4000-8000-000000000003");
    private static readonly Guid CallerSessionId = Guid.Parse("44444444-0000-4000-8000-000000000004");

    private const string CallerPrincipalId = "account-of-the-caller";
    private const string CallerActingHumanId = "human-of-the-caller";

    // ==========================================================================================
    // Scope: server-stamped, and a disagreeing body is refused rather than corrected.
    // ==========================================================================================

    [Fact]
    public void AgreeingBodyExerciseId_ResolvesToTheSessionsOwnScope()
    {
        var request = Envelope(exerciseId: SessionExercise.ToString());

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        result.ExerciseId.Should().Be(
            SessionExercise,
            "even when the body agrees, the persisted scope comes from the session — the body value is never the "
            + "source, so a future client that stops sending it changes nothing");
    }

    [Fact]
    public void AbsentBodyExerciseId_IsNotRejectedHere_AndStillResolves()
    {
        // A missing exerciseId is a v0 SHAPE error, reported by TelemetryEventRequest.Validate() alongside every
        // other shape error. Rejecting it here too would produce a misleading "disagrees with your session"
        // message for a caller that simply sent an incomplete envelope.
        var request = Envelope(exerciseId: null);

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        result.ExerciseId.Should().Be(SessionExercise);
    }

    [Fact]
    public void BodyExerciseIdNamingAnotherExercise_IsRejectedWith400_NotSilentlyOverwritten()
    {
        var request = Envelope(exerciseId: OtherExercise.ToString());

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(
            StatusCodes.Status400BadRequest,
            "a body that disagrees with its own session is either a client bug worth surfacing or an attempted "
            + "forgery; silently correcting it tells neither apart");
    }

    [Fact]
    public void BodyExerciseIdNamingANonexistentExercise_IsRejectedWith400()
    {
        // The audit's literal payload: an exercise id that names no exercise at all. There is no FK on
        // TelemetryEvent.ExerciseId (house style — no IExerciseScoped entity has one), so before this story the
        // orphan row was storable rather than merely rejected-but-logged.
        var request = Envelope(exerciseId: "deadbeef-0000-4000-8000-000000000001");

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public void BodyExerciseIdThatIsNotAGuid_IsRejectedWith400()
    {
        var request = Envelope(exerciseId: "not-a-guid-at-all");

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(
            StatusCodes.Status400BadRequest,
            "an unparseable scope cannot name the caller's exercise any more than another exercise's id can");
    }

    [Fact]
    public void ResolvedScopeDisagreeingWithTheSessionBinding_IsRejectedWith403()
    {
        // SessionAuthenticationMiddleware already binds a participant session's exercise to the host-resolved one
        // and fails closed on a mismatch, so this should be unreachable — and if it ever happens it must NOT be
        // resolved in favour of writing a row (COR-001, the same defense in depth PostAttributionResolver keeps).
        var request = Envelope(exerciseId: SessionExercise.ToString());

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), resolvedScope: OtherExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void UnresolvedRequestScope_DoesNotBlockTheSessionsOwnAuthority(string? scope)
    {
        // null and Guid.Empty both mean "nothing was resolved independently of the session". The session's own
        // binding is the authority, so neither is a rejection — but neither can be STAMPED either, which is why
        // the resolved outcome below is the session's exercise and never the empty sentinel.
        var request = Envelope(exerciseId: SessionExercise.ToString());

        var result = TelemetryEnvelopeAuthority.Apply(
            request, Participant(), scope is null ? null : Guid.Parse(scope));

        result.IsResolved.Should().BeTrue();
        result.ExerciseId.Should().Be(SessionExercise);
    }

    // ==========================================================================================
    // Actor identity: stamped from the session, and a claim about WHO THE CALLER IS is refused.
    // ==========================================================================================

    [Fact]
    public void ForgedActingHumanId_IsOverwrittenWithTheSessionsOwn()
    {
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "persona",
            PersonaId = BoundPersona.ToString(),
            ActingHumanId = "human-somebody-else-entirely",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue(
            "overwriting, not rejecting: a console sends whatever identity string it holds, and refusing the "
            + "write over a field the server does not trust anyway would break a legitimate operator");
        request.Actor!.ActingHumanId.Should().Be(
            CallerActingHumanId, "COR-018 attribution is the session's own, whatever the body claimed");
    }

    [Fact]
    public void ForgedSessionId_IsOverwrittenWithTheCallersRealSessionId()
    {
        var request = Envelope(actor: new ActorRequest { Kind = "system", SessionId = "session-of-someone-else" });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.SessionId.Should().Be(
            CallerSessionId.ToString(), "actor.sessionId is the COR-015 reach-counting key and must be trustworthy");
    }

    [Fact]
    public void AbsentSessionIdAndActingHumanId_AreStampedRatherThanLeftEmpty()
    {
        var request = Envelope(actor: new ActorRequest { Kind = "system" });

        TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        request.Actor!.SessionId.Should().Be(CallerSessionId.ToString());
        request.Actor.ActingHumanId.Should().Be(CallerActingHumanId);
    }

    [Fact]
    public void ForgedParticipantId_FromAParticipantSession_IsOverwrittenWithItsOwnPrincipal()
    {
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "participant",
            ParticipantId = "account-of-another-trainee",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.ParticipantId.Should().Be(
            CallerPrincipalId,
            "attributing a view or an action to ANOTHER trainee inside the same exercise is evaluation-record "
            + "forgery even though it discloses nothing");
    }

    [Fact]
    public void ParticipantIdClaimedByAStaffSession_IsDropped()
    {
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "system",
            ParticipantId = "account-of-a-trainee",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Staff(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.ParticipantId.Should().BeNull(
            "a staff console has no participant to be, so the claim is dropped rather than stored");
    }

    [Fact]
    public void ParticipantIdClaimedByAReadOnlySession_IsDropped_ButItsSessionIdStillCountsReach()
    {
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "system",
            ParticipantId = "account-of-a-trainee",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, ReadOnly(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.ParticipantId.Should().BeNull();
        request.Actor.SessionId.Should().Be(
            CallerSessionId.ToString(),
            "COR-015 counts a shared read-only observer's reach by session, which is exactly why dropping its "
            + "participantId does not make its view events unrepresentable");
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("readonly")]
    [InlineData("some-future-kind-nobody-has-invented-yet")]
    public void ActorKindParticipant_FromANonParticipantSession_IsRejectedWith403(string sessionKind)
    {
        // The audit's confirmed forgery. Refused rather than corrected: there is no participant to substitute, and
        // an operator's (or observer's) event that reads as a trainee's is the COR-018 harm itself. Matched by a
        // POSITIVE test on the session kind, so an unrecognised future kind fails closed too.
        var request = Envelope(actor: new ActorRequest { Kind = "participant", ParticipantId = "p-1" });

        var result = TelemetryEnvelopeAuthority.Apply(request, Identity(kind: sessionKind), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Theory]
    [InlineData("persona")]
    [InlineData("system")]
    [InlineData("engine")]
    public void OtherActorKinds_AreLeftCallerStated(string actorKind)
    {
        // The v0 actor kinds are FICTION-level descriptors, not session kinds, and real emitters cross them: a
        // participant session emits 'persona' for a reaction (useReaction.ts) and a staff console emits
        // 'engine'/'system' (useEngineControl.ts, usePauseState.ts). Deriving the kind from the session kind would
        // refuse every one of those, so only the 'participant' CLAIM is policed.
        var request = Envelope(actor: new ActorRequest
        {
            Kind = actorKind,
            PersonaId = actorKind == "persona" ? BoundPersona.ToString() : null,
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Staff(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.Kind.Should().Be(actorKind);
    }

    [Fact]
    public void PersonaIdMatchingTheSessionBinding_IsAccepted()
    {
        var request = Envelope(actor: new ActorRequest { Kind = "persona", PersonaId = BoundPersona.ToString() });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue();
        request.Actor!.PersonaId.Should().Be(BoundPersona.ToString());
    }

    [Fact]
    public void PersonaIdOtherThanTheSessionBinding_FromANonStaffSession_IsRejectedWith403()
    {
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "persona",
            PersonaId = "99999999-0000-4000-8000-000000000009",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(
            StatusCodes.Status403Forbidden,
            "naming another cast member's persona would attribute an action to a trainee who never took it");
    }

    [Fact]
    public void PersonaIdFromANonStaffSessionWithNoPersonaBinding_IsRejectedWith403()
    {
        var request = Envelope(actor: new ActorRequest { Kind = "persona", PersonaId = BoundPersona.ToString() });

        var result = TelemetryEnvelopeAuthority.Apply(request, Identity(kind: "participant"), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(
            StatusCodes.Status403Forbidden,
            "a session bound to no persona can vouch for no persona — fail closed rather than believe the body");
    }

    [Fact]
    public void PersonaIdThatIsNotAGuid_FromANonStaffSession_IsRejectedWith403()
    {
        var request = Envelope(actor: new ActorRequest { Kind = "persona", PersonaId = "not-a-guid" });

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeFalse();
        result.RejectionStatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public void PersonaIdChosenByAStaffSession_IsAccepted_ForE7PersonaOperation()
    {
        // Staff is the one kind allowed to name a persona other than its own binding: E7 persona-operation lets a
        // controller act AS a cast persona. Validating that CHOICE against the exercise's cast is
        // PostAttributionResolver's job on the write path, not this envelope's.
        var request = Envelope(actor: new ActorRequest
        {
            Kind = "persona",
            PersonaId = "99999999-0000-4000-8000-000000000009",
        });

        var result = TelemetryEnvelopeAuthority.Apply(request, Staff(), SessionExercise);

        result.IsResolved.Should().BeTrue();
    }

    [Fact]
    public void AnAbsentActorBlock_IsLeftToShapeValidation_NotAnException()
    {
        var request = Envelope();
        request.Actor = null;

        var result = TelemetryEnvelopeAuthority.Apply(request, Participant(), SessionExercise);

        result.IsResolved.Should().BeTrue("a missing actor block is a v0 shape error Validate() reports");
        request.Actor.Should().BeNull();
    }

    [Fact]
    public void AnEmptyScope_IsNeverAResolvedOutcome()
    {
        var resolve = () => TelemetryAuthorityResolution.Resolved(Guid.Empty);

        resolve.Should().Throw<ArgumentOutOfRangeException>(
            "Guid.Empty is the fail-closed sentinel the write-guard rejects; treating it as resolved would turn a "
            + "clean rejection into a 500");
    }

    // ==========================================================================================
    // Fixtures
    // ==========================================================================================

    /// <summary>A live participant session bound to <see cref="BoundPersona"/> — the trainee composer's shape.</summary>
    private static SessionIdentity Participant() => Identity(kind: "participant", personaId: BoundPersona);

    /// <summary>A live staff session — no persona binding today (E7 persona-operation adds one).</summary>
    private static SessionIdentity Staff() => Identity(kind: "staff", staffUserId: Guid.NewGuid());

    /// <summary>A live shared read-only session (COR-015) — never carries a persona binding.</summary>
    private static SessionIdentity ReadOnly() => Identity(kind: "readonly");

    /// <summary>
    /// A session identity. <paramref name="personaId"/> defaults to <c>null</c> deliberately — "bound to no
    /// persona" is a case under test, so it must be expressible rather than silently defaulted to a binding.
    /// </summary>
    private static SessionIdentity Identity(
        string kind,
        Guid? personaId = null,
        Guid? staffUserId = null) => new()
        {
            SessionId = CallerSessionId,
            ExerciseId = SessionExercise,
            Kind = kind,
            PrincipalId = CallerPrincipalId,
            ActingHumanId = CallerActingHumanId,
            StaffUserId = staffUserId,
            PersonaId = personaId,
        };

    /// <summary>
    /// A minimal envelope. Only the fields the authority reads are populated — the v0 shape rules are
    /// <see cref="TelemetryEventRequestTests"/>'s subject, and this type deliberately runs BEFORE validation.
    /// </summary>
    private static TelemetryEventRequest Envelope(
        string? exerciseId = null,
        ActorRequest? actor = null) => new()
        {
            SchemaVersion = "v0",
            EventId = Guid.NewGuid().ToString(),
            ExerciseId = exerciseId ?? SessionExercise.ToString(),
            EventType = "post",
            Channel = "social",
            Actor = actor ?? new ActorRequest { Kind = "system" },
            TimeZone = "America/Chicago",
            WallClockTime = "2033-06-14T15:00:00+00:00",
            ScenarioTime = "2033-06-14T09:00:00-05:00",
            EmittedAt = "2033-06-14T15:00:01+00:00",
        };
}
