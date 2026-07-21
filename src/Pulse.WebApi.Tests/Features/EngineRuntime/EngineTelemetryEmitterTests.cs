namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Text.Json;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Xunit;

/// <summary>
/// Proves the engine telemetry emit helper stamps the LOCKED v0 envelope (schemaVersion, additive engine
/// event types, server-authoritative scope/times, actor, opaque camelCase payload) and null-omits
/// off-envelope empty strings — the emit-side contract stories 01/02 build on. Model-only (<c>[Fact]</c>).
/// </summary>
public class EngineTelemetryEmitterTests
{
    private static EngineTelemetryContext ContextFor(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        WallClockTime = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero),
        ScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
        TimeZone = "America/Chicago",
    };

    [Fact]
    public void BuildEvent_StampsLockedV0Envelope()
    {
        var exerciseId = Guid.NewGuid();
        var emitter = new EngineTelemetryEmitter();

        var telemetry = emitter.BuildEvent(EngineEventTypes.Observed, ContextFor(exerciseId));

        telemetry.SchemaVersion.Should().Be("v0", "engine events are ADDITIVE to the unchanged v0 envelope");
        telemetry.EventType.Should().Be("engine.observed");
        telemetry.ExerciseId.Should().Be(exerciseId);
        telemetry.Channel.Should().Be("social");
        telemetry.Actor.Kind.Should().Be("engine", "the default engine actor");
        telemetry.WallClockTime.Should().Be(new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero));
        telemetry.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        telemetry.TimeZone.Should().Be("America/Chicago");
        telemetry.EmittedAt.Should().Be(telemetry.WallClockTime, "emittedAt shares the single wall-clock read");
        Guid.TryParse(telemetry.EventId, out _).Should().BeTrue("eventId is a fresh uuid dedup key");
    }

    [Fact]
    public void BuildEvent_SerializesPayloadAsOpaqueCamelCaseJson_WithKebabEnum()
    {
        var emitter = new EngineTelemetryEmitter();
        var payload = new EngineEventPayloads.Decided
        {
            Storyline = "22222222-2222-2222-2222-222222222222",
            Personas = new List<string> { "@a", "@b" },
            Count = 2,
            AutonomyLevel = AutonomyLevel.DelayedAuto,
        };

        var telemetry = emitter.BuildEvent(EngineEventTypes.Decided, ContextFor(Guid.NewGuid()), payload);

        telemetry.Payload.Should().NotBeNull();
        using var doc = JsonDocument.Parse(telemetry.Payload!);
        var root = doc.RootElement;
        root.GetProperty("count").GetInt32().Should().Be(2);
        root.GetProperty("autonomyLevel").GetString().Should().Be(
            "delayed-auto", "payload enums use the same frozen kebab literals as the wire DTO");
        // Absent optional fields (toneMix, rateCapState) are null-omitted, not emitted as null.
        root.TryGetProperty("toneMix", out _).Should().BeFalse("null optional payload fields are omitted");
    }

    [Fact]
    public void BuildEvent_ReviewedAction_SerializesKebabActionLiteral()
    {
        var emitter = new EngineTelemetryEmitter();
        var payload = new EngineEventPayloads.Reviewed
        {
            Storyline = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            Action = EngineReviewAction.HoldOnExpiry,
        };

        var telemetry = emitter.BuildEvent(
            EngineEventTypes.Reviewed,
            ContextFor(Guid.NewGuid()) with { Actor = new EngineTelemetryActor { Kind = "engine", ActingHumanId = "human-7" } },
            payload);

        using var doc = JsonDocument.Parse(telemetry.Payload!);
        doc.RootElement.GetProperty("action").GetString().Should().Be(
            "hold-on-expiry", "the auto-HOLD outcome must log its frozen action literal (D5-014/1.1)");
        telemetry.Actor.ActingHumanId.Should().Be("human-7", "COR-018: the human behind the review action is captured");
    }

    [Fact]
    public void BuildEvent_NullOmitsOffEnvelopeEmptyStrings()
    {
        var emitter = new EngineTelemetryEmitter();

        var telemetry = emitter.BuildEvent(
            EngineEventTypes.Generated,
            ContextFor(Guid.NewGuid()) with
            {
                Origin = string.Empty,
                Actor = new EngineTelemetryActor { Kind = "engine", ActingHumanId = string.Empty },
            });

        telemetry.Origin.Should().BeNull("an empty origin is off-envelope and must be null-omitted, never \"\"");
        telemetry.Actor.ActingHumanId.Should().BeNull("an empty actingHumanId is off-envelope (min(1).optional)");
    }

    [Fact]
    public void BuildEvent_NoPayload_LeavesPayloadNull()
    {
        var emitter = new EngineTelemetryEmitter();

        var telemetry = emitter.BuildEvent(EngineEventTypes.Observed, ContextFor(Guid.NewGuid()));

        telemetry.Payload.Should().BeNull("a payload-less event stores a null opaque payload, not \"{}\"");
    }
}
