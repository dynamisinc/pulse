namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Builds the server-side XC-004 <c>alert_issued</c> / <c>alert_cleared</c> events (FC-6, channels-foundation story 10)
/// against the locked v0 envelope. The caller adds each to the SAME <c>SaveChanges</c> as the alert row it describes,
/// so an alert and its event land together or not at all.
/// </summary>
/// <remarks>
/// <para>
/// <b>Shape:</b> <c>channel</c> = the alert's source (a channel id, or <c>system</c> for a console alert — both in the
/// closed channel union), <c>target { entityType: alert, entityId }</c>, server wall clock + exercise scenario time +
/// time zone, <c>injectId</c> when an inject raised it. The actor carries the acting human (COR-018); telemetry is
/// staff-only, so the provenance never reaches a participant (XC-002).
/// </para>
/// <para>
/// <b>Origin mapping.</b> The telemetry origin union has no plain <c>controller</c> (its controller value is
/// <c>controller-as-persona</c>, which an alert is not), so a controller raise omits <c>origin</c>, as
/// <c>inject_action</c> does; <c>participant</c>, <c>engine</c> and <c>inject</c> pass through.
/// </para>
/// <para>
/// <b>Expiry</b> is a clear with no human behind it: <c>actor { kind: system }</c> and <c>payload.reason: expired</c>.
/// </para>
/// </remarks>
public static class AlertTelemetry
{
    /// <summary>The target entity type.</summary>
    public const string EntityType = "alert";

    /// <summary>The <c>payload.reason</c> of a staff or in-process clear.</summary>
    public const string ReasonCleared = "cleared";

    /// <summary>The <c>payload.reason</c> of a scenario-time expiry.</summary>
    public const string ReasonExpired = "expired";

    private const string ActorSystem = "system";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Builds the <c>alert_issued</c> event for a newly raised alert.</summary>
    /// <param name="alert">The alert as persisted.</param>
    /// <param name="caller">Who raised it.</param>
    /// <param name="time">The one clock read shared with the row.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForIssued(ChannelAlert alert, ContentCaller caller, AlertEventTime time)
    {
        ArgumentNullException.ThrowIfNull(alert);
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(time);

        return Build(
            ChannelTelemetryEventTypes.AlertIssued,
            alert,
            ActorFor(caller),
            TelemetryOrigin(caller.Origin),
            caller.InjectId,
            time,
            new IssuedPayload(alert.Severity, alert.SourceContentId?.ToString(), alert.ExpiresScenarioTime is not null));
    }

    /// <summary>Builds the <c>alert_cleared</c> event for a clear by a caller.</summary>
    /// <param name="alert">The alert after the clear.</param>
    /// <param name="caller">Who cleared it.</param>
    /// <param name="time">The one clock read shared with the row.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForCleared(ChannelAlert alert, ContentCaller caller, AlertEventTime time)
    {
        ArgumentNullException.ThrowIfNull(alert);
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(time);

        return Build(
            ChannelTelemetryEventTypes.AlertCleared,
            alert,
            ActorFor(caller),
            TelemetryOrigin(caller.Origin),
            caller.InjectId,
            time,
            new ClearedPayload(ReasonCleared));
    }

    /// <summary>Builds the <c>alert_cleared</c> event for a scenario-time expiry (no human behind it).</summary>
    /// <param name="alert">The alert after the expiry.</param>
    /// <param name="time">The one clock read shared with the row.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForExpired(ChannelAlert alert, AlertEventTime time)
    {
        ArgumentNullException.ThrowIfNull(alert);
        ArgumentNullException.ThrowIfNull(time);

        return Build(
            ChannelTelemetryEventTypes.AlertCleared,
            alert,
            new TelemetryActor { Kind = ActorSystem },
            origin: null,
            injectId: null,
            time,
            new ClearedPayload(ReasonExpired));
    }

    private static TelemetryActor ActorFor(ContentCaller caller) => new()
    {
        Kind = caller.Origin switch
        {
            ChannelVocabulary.OriginParticipant => "participant",
            ChannelVocabulary.OriginEngine => "engine",
            _ => ActorSystem,
        },
        ActingHumanId = caller.ActingHumanId,

        // The v0 schema requires participantId for a participant actor; a participant caller's acting human IS the
        // participant (COR-018).
        ParticipantId = caller.Origin == ChannelVocabulary.OriginParticipant ? caller.ActingHumanId : null,
    };

    private static string? TelemetryOrigin(string origin) => origin switch
    {
        ChannelVocabulary.OriginParticipant or ChannelVocabulary.OriginEngine or ChannelVocabulary.OriginInject => origin,
        _ => null,
    };

    private static TelemetryEvent Build<TPayload>(
        string eventType,
        ChannelAlert alert,
        TelemetryActor actor,
        string? origin,
        Guid? injectId,
        AlertEventTime time,
        TPayload payload) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = alert.ExerciseId,
            EventType = eventType,
            Channel = alert.SourceChannel,
            Actor = actor,
            Origin = origin,
            InjectId = injectId?.ToString(),
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget { EntityType = EntityType, EntityId = alert.Id.ToString() },
            Payload = JsonSerializer.Serialize(payload, PayloadOptions),
            EmittedAt = time.WallClock,
        };

    /// <summary>The opaque issued payload: severity and links only, never the headline text or a name.</summary>
    private sealed record IssuedPayload(
        [property: JsonPropertyName("severity")] string Severity,
        [property: JsonPropertyName("sourceContentId")] string? SourceContentId,
        [property: JsonPropertyName("expires")] bool Expires);

    /// <summary>The opaque cleared payload.</summary>
    private sealed record ClearedPayload([property: JsonPropertyName("reason")] string Reason);
}

/// <summary>
/// The one clock read an alert operation shares between its row and its telemetry: the server wall clock, the
/// exercise scenario instant (COR-053) and the exercise time zone (XC-008).
/// </summary>
/// <param name="WallClock">The server wall-clock instant.</param>
/// <param name="ScenarioTime">The exercise scenario instant.</param>
/// <param name="TimeZone">The exercise IANA time zone.</param>
/// <param name="ScenarioKnown">
/// False when neither the exercise clock nor the persisted scenario instant was available, so
/// <paramref name="ScenarioTime"/> is the wall-clock fallback. The expiry sweep never expires against it.
/// </param>
public sealed record AlertEventTime(
    DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone, bool ScenarioKnown = true)
{
    /// <summary>The scenario instant when it is known, else null (never the wall-clock fallback).</summary>
    public DateTimeOffset? KnownScenarioTime => ScenarioKnown ? ScenarioTime : null;
}
