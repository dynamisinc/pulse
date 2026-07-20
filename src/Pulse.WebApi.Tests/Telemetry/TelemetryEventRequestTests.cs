namespace Pulse.WebApi.Tests.Telemetry;

using System;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Telemetry;

/// <summary>
/// Fast, container-free unit tests for the server-side v0 request model
/// (<see cref="TelemetryEventRequest"/>) — the defense-in-depth validator that does NOT trust the client
/// <c>zod</c> schema. These exercise the JSON-level rejections (malformed / unknown key) and every branch
/// of <see cref="TelemetryEventRequest.Validate"/> including the conditional-requiredness rules transcribed
/// from <c>telemetryEventV0Schema.superRefine</c> (<c>src/frontend/src/core/telemetry/schema.ts</c>).
/// Plain <c>[Fact]</c> — they need no database, so they run everywhere.
/// </summary>
public class TelemetryEventRequestTests
{
    private const string ValidEnvelopeJson = """
        {
          "schemaVersion": "v0",
          "eventId": "11111111-1111-1111-1111-111111111111",
          "exerciseId": "22222222-2222-2222-2222-222222222222",
          "eventType": "post",
          "channel": "social",
          "actor": { "kind": "participant", "participantId": "participant-1", "sessionId": "session-1" },
          "origin": "participant",
          "correlationId": "corr-1",
          "causationId": "cause-1",
          "sequence": 7,
          "source": "social-feed",
          "wallClockTime": "2033-06-14T15:00:00Z",
          "scenarioTime": "2033-06-14T09:00:00-05:00",
          "timeZone": "America/Chicago",
          "target": { "entityType": "post", "entityId": "post-99" },
          "payload": { "text": "hello" },
          "emittedAt": "2033-06-14T15:00:01Z"
        }
        """;

    private static TelemetryEventRequest Parse(string json)
    {
        var request = JsonSerializer.Deserialize<TelemetryEventRequest>(json, TelemetryEventRequest.SerializerOptions);
        request.Should().NotBeNull();
        return request!;
    }

    [Fact]
    public void FullyPopulatedValidEnvelope_HasNoValidationErrors()
    {
        Parse(ValidEnvelopeJson).Validate().Should().BeEmpty();
    }

    [Fact]
    public void MinimalValidEnvelope_HasNoValidationErrors()
    {
        // Only the required fields; every optional/reserved field omitted.
        const string json = """
            {
              "schemaVersion": "v0",
              "eventId": "e-1",
              "exerciseId": "22222222-2222-2222-2222-222222222222",
              "eventType": "login",
              "channel": "system",
              "actor": { "kind": "system" },
              "wallClockTime": "2033-06-14T15:00:00Z",
              "scenarioTime": "2033-06-14T09:00:00-05:00",
              "timeZone": "America/Chicago",
              "emittedAt": "2033-06-14T15:00:00Z"
            }
            """;

        Parse(json).Validate().Should().BeEmpty();
    }

    [Fact]
    public void UnknownTopLevelKey_ThrowsOnDeserialize()
    {
        const string json = """
            {
              "schemaVersion": "v0",
              "eventId": "e-1",
              "exerciseId": "22222222-2222-2222-2222-222222222222",
              "eventType": "post",
              "channel": "social",
              "actor": { "kind": "system" },
              "wallClockTime": "2033-06-14T15:00:00Z",
              "scenarioTime": "2033-06-14T09:00:00-05:00",
              "timeZone": "America/Chicago",
              "emittedAt": "2033-06-14T15:00:00Z",
              "unexpected": "nope"
            }
            """;

        var act = () => JsonSerializer.Deserialize<TelemetryEventRequest>(json, TelemetryEventRequest.SerializerOptions);

        act.Should().Throw<JsonException>("strictObject parity — an unrecognized top-level key is rejected");
    }

