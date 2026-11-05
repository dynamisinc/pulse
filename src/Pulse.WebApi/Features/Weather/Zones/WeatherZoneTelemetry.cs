namespace Pulse.WebApi.Features.Weather.Zones;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Builds the ONE server-side XC-004 <c>weather_zone_changed</c> event per staff zone create, edit or delete
/// (weather-source story 02; FC-6b vocabulary from foundation story 02), against the locked v0 envelope. The caller adds it
/// to the same <c>SaveChanges</c> as the change, so a mutation and its event land together or not at all.
/// </summary>
/// <remarks>
/// <b>Shape</b> (mirrors <c>OutletTelemetry</c>): <c>channel: weather</c>, <c>actor { kind: system, actingHumanId }</c> (the
/// staff user from the server-side session, COR-018), <c>target { entityType: weather_zone, entityId }</c>, server wall
/// clock + exercise scenario time + time zone, and an opaque camelCase <c>payload { action, slug, isDefault,
/// defaultSlug }</c>. <c>defaultSlug</c> is the exercise's default zone AFTER the action (null when none is left), so a
/// default that moved as a side effect (a new default, or a promotion after deleting the default) is visible in the one
/// event.
/// </remarks>
public static class WeatherZoneTelemetry
{
    /// <summary>The XC-004 event type.</summary>
    public const string EventType = ChannelTelemetryEventTypes.WeatherZoneChanged;

    /// <summary>The XC-004 channel.</summary>
    public const string Channel = ChannelVocabulary.Weather;

    /// <summary>The actor kind for a staff action.</summary>
    public const string ActorKind = "system";

    /// <summary>The target entity type.</summary>
    public const string EntityType = "weather_zone";

    /// <summary>The <c>payload.action</c> for a create.</summary>
    public const string ActionCreate = "create";

    /// <summary>The <c>payload.action</c> for an edit.</summary>
    public const string ActionEdit = "edit";

    /// <summary>The <c>payload.action</c> for a soft delete.</summary>
    public const string ActionDelete = "delete";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Builds the event for a create, edit or delete of one zone.</summary>
    /// <param name="zone">The zone AFTER the action.</param>
    /// <param name="action">The action literal.</param>
    /// <param name="defaultSlug">The exercise's default zone slug after the action, or null.</param>
    /// <param name="actingHumanId">The staff user who took the action (server-derived).</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForZone(
        WeatherZone zone,
        string action,
        string? defaultSlug,
        Guid actingHumanId,
        WeatherZoneEventTime time)
    {
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentNullException.ThrowIfNull(time);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = zone.ExerciseId,
            EventType = EventType,
            Channel = Channel,
            Actor = new TelemetryActor
            {
                Kind = ActorKind,
                ActingHumanId = actingHumanId.ToString(),
            },
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget { EntityType = EntityType, EntityId = zone.Id.ToString() },
            Payload = JsonSerializer.Serialize(
                new ZoneChangedPayload(action, zone.Slug, zone.IsDefault && zone.DeletedAt is null, defaultSlug),
                PayloadOptions),
            EmittedAt = time.WallClock,
        };
    }

    /// <summary>The opaque payload: camelCase by explicit property names, never parsed server-side.</summary>
    private sealed record ZoneChangedPayload(
        [property: JsonPropertyName("action")] string Action,
        [property: JsonPropertyName("slug")] string Slug,
        [property: JsonPropertyName("isDefault")] bool IsDefault,
        [property: JsonPropertyName("defaultSlug")] string? DefaultSlug);
}

/// <summary>
/// The one clock read a zone action shares between its change and its telemetry event: the server wall clock, the exercise
/// scenario instant (COR-053) and the exercise time zone (XC-008).
/// </summary>
/// <param name="WallClock">The server wall-clock instant (never client input).</param>
/// <param name="ScenarioTime">The exercise scenario instant (never client input).</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
public sealed record WeatherZoneEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone);
