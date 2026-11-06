namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Builds the ONE server-side XC-004 <c>outlet_action</c> event per staff outlet mutation (channels-foundation story 03,
/// FC-6b), against the locked v0 envelope. The caller adds it to the same <c>SaveChanges</c> as the change it
/// describes, so a mutation and its event land together or not at all. The admin UI emits nothing for these actions.
/// </summary>
/// <remarks>
/// <para>
/// <b>Shape</b> (mirrors <c>InjectTelemetry</c>): <c>eventType: outlet_action</c>, <c>channel: system</c>,
/// <c>actor { kind: system, actingHumanId }</c> (the staff user from the server-side session, COR-018),
/// <c>target { entityType: outlet, entityId }</c>, server wall clock + exercise scenario time + time zone, and an opaque
/// camelCase <c>payload { action, channelId }</c>. A defaults-created outlet adds <c>source: "defaults"</c>. No
/// <c>origin</c>: an outlet is configuration, not content.
/// </para>
/// <para>
/// <b>Reorder</b> touches a whole channel, but the AC fixes <c>target.entityType</c> as <c>outlet</c>; so its ONE event
/// targets the FIRST outlet of the new order and carries the full order as <c>payload.ids</c>.
/// </para>
/// </remarks>
public static class OutletTelemetry
{
    /// <summary>The XC-004 event type.</summary>
    public const string EventType = ChannelTelemetryEventTypes.OutletAction;

    /// <summary>The XC-004 channel for staff outlet actions.</summary>
    public const string Channel = "system";

    /// <summary>The actor kind for a staff action.</summary>
    public const string ActorKind = "system";

    /// <summary>The target entity type.</summary>
    public const string EntityType = "outlet";

    /// <summary>The <c>payload.action</c> for a create.</summary>
    public const string ActionCreate = "create";

    /// <summary>The <c>payload.action</c> for an edit.</summary>
    public const string ActionEdit = "edit";

    /// <summary>The <c>payload.action</c> for a soft delete.</summary>
    public const string ActionDelete = "delete";

    /// <summary>The <c>payload.action</c> for a reorder.</summary>
    public const string ActionReorder = "reorder";

    /// <summary>The <c>payload.source</c> of an outlet created by "add default outlets".</summary>
    public const string SourceDefaults = "defaults";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Builds the event for a create, edit or delete of one outlet.</summary>
    /// <param name="outlet">The outlet AFTER the action.</param>
    /// <param name="action">The action literal.</param>
    /// <param name="actingHumanId">The staff user who took the action (server-derived).</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <param name="source">An optional <c>payload.source</c> (<see cref="SourceDefaults"/>).</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForOutlet(
        Outlet outlet,
        string action,
        Guid actingHumanId,
        OutletEventTime time,
        string? source = null)
    {
        ArgumentNullException.ThrowIfNull(outlet);
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentNullException.ThrowIfNull(time);

        return Build(
            outlet.ExerciseId,
            outlet.Id,
            actingHumanId,
            time,
            new OutletActionPayload(action, outlet.ChannelId, source, Ids: null));
    }

    /// <summary>Builds the ONE event for a channel reorder (target = the first outlet of the new order).</summary>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="channelId">The reordered channel.</param>
    /// <param name="orderedIds">The new order (non-empty).</param>
    /// <param name="actingHumanId">The staff user who reordered (server-derived).</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForReorder(
        Guid exerciseId,
        string channelId,
        IReadOnlyList<Guid> orderedIds,
        Guid actingHumanId,
        OutletEventTime time)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(channelId);
        ArgumentNullException.ThrowIfNull(orderedIds);
        ArgumentNullException.ThrowIfNull(time);
        if (orderedIds.Count == 0)
        {
            throw new ArgumentException("A reorder event needs at least one outlet.", nameof(orderedIds));
        }

        return Build(
            exerciseId,
            orderedIds[0],
            actingHumanId,
            time,
            new OutletActionPayload(ActionReorder, channelId, Source: null, orderedIds.Select(id => id.ToString()).ToList()));
    }

    private static TelemetryEvent Build(
        Guid exerciseId,
        Guid outletId,
        Guid actingHumanId,
        OutletEventTime time,
        OutletActionPayload payload) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
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
            Target = new TelemetryTarget { EntityType = EntityType, EntityId = outletId.ToString() },
            Payload = JsonSerializer.Serialize(payload, PayloadOptions),
            EmittedAt = time.WallClock,
        };

    /// <summary>The opaque payload: camelCase by explicit property names, never parsed server-side.</summary>
    private sealed record OutletActionPayload(
        [property: JsonPropertyName("action")] string Action,
        [property: JsonPropertyName("channelId")] string ChannelId,
        [property: JsonPropertyName("source")] string? Source,
        [property: JsonPropertyName("ids")] IReadOnlyList<string>? Ids);
}

/// <summary>
/// The one clock read an outlet action shares between its change and its telemetry event: the server wall clock, the
/// exercise scenario instant (COR-053) and the exercise time zone (XC-008).
/// </summary>
/// <param name="WallClock">The server wall-clock instant (never client input).</param>
/// <param name="ScenarioTime">The exercise scenario instant (never client input).</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
public sealed record OutletEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone);