    [Fact]
    public void UnknownActorKey_ThrowsOnDeserialize()
    {
        const string json = """
            {
              "schemaVersion": "v0",
              "eventId": "e-1",
              "exerciseId": "22222222-2222-2222-2222-222222222222",
              "eventType": "post",
              "channel": "social",
              "actor": { "kind": "system", "rogue": "x" },
              "wallClockTime": "2033-06-14T15:00:00Z",
              "scenarioTime": "2033-06-14T09:00:00-05:00",
              "timeZone": "America/Chicago",
              "emittedAt": "2033-06-14T15:00:00Z"
            }
            """;

        var act = () => JsonSerializer.Deserialize<TelemetryEventRequest>(json, TelemetryEventRequest.SerializerOptions);

        act.Should().Throw<JsonException>("the nested actor object is also a strictObject");
    }

    [Fact]
    public void ScalarTypeMismatch_ThrowsOnDeserialize()
    {
        // channel as a number, not a string.
        const string json = """
            {
              "schemaVersion": "v0",
              "eventId": "e-1",
              "exerciseId": "22222222-2222-2222-2222-222222222222",
              "eventType": "post",
              "channel": 123,
              "actor": { "kind": "system" },
              "wallClockTime": "2033-06-14T15:00:00Z",
              "scenarioTime": "2033-06-14T09:00:00-05:00",
              "timeZone": "America/Chicago",
              "emittedAt": "2033-06-14T15:00:00Z"
            }
            """;

        var act = () => JsonSerializer.Deserialize<TelemetryEventRequest>(json, TelemetryEventRequest.SerializerOptions);

        act.Should().Throw<JsonException>();
    }

    [Fact]
    public void WrongSchemaVersion_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.SchemaVersion = "v1";

        request.Validate().Should().Contain(e => e.Contains("schemaVersion", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void MissingOrEmptyExerciseId_IsInvalid(string? exerciseId)
    {
        var request = Parse(ValidEnvelopeJson);
        request.ExerciseId = exerciseId;

        request.Validate().Should().Contain(e => e.Contains("exerciseId", StringComparison.Ordinal));
    }

    [Fact]
    public void UnknownChannel_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Channel = "carrier-pigeon";

        request.Validate().Should().Contain(e => e.Contains("channel", StringComparison.Ordinal));
    }

    [Fact]
    public void UnknownActorKind_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Actor!.Kind = "robot";

        request.Validate().Should().Contain(e => e.Contains("actor.kind", StringComparison.Ordinal));
    }

    [Fact]
    public void UnknownOrigin_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Origin = "telepathy";

