namespace Pulse.WebApi.Features.EngineRuntime.Telemetry;

using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Default <see cref="IEngineTelemetryEmitter"/>. Stateless (a pure builder), so it is registered as a
/// singleton. Stamps the locked v0 envelope: a fresh <c>eventId</c>, <c>schemaVersion:'v0'</c>, the
/// server-authoritative scope/times, the actor block, and the opaque camelCase-serialized payload. Absent
/// optional string fields are NULL-OMITTED (never <c>""</c>) — the v0 schema types them as
/// <c>z.string().min(1).optional()</c>, so an empty string is off-envelope and the telemetry/02 sink + E10
/// validators reject it.
/// </summary>
public sealed class EngineTelemetryEmitter : IEngineTelemetryEmitter
{
    /// <summary>
    /// Payload serialization options: camelCase keys (the payload records also carry explicit
    /// <see cref="JsonPropertyNameAttribute"/>s), null-omitted so reserved/optional fields never emit
    /// <c>null</c> noise into the opaque payload.
    /// </summary>
    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <inheritdoc />
    public TelemetryEvent BuildEvent(string eventType, EngineTelemetryContext context, object? payload = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(eventType);
        ArgumentNullException.ThrowIfNull(context);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = context.ExerciseId,
            EventType = eventType,
            Channel = context.Channel,
            Actor = new TelemetryActor
            {
                Kind = context.Actor.Kind,
                ParticipantId = NullIfEmpty(context.Actor.ParticipantId),
                PersonaId = NullIfEmpty(context.Actor.PersonaId),
                ActingHumanId = NullIfEmpty(context.Actor.ActingHumanId),
                SessionId = NullIfEmpty(context.Actor.SessionId),
                Role = NullIfEmpty(context.Actor.Role),
            },
            Origin = NullIfEmpty(context.Origin),
            WallClockTime = context.WallClockTime,
            ScenarioTime = context.ScenarioTime,
            TimeZone = context.TimeZone,
            Target = context.Target is null
                ? null
                : new TelemetryTarget
                {
                    EntityType = NullIfEmpty(context.Target.EntityType),
                    EntityId = NullIfEmpty(context.Target.EntityId),
                },
            Payload = payload is null ? null : JsonSerializer.Serialize(payload, PayloadOptions),
            EmittedAt = context.WallClockTime,
        };
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
