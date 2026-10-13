namespace Pulse.WebApi.Features.Injects;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Builds the ONE server-side XC-004 <c>inject_action</c> event per queue action (IQ-8), against the locked v0
/// envelope. The caller adds it to the same <c>SaveChanges</c> as the state change it describes, so an action and its
/// event land together or not at all. The console emits nothing for these actions — one emitter, no double count.
/// </summary>
/// <remarks>
/// <para>
/// <b>Shape:</b> <c>eventType: inject_action</c>, <c>channel: system</c>, <c>actor { kind: system, actingHumanId }</c>
/// (the staff user from the server-side session, COR-018), <c>injectId</c> = the item id,
/// <c>target { entityType: inject, entityId }</c>, server wall-clock + exercise scenario time + time zone, and an
/// opaque camelCase <c>payload { action, kind, status }</c> where <c>status</c> is the item's status AFTER the action.
/// </para>
/// <para>
/// <b><c>origin</c> is deliberately omitted.</b> It is the provenance of CONTENT (a post); a queue action is not
/// content. The posts the queue publishes carry their own <c>post</c>/<c>reply</c> event with <c>origin: inject</c>
/// and the same <c>injectId</c>, which is what links an action to what it published.
/// </para>
/// <para>
/// <b>Reorder</b> touches the whole queue rather than one item, so it carries no <c>injectId</c>; its target is
/// <c>{ entityType: inject-queue, entityId: exerciseId }</c> and its payload is <c>{ action: reorder }</c>.
/// </para>
/// </remarks>
public static class InjectTelemetry
{
    /// <summary>The XC-004 event type.</summary>
    public const string EventType = "inject_action";

    /// <summary>The XC-004 channel for staff queue actions.</summary>
    public const string Channel = "system";

    /// <summary>The actor kind for a staff action taken through the console.</summary>
    public const string ActorKind = "system";

    /// <summary>The target entity type for an item action.</summary>
    public const string ItemEntityType = "inject";

    /// <summary>The target entity type for a whole-queue action (reorder).</summary>
    public const string QueueEntityType = "inject-queue";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Builds the event for an action on one item.</summary>
    /// <param name="item">The item AFTER the action (its kind and status go into the payload).</param>
    /// <param name="action">The action literal (<see cref="InjectActions"/>).</param>
    /// <param name="actingHumanId">The staff user who took the action (server-derived).</param>
    /// <param name="time">The one clock read shared with the state change.</param>
    /// <param name="eventId">
    /// A pre-assigned event id (a controller claim's), so the event can be emitted by whichever save resolves the claim
    /// and never twice; <c>null</c> mints a fresh one.
    /// </param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForItem(
        InjectItem item,
        string action,
        Guid actingHumanId,
        InjectEventTime time,
        string? eventId = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentNullException.ThrowIfNull(time);

        var itemId = item.Id.ToString();
        return Build(
            eventId ?? Guid.NewGuid().ToString(),
            item.ExerciseId,
            actingHumanId,
            time,
            injectId: itemId,
            new TelemetryTarget { EntityType = ItemEntityType, EntityId = itemId },
            new InjectActionPayload(action, item.Kind, item.Status));
    }

    /// <summary>Builds the event for a whole-queue reorder.</summary>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="actingHumanId">The staff user who reordered (server-derived).</param>
    /// <param name="time">The one clock read shared with the state change.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForReorder(Guid exerciseId, Guid actingHumanId, InjectEventTime time)
    {
        ArgumentNullException.ThrowIfNull(time);

        return Build(
            Guid.NewGuid().ToString(),
            exerciseId,
            actingHumanId,
            time,
            injectId: null,
            new TelemetryTarget { EntityType = QueueEntityType, EntityId = exerciseId.ToString() },
            new InjectActionPayload(InjectActions.Reorder, Kind: null, Status: null));
    }

    private static TelemetryEvent Build(
        string eventId,
        Guid exerciseId,
        Guid actingHumanId,
        InjectEventTime time,
        string? injectId,
        TelemetryTarget target,
        InjectActionPayload payload) => new()
        {
            EventId = eventId,
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = EventType,
            Channel = Channel,
            Actor = new TelemetryActor
            {
                Kind = ActorKind,
                ActingHumanId = actingHumanId.ToString(),
            },
            InjectId = injectId,
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = target,
            Payload = JsonSerializer.Serialize(payload, PayloadOptions),
            EmittedAt = time.WallClock,
        };

    /// <summary>The opaque payload — camelCase by explicit property names, never parsed server-side.</summary>
    private sealed record InjectActionPayload(
        [property: JsonPropertyName("action")] string Action,
        [property: JsonPropertyName("kind")] string? Kind,
        [property: JsonPropertyName("status")] string? Status);
}

/// <summary>
/// The one clock read an action shares between its state change and its telemetry event: the server wall clock,
/// the exercise scenario instant (COR-053) and the exercise time zone (XC-008).
/// </summary>
/// <param name="WallClock">The server wall-clock instant (never client input).</param>
/// <param name="ScenarioTime">The exercise scenario instant (never client input).</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
public sealed record InjectEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone);
