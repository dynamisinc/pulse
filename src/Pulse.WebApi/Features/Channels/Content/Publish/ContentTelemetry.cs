namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Builds the ONE server-side XC-004 event per funnel action (FC-6), against the locked v0 envelope. The funnel adds it
/// to the same <c>SaveChanges</c> as the state change, so an action and its event land together or not at all; the
/// client emits nothing for these (one emitter, no double count).
/// </summary>
/// <remarks>
/// <para>
/// <b>Types.</b> publish and restore → <c>content_published</c>, except a participant-origin publish of a
/// <c>release</c>, which is the existing <c>press_release</c> instead (never both); revise → <c>content_revised</c>;
/// retract and soft delete → <c>content_retracted</c>; schedule and unschedule → <see cref="ContentScheduled"/>.
/// <c>payload.action</c> names the action, so restore/publish and retract/delete stay distinguishable.
/// </para>
/// <para>
/// <b>Envelope.</b> <c>channel</c> = the item's channel; <c>origin</c> and <c>injectId</c> = the CALLER's (the publish
/// call, not whoever drafted the item); <c>actor.actingHumanId</c> = the human behind the call (COR-018). The actor kind
/// follows the origin: <c>participant</c> (with <c>participantId</c> = the acting human, which the write guard requires),
/// <c>engine</c>, or <c>system</c> for a controller or inject action (the <c>InjectTelemetry</c> convention). Target is
/// <c>{ entityType: content_item, entityId }</c>.
/// </para>
/// </remarks>
public static class ContentTelemetry
{
    /// <summary>
    /// The schedule/unschedule event type. FC-6 names no event for a schedule, so this is the funnel's own additive
    /// name (the sink accepts unknown types); folding it into the FC-6b vocabulary is an orchestrator follow-up.
    /// </summary>
    public const string ContentScheduled = "content_scheduled";

    /// <summary>The existing Phase-1 type a participant <c>release</c> publish emits instead of <c>content_published</c>.</summary>
    public const string PressRelease = "press_release";

    /// <summary>The target entity type.</summary>
    public const string EntityType = "content_item";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>The event type for <paramref name="action"/>.</summary>
    /// <param name="action">The funnel action (<see cref="ContentTransitions"/>, or <c>delete</c>).</param>
    /// <param name="item">The item.</param>
    /// <param name="caller">The caller.</param>
    /// <returns>The XC-004 event type.</returns>
    public static string EventTypeFor(string action, ContentItem item, ContentCaller caller)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(caller);

        return action switch
        {
            ContentTransitions.Publish when item.Kind == ChannelVocabulary.KindRelease
                && caller.Origin == ChannelVocabulary.OriginParticipant => PressRelease,
            ContentTransitions.Publish or ContentTransitions.Restore => ChannelTelemetryEventTypes.ContentPublished,
            ContentTransitions.Revise => ChannelTelemetryEventTypes.ContentRevised,
            ContentTransitions.Retract or ContentPublishService.DeleteAction => ChannelTelemetryEventTypes.ContentRetracted,
            ContentTransitions.Schedule or ContentTransitions.Unschedule => ContentScheduled,
            _ => throw new ArgumentOutOfRangeException(nameof(action), action, "The action emits no event."),
        };
    }

    /// <summary>Builds the event for one action.</summary>
    /// <param name="action">The funnel action.</param>
    /// <param name="item">The item AFTER the action.</param>
    /// <param name="caller">The caller.</param>
    /// <param name="time">The one clock read shared with the state change.</param>
    /// <param name="revisionKind">The revision kind for a revise, else null.</param>
    /// <param name="gateNote">The gates' audit note for a publish, else null.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent Build(
        string action,
        ContentItem item,
        ContentCaller caller,
        ContentEventTime time,
        string? revisionKind = null,
        string? gateNote = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(time);

        var actingHumanId = string.IsNullOrEmpty(caller.ActingHumanId) ? null : caller.ActingHumanId;
        var actor = caller.Origin switch
        {
            ChannelVocabulary.OriginParticipant => new TelemetryActor
            {
                Kind = "participant", ParticipantId = actingHumanId, ActingHumanId = actingHumanId,
            },
            ChannelVocabulary.OriginEngine => new TelemetryActor { Kind = "engine", ActingHumanId = actingHumanId },
            _ => new TelemetryActor { Kind = "system", ActingHumanId = actingHumanId },
        };

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = item.ExerciseId,
            EventType = EventTypeFor(action, item, caller),
            Channel = item.ChannelId,
            Actor = actor,
            Origin = caller.Origin,
            InjectId = caller.InjectId?.ToString(),
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget { EntityType = EntityType, EntityId = item.Id.ToString() },
            Payload = JsonSerializer.Serialize(
                new ContentEventPayload(action, item.Kind, item.Status, revisionKind, gateNote), PayloadOptions),
            EmittedAt = time.WallClock,
        };
    }

    /// <summary>The opaque payload — camelCase by explicit names; no body, no headline (nothing participant-authored).</summary>
    private sealed record ContentEventPayload(
        [property: JsonPropertyName("action")] string Action,
        [property: JsonPropertyName("kind")] string Kind,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("revisionKind")] string? RevisionKind,
        [property: JsonPropertyName("gateNote")] string? GateNote);
}

/// <summary>
/// The one clock read an action shares between its state change and its telemetry event: the server wall clock, the
/// exercise scenario instant (COR-053) and the exercise time zone (XC-008).
/// </summary>
/// <param name="WallClock">The server wall-clock instant (never client input).</param>
/// <param name="ScenarioTime">The exercise scenario instant (never client input).</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
public sealed record ContentEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone);
