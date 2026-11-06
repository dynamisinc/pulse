namespace Pulse.WebApi.Features.Portal.Config;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// Builds the ONE server-side XC-004 <c>portal_config_changed</c> event per successful staff config write
/// (exercise-portal story 03, PC-6 <see cref="PortalTelemetry.PortalConfigChanged"/>). The caller adds it to the same
/// <c>SaveChanges</c> as the row, so the change and its audit land together or not at all.
/// </summary>
/// <remarks>
/// <b>Shape</b> (the <c>OutletTelemetry</c> pattern): <c>channel: portal</c>, <c>actor { kind: system, actingHumanId }</c>
/// (the staff human from the server-side session, COR-018), <c>target { entityType: portal, entityId: PortalConfig.Id }</c>,
/// server wall clock + exercise scenario time + time zone, and <c>payload { fields }</c>: the changed field NAMES in wire
/// casing, never their values.
/// </remarks>
internal static class PortalConfigTelemetry
{
    /// <summary>The actor kind for a staff action (as <c>outlet_action</c>).</summary>
    public const string ActorKind = "system";

    /// <summary>Builds the event.</summary>
    /// <param name="config">The row AFTER the write.</param>
    /// <param name="fields">The changed field names (wire casing).</param>
    /// <param name="actingHumanId">The staff human (server-derived).</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForChange(
        PortalConfig config,
        IReadOnlyList<string> fields,
        string actingHumanId,
        PortalEventTime time)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(fields);
        ArgumentException.ThrowIfNullOrWhiteSpace(actingHumanId);
        ArgumentNullException.ThrowIfNull(time);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = config.ExerciseId,
            EventType = PortalTelemetry.PortalConfigChanged.EventType,
            Channel = ChannelVocabulary.Portal,
            Actor = new TelemetryActor { Kind = ActorKind, ActingHumanId = actingHumanId },
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget
            {
                EntityType = PortalTelemetry.PortalConfigChanged.EntityType,
                EntityId = config.Id.ToString(),
            },
            Payload = JsonSerializer.Serialize(new ChangedPayload(fields)),
            EmittedAt = time.WallClock,
        };
    }

    private sealed record ChangedPayload([property: JsonPropertyName("fields")] IReadOnlyList<string> Fields);
}

/// <summary>The one clock read a config write shares between its row and its event.</summary>
/// <param name="WallClock">The server wall clock (never client input).</param>
/// <param name="ScenarioTime">The exercise scenario instant (COR-053).</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
internal sealed record PortalEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone);
