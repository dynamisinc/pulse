namespace Pulse.WebApi.Features.EngineRuntime.Telemetry;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The server-side emit helper for the XC-004 engine events. Both story 01 (the loop's
/// observe/decide/generate/publish/measure + storyline stages) and story 02 (the controller review action)
/// use it to BUILD a <see cref="TelemetryEvent"/> row that the caller adds to its OWN unit of work — the way
/// <c>PostIngestService</c> builds and adds its <c>post</c> event, never an HTTP round-trip through the
/// <c>/api/telemetry</c> sink. The helper stamps the locked v0 envelope constants (<c>schemaVersion:'v0'</c>,
/// the actor block, wall + scenario time, time zone, opaque payload); the ADDITIVE engine event types
/// (<see cref="EngineEventTypes"/>) ride the unchanged envelope.
/// </summary>
public interface IEngineTelemetryEmitter
{
    /// <summary>
    /// Builds a v0 <see cref="TelemetryEvent"/> for one engine action. The caller is responsible for adding
    /// the returned row to its <c>PulseDbContext</c> and saving it in the same unit of work as the mutation
    /// it describes (XC-004: exactly one event per meaningful action).
    /// </summary>
    /// <param name="eventType">The XC-004 event type (an <see cref="EngineEventTypes"/> constant).</param>
    /// <param name="context">The server-authoritative envelope context (scope, times, actor, channel).</param>
    /// <param name="payload">
    /// The event-type-specific payload object (an <see cref="EngineEventPayloads"/> record), serialized to
    /// opaque camelCase JSON with absent optional fields null-omitted; <c>null</c> for a payload-less event.
    /// </param>
    /// <returns>The built (but not yet persisted) telemetry row.</returns>
    TelemetryEvent BuildEvent(string eventType, EngineTelemetryContext context, object? payload = null);
}

/// <summary>
/// The server-authoritative envelope context for an engine telemetry event. Scope and times are stamped by
/// the trusted caller (the loop always knows its exercise + scenario minute), NEVER client-derived (COR-001,
/// COR-053).
/// </summary>
public sealed record EngineTelemetryContext
{
    /// <summary>The owning exercise run (COR-001) — server-authoritative, never a client body value.</summary>
    public required System.Guid ExerciseId { get; init; }

    /// <summary>The real (server-clock) wall-clock instant. Also used for <c>emittedAt</c>.</summary>
    public required System.DateTimeOffset WallClockTime { get; init; }

    /// <summary>The scenario instant (COR-053) — the only participant-facing time, here for staff telemetry.</summary>
    public required System.DateTimeOffset ScenarioTime { get; init; }

    /// <summary>The exercise IANA time zone (XC-008), e.g. <c>America/Chicago</c>.</summary>
    public required string TimeZone { get; init; }

    /// <summary>The v0 channel; the v1 engine drives the <c>social</c> channel.</summary>
    public string Channel { get; init; } = "social";

    /// <summary>The actor block; defaults to the engine actor (<c>kind:'engine'</c>).</summary>
    public EngineTelemetryActor Actor { get; init; } = new();

    /// <summary>Optional provenance (e.g. <c>engine</c>) — the v0 <c>origin</c>; null-omitted when empty.</summary>
    public string? Origin { get; init; }

    /// <summary>Optional pointer to the entity acted on (e.g. the published post).</summary>
    public EngineTelemetryTarget? Target { get; init; }
}

/// <summary>
/// The actor block for an engine telemetry event — mirrors the v0 <c>actor</c> sub-object. Defaults to the
/// engine actor. <see cref="ActingHumanId"/> carries the human behind a shared account (COR-018), e.g. the
/// controller who approved a draft on an <c>engine.reviewed</c> event.
/// </summary>
public sealed record EngineTelemetryActor
{
    /// <summary>The v0 actor kind (<c>participant</c> / <c>persona</c> / <c>system</c> / <c>engine</c>); defaults to <c>engine</c>.</summary>
    public string Kind { get; init; } = "engine";

    /// <summary>Optional participant id.</summary>
    public string? ParticipantId { get; init; }

    /// <summary>Optional persona instance id.</summary>
    public string? PersonaId { get; init; }

    /// <summary>Optional human behind a shared account (COR-018) — null-omitted when empty.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>Optional session id (COR-015).</summary>
    public string? SessionId { get; init; }

    /// <summary>Optional actor role.</summary>
    public string? Role { get; init; }
}

/// <summary>The optional target pointer for an engine telemetry event — mirrors the v0 <c>target</c> sub-object.</summary>
public sealed record EngineTelemetryTarget
{
    /// <summary>The target entity type (e.g. <c>post</c>).</summary>
    public string? EntityType { get; init; }

    /// <summary>The target entity id.</summary>
    public string? EntityId { get; init; }
}
