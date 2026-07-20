namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The durable store row for one telemetry event (XC-004). This is the server-side, schema-faithful mirror
/// of the LOCKED v0 client envelope <c>TelemetryEventV0</c> in
/// <c>src/frontend/src/core/telemetry/schema.ts</c> — every envelope field has a corresponding column here,
/// field-by-field, so the store is not a reinterpretation of the already-shipped client contract.
/// Belongs to one exercise run, so it is <see cref="IExerciseScoped"/>.
/// </summary>
/// <remarks>
/// Field map to <c>TelemetryEventV0</c>: <c>schemaVersion→SchemaVersion</c> (literal <c>'v0'</c>),
/// <c>eventId→EventId</c> (dedup key; unique — it is this row's primary key), <c>exerciseId→ExerciseId</c>
/// (required/non-empty → non-nullable Guid), <c>eventType→EventType</c>, <c>channel→Channel</c>,
/// <c>actor→Actor</c> (owned, columns per sub-field), <c>origin→Origin</c>, <c>injectId→InjectId</c>,
/// <c>correlationId→CorrelationId</c>, <c>causationId→CausationId</c>, <c>sequence→Sequence</c>,
/// <c>source→Source</c>, <c>wallClockTime→WallClockTime</c>, <c>scenarioTime→ScenarioTime</c>,
/// <c>timeZone→TimeZone</c>, <c>target→Target</c> (owned, optional), <c>payload→Payload</c> (opaque JSON
/// string, never parsed here), <c>emittedAt→EmittedAt</c>.
/// </remarks>
public sealed class TelemetryEvent : IExerciseScoped
{
    /// <summary>
    /// <c>eventId</c> — client-generated uuid and the documented idempotency/dedup key (schema.ts). Used as
    /// the primary key so it carries a unique index; <c>telemetry/02</c>'s dedup relies on this uniqueness.
    /// </summary>
    public required string EventId { get; set; }

    /// <summary><c>schemaVersion</c> — the literal <c>'v0'</c>. A future breaking change is a new literal, not a mutation.</summary>
    public string SchemaVersion { get; set; } = "v0";

    /// <summary><c>exerciseId</c> — required/non-empty isolation scope (COR-001). Non-nullable; write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary><c>eventType</c> — open vocabulary string (never an enum, so later features extend it additively).</summary>
    public required string EventType { get; set; }

    /// <summary><c>channel</c> — the closed channel union, stored as its string value.</summary>
    public required string Channel { get; set; }

    /// <summary><c>actor</c> — the actor block (always present). Owned; every sub-field gets a column.</summary>
    public required TelemetryActor Actor { get; set; }

    /// <summary><c>origin</c> — provenance (never participant-visible). Optional/reserved.</summary>
    public string? Origin { get; set; }

    /// <summary><c>injectId</c> — set when <c>origin === 'inject'</c>. Optional; never participant-visible.</summary>
    public string? InjectId { get; set; }

    /// <summary><c>correlationId</c> — groups one logical operation. Reserved in v0; carried through unchanged.</summary>
    public string? CorrelationId { get; set; }

    /// <summary><c>causationId</c> — <c>eventId</c> of the direct parent event. Reserved in v0.</summary>
    public string? CausationId { get; set; }

    /// <summary><c>sequence</c> — per-source monotonic ordering tiebreaker (a JS number → nullable 64-bit). Reserved in v0.</summary>
    public long? Sequence { get; set; }

    /// <summary><c>source</c> — producing emitter/feature. Reserved in v0.</summary>
    public string? Source { get; set; }

    /// <summary><c>wallClockTime</c> — real (wall-clock) time. Telemetry-only; never shown in-fiction.</summary>
    public DateTimeOffset WallClockTime { get; set; }

    /// <summary><c>scenarioTime</c> — scenario time (COR-053).</summary>
    public DateTimeOffset ScenarioTime { get; set; }

    /// <summary><c>timeZone</c> — IANA time zone of the exercise (XC-008), e.g. <c>America/Chicago</c>.</summary>
    public required string TimeZone { get; set; }

    /// <summary><c>target</c> — optional pointer to the entity acted on. Owned, optional; every sub-field gets a column.</summary>
    public TelemetryTarget? Target { get; set; }

    /// <summary>
    /// <c>payload</c> — the open, event-type-specific extension point. Stored as an OPAQUE JSON string
    /// (<c>nvarchar(max)</c>) and never parsed or rendered here. Optional → nullable.
    /// </summary>
    public string? Payload { get; set; }

    /// <summary><c>emittedAt</c> — when the emitter stamped/sent the event.</summary>
    public DateTimeOffset EmittedAt { get; set; }
}

/// <summary>
/// Owned value object for <c>TelemetryEventV0.actor</c>. Every sub-field of the client's <c>actor</c> block
/// maps to a column; all identifiers beyond <see cref="Kind"/> are optional (not every actor kind populates
/// every field). Persisted via table-splitting on <see cref="TelemetryEvent"/>, not as JSON.
/// </summary>
public sealed class TelemetryActor
{
    /// <summary><c>actor.kind</c> — the closed actor-kind union, stored as its string value. Always present.</summary>
    public required string Kind { get; set; }

    /// <summary><c>actor.participantId</c> — optional.</summary>
    public string? ParticipantId { get; set; }

    /// <summary><c>actor.personaId</c> — optional.</summary>
    public string? PersonaId { get; set; }

    /// <summary><c>actor.actingHumanId</c> — the human behind a shared account (COR-018). Optional.</summary>
    public string? ActingHumanId { get; set; }

    /// <summary><c>actor.sessionId</c> — ephemeral session identity for reach counting (COR-015). Optional.</summary>
    public string? SessionId { get; set; }

    /// <summary><c>actor.role</c> — optional.</summary>
    public string? Role { get; set; }
}

/// <summary>
/// Owned value object for <c>TelemetryEventV0.target</c> — an optional pointer to the entity an event acted
/// on. Both sub-fields are optional. Persisted via table-splitting on <see cref="TelemetryEvent"/>.
/// </summary>
public sealed class TelemetryTarget
{
    /// <summary><c>target.entityType</c> — optional.</summary>
    public string? EntityType { get; set; }

    /// <summary><c>target.entityId</c> — optional.</summary>
    public string? EntityId { get; set; }
}
