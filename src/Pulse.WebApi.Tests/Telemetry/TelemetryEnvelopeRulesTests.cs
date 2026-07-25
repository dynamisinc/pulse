namespace Pulse.WebApi.Tests.Telemetry;

using FluentAssertions;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Unit tests for <see cref="TelemetryEnvelopeRules"/> — the single-sourced v0 conditional-requiredness rules
/// (XC-004 / COR-018 / COR-015, #356). Pure logic over a value struct: no database, no Docker, so this
/// exhaustive per-rule coverage runs on every machine and in CI. The DB-level wiring (that
/// <c>PulseDbContext.SaveChanges</c> actually applies these and writes no row) is
/// <c>Data/TelemetryEnvelopeGuardTests</c>.
/// </summary>
/// <remarks>
/// These rules mirror <c>telemetryEventV0Schema.superRefine</c> in
/// <c>src/frontend/src/core/telemetry/schema.ts</c>. If a rule changes there, it changes here — that parity is
/// the whole point of having one server-side implementation.
/// </remarks>
public class TelemetryEnvelopeRulesTests
{
    private static TelemetryAttributionFacts Facts(
        string? actorKind = "system",
        string? participantId = null,
        string? personaId = null,
        string? actingHumanId = null,
        string? sessionId = null,
        string? eventType = "login",
        string? origin = null,
        string? injectId = null,
        bool actorPresent = true) =>
        new(actorPresent, actorKind, participantId, personaId, actingHumanId, sessionId, eventType, origin, injectId);

    [Fact]
    public void Validate_ParticipantKindWithoutParticipantId_IsRejected()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(actorKind: "participant"));

        errors.Should().ContainSingle(
            "the v0 envelope conditionally requires participantId when kind is 'participant' — the exact shape a "
            + "failed participant login persisted before #356")
            .Which.Should().Contain("actor.participantId is required");
    }

    [Fact]
    public void Validate_ParticipantKindWithParticipantId_IsAccepted()
    {
        var errors = TelemetryEnvelopeRules.Validate(
            Facts(actorKind: "participant", participantId: "account-1"));

        errors.Should().BeEmpty();
    }

    [Fact]
    public void Validate_IdentitylessAttemptAsSystemKind_IsAccepted()
    {
        // The fix's shape: a failed login attributes NO participant, so the actor is the system.
        var errors = TelemetryEnvelopeRules.Validate(Facts(actorKind: "system"));

        errors.Should().BeEmpty("an identity-less attempt is conformant as a system actor");
    }

    [Fact]
    public void Validate_PersonaKindWithoutPersonaId_IsRejected()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(actorKind: "persona", eventType: "post"));

        errors.Should().ContainSingle().Which.Should().Contain("actor.personaId is required");
    }

    [Fact]
    public void Validate_ControllerAsPersonaWithoutActingHumanId_IsRejected()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(
            actorKind: "persona", personaId: "persona-1", eventType: "post", origin: "controller-as-persona"));

        errors.Should().ContainSingle().Which.Should().Contain("actor.actingHumanId is required");
    }

    [Fact]
    public void Validate_ControllerAsPersonaWithActingHumanId_IsAccepted()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(
            actorKind: "persona", personaId: "persona-1", actingHumanId: "human-1", eventType: "post",
            origin: "controller-as-persona"));

        errors.Should().BeEmpty();
    }

    [Theory]
    [InlineData("view")]
    [InlineData("article_view")]
    public void Validate_ViewWithoutParticipantOrSession_IsRejected(string eventType)
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(eventType: eventType));

        errors.Should().ContainSingle().Which.Should().Contain("for reach counting (COR-015)");
    }

    [Theory]
    [InlineData("view")]
    [InlineData("article_view")]
    public void Validate_ViewWithSessionIdOnly_IsAccepted(string eventType)
    {
        // COR-015: an anonymous shared-credential viewer has a sessionId but no named participant.
        var errors = TelemetryEnvelopeRules.Validate(Facts(eventType: eventType, sessionId: "session-1"));

        errors.Should().BeEmpty();
    }

    [Fact]
    public void Validate_InjectOriginWithoutInjectId_IsRejected()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(origin: "inject"));

        errors.Should().ContainSingle().Which.Should().Contain("injectId is required");
    }

    [Fact]
    public void Validate_InjectOriginWithInjectId_IsAccepted()
    {
        var errors = TelemetryEnvelopeRules.Validate(Facts(origin: "inject", injectId: "inject-1"));

        errors.Should().BeEmpty();
    }

    [Fact]
    public void Validate_CollectsEveryViolation_NotJustTheFirst()
    {
        // A caller reporting a 400 wants all reasons at once, so the rules must not short-circuit.
        var errors = TelemetryEnvelopeRules.Validate(Facts(
            actorKind: "participant", eventType: "view", origin: "inject"));

        errors.Should().HaveCount(3, "participant-without-id, view-without-reach-identity, and inject-without-injectId");
    }

    [Fact]
    public void Validate_AbsentActorBlock_SkipsActorRules_ButStillAppliesOriginRules()
    {
        // An ABSENT actor is a shape error the caller reports separately; adding actor-rule noise on top would
        // be confusing. The origin/injectId rule is not actor-dependent, so it still applies.
        var errors = TelemetryEnvelopeRules.Validate(Facts(
            actorPresent: false, actorKind: null, eventType: "view", origin: "inject"));

        errors.Should().ContainSingle().Which.Should().Contain("injectId is required");
    }

    [Fact]
    public void Validate_EngineActor_IsAccepted()
    {
        // The engine cockpit's own decisions: kind 'engine' carries no conditionally-required id — per-human
        // attribution rides on actingHumanId (COR-018), which is optional at the envelope level.
        var errors = TelemetryEnvelopeRules.Validate(Facts(
            actorKind: "engine", actingHumanId: "human-controller-1", eventType: "engine.reviewed"));

        errors.Should().BeEmpty();
    }

    [Fact]
    public void FromEntity_ReadsTheConditionalInputsOffAPersistedRow()
    {
        var entity = new TelemetryEvent
        {
            EventId = "event-1",
            ExerciseId = Guid.NewGuid(),
            EventType = "post",
            Channel = "social",
            Actor = new TelemetryActor
            {
                Kind = "persona",
                PersonaId = "persona-1",
                ActingHumanId = "human-1",
                SessionId = "session-1",
                ParticipantId = "account-1",
            },
            Origin = "controller-as-persona",
            InjectId = "inject-1",
            TimeZone = "America/Chicago",
        };

        var facts = TelemetryAttributionFacts.FromEntity(entity);

        facts.ActorPresent.Should().BeTrue("a persisted row's actor block is required");
        facts.ActorKind.Should().Be("persona");
        facts.ParticipantId.Should().Be("account-1");
        facts.PersonaId.Should().Be("persona-1");
        facts.ActingHumanId.Should().Be("human-1");
        facts.SessionId.Should().Be("session-1");
        facts.EventType.Should().Be("post");
        facts.Origin.Should().Be("controller-as-persona");
        facts.InjectId.Should().Be("inject-1");
    }
}