        request.Validate().Should().Contain(e => e.Contains("origin", StringComparison.Ordinal));
    }

    [Fact]
    public void EmptyOptionalString_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Source = string.Empty;

        request.Validate().Should().Contain(e => e.Contains("source", StringComparison.Ordinal));
    }

    [Fact]
    public void NegativeSequence_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Sequence = -1;

        request.Validate().Should().Contain(e => e.Contains("sequence", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("2033")]
    [InlineData("March 4 2033")]
    [InlineData("2033-06-14")]
    [InlineData("2033-06-14T15:00:00")]
    [InlineData("2033-06-14 15:00:00Z")] // space instead of the ISO 'T' — lenient TryParse would accept it
    [InlineData("06/14/2033 15:00:00 +00:00")] // non-ISO layout the client zod schema rejects
    public void TimestampWithoutIsoOffset_IsInvalid(string badTimestamp)
    {
        var request = Parse(ValidEnvelopeJson);
        request.WallClockTime = badTimestamp;

        request.Validate().Should().Contain(e => e.Contains("wallClockTime", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("2033-06-14T15:00:00Z")]
    [InlineData("2033-06-14T15:00:00.000Z")] // the real emitter's form: new Date().toISOString()
    [InlineData("2033-06-14T15:00:00.1234567Z")]
    [InlineData("2033-06-14T09:00:00-05:00")]
    [InlineData("2033-06-14T15:00:00+00:00")]
    [InlineData("2033-06-14T09:00:00.500-05:00")]
    public void TimestampWithIsoOffset_IsValid(string goodTimestamp)
    {
        var request = Parse(ValidEnvelopeJson);
        request.WallClockTime = goodTimestamp;

        request.Validate().Should().NotContain(e => e.Contains("wallClockTime", StringComparison.Ordinal));
    }

    // --- Conditional requiredness (superRefine parity) --------------------------------------------------

    [Fact]
    public void ParticipantActor_WithoutParticipantId_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Actor!.Kind = "participant";
        request.Actor.ParticipantId = null;
        request.Actor.SessionId = "session-1"; // keep the view rule satisfied so we isolate this rule

        request.Validate().Should().Contain(e => e.Contains("actor.participantId is required", StringComparison.Ordinal));
    }

    [Fact]
    public void PersonaActor_WithoutPersonaId_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Actor!.Kind = "persona";
        request.Actor.PersonaId = null;

        request.Validate().Should().Contain(e => e.Contains("actor.personaId is required", StringComparison.Ordinal));
    }

    [Fact]
    public void ControllerAsPersonaOrigin_WithoutActingHumanId_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Actor!.Kind = "persona";
        request.Actor.PersonaId = "persona-1";
        request.Actor.ActingHumanId = null;
        request.Origin = "controller-as-persona";

        request.Validate().Should().Contain(e => e.Contains("actor.actingHumanId is required", StringComparison.Ordinal));
    }

    [Fact]
    public void InjectOrigin_WithoutInjectId_IsInvalid()
    {
        var request = Parse(ValidEnvelopeJson);
        request.Origin = "inject";
        request.InjectId = null;

        request.Validate().Should().Contain(e => e.Contains("injectId is required", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("view")]
    [InlineData("article_view")]
    public void ViewEvent_WithoutParticipantOrSession_IsInvalid(string eventType)
    {
        var request = Parse(ValidEnvelopeJson);
        request.EventType = eventType;
        request.Actor!.Kind = "system";
        request.Actor.ParticipantId = null;
        request.Actor.SessionId = null;

        request.Validate().Should().Contain(e => e.Contains("view event requires", StringComparison.Ordinal));
    }

    [Fact]
    public void ViewEvent_WithSessionIdOnly_IsValidForTheViewRule()
    {
        var request = Parse(ValidEnvelopeJson);
        request.EventType = "view";
        request.Actor!.Kind = "system";
        request.Actor.ParticipantId = null;
        request.Actor.SessionId = "session-1";

        request.Validate().Should().NotContain(e => e.Contains("view event requires", StringComparison.Ordinal));
    }

    [Fact]
    public void NonObjectPayload_IsInvalid()
    {
        // payload as an array, not an object (z.record expects an object).
        const string json = """
            {
              "schemaVersion": "v0",
              "eventId": "e-1",
              "exerciseId": "22222222-2222-2222-2222-222222222222",
              "eventType": "post",
              "channel": "social",
              "actor": { "kind": "system" },
              "wallClockTime": "2033-06-14T15:00:00Z",
              "scenarioTime": "2033-06-14T09:00:00-05:00",
              "timeZone": "America/Chicago",
              "emittedAt": "2033-06-14T15:00:00Z",
              "payload": [1, 2, 3]
            }
            """;

        Parse(json).Validate().Should().Contain(e => e.Contains("payload", StringComparison.Ordinal));
    }

    [Fact]
    public void ToEntity_CarriesEveryFieldThrough()
    {
        var request = Parse(ValidEnvelopeJson);
        var exerciseId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var entity = request.ToEntity(exerciseId);

        entity.EventId.Should().Be("11111111-1111-1111-1111-111111111111");
        entity.SchemaVersion.Should().Be("v0");
        entity.ExerciseId.Should().Be(exerciseId);
        entity.EventType.Should().Be("post");
        entity.Channel.Should().Be("social");
        entity.Actor.Kind.Should().Be("participant");
        entity.Actor.ParticipantId.Should().Be("participant-1");
        entity.Actor.SessionId.Should().Be("session-1");
        entity.Origin.Should().Be("participant");
        entity.CorrelationId.Should().Be("corr-1");
        entity.CausationId.Should().Be("cause-1");
        entity.Sequence.Should().Be(7);
        entity.Source.Should().Be("social-feed");
        entity.WallClockTime.Should().Be(new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero));
        entity.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        entity.TimeZone.Should().Be("America/Chicago");
        entity.Target!.EntityType.Should().Be("post");
        entity.Target.EntityId.Should().Be("post-99");
        entity.Payload.Should().Contain("hello");
        entity.EmittedAt.Should().Be(new DateTimeOffset(2033, 6, 14, 15, 0, 1, TimeSpan.Zero));
    }
}
