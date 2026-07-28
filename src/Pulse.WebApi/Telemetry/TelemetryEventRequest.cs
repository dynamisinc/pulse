namespace Pulse.WebApi.Telemetry;

using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Server-side request/validation model for the <c>POST /api/telemetry</c> ingest endpoint — a
/// deliberately SEPARATE, shape-identical mirror of the LOCKED v0 client envelope
/// <c>TelemetryEventV0</c> (<c>src/frontend/src/core/telemetry/schema.ts</c>). It is NOT the frontend's
/// <c>zod</c> schema and does NOT trust it: every rule the client's <c>zod</c> schema (including its
/// <c>superRefine</c> conditional-requiredness block) enforces is re-enforced here server-side (defense in
/// depth, XC-004 / NFR-004). Field names, types, and optionality match the envelope 1:1; unrecognized
/// top-level (and nested <c>actor</c>/<c>target</c>) keys are rejected to mirror <c>zod</c>'s
/// <c>strictObject</c>.
/// </summary>
/// <remarks>
/// Every field is deserialized as its permissive shape (nullable, timestamps as raw strings, <c>payload</c>
/// as an opaque <see cref="JsonElement"/>) so that <see cref="Validate"/> — not the JSON deserializer —
/// is the single, auditable place that decides validity and produces the <c>400</c>. The only things the
/// deserializer itself rejects are genuinely malformed JSON, a type mismatch on a scalar, and an
/// unmapped/unknown key (via <see cref="JsonUnmappedMemberHandlingAttribute"/>).
/// </remarks>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class TelemetryEventRequest
{
    /// <summary>Shared serializer options: camelCase keys (matching the client envelope), case-sensitive, unknown keys disallowed via the type attributes.</summary>
    public static JsonSerializerOptions SerializerOptions { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly HashSet<string> ChannelValues = new(StringComparer.Ordinal)
    {
        "social", "portal", "news", "press", "weather", "system",
    };

    private static readonly HashSet<string> ActorKindValues = new(StringComparer.Ordinal)
    {
        "participant", "persona", "system", "engine",
    };

    private static readonly HashSet<string> OriginValues = new(StringComparer.Ordinal)
    {
        "participant", "controller-as-persona", "engine", "inject",
    };

    /// <summary><c>schemaVersion</c> — must be the literal <c>'v0'</c>.</summary>
    public string? SchemaVersion { get; set; }

    /// <summary><c>eventId</c> — required, non-empty. The idempotency/dedup key.</summary>
    public string? EventId { get; set; }

    /// <summary><c>exerciseId</c> — required, non-empty isolation scope (COR-001).</summary>
    public string? ExerciseId { get; set; }

    /// <summary><c>eventType</c> — required, non-empty open string (never enum-constrained).</summary>
    public string? EventType { get; set; }

    /// <summary><c>channel</c> — required; one of the closed channel union values.</summary>
    public string? Channel { get; set; }

    /// <summary><c>actor</c> — required actor block.</summary>
    public ActorRequest? Actor { get; set; }

    /// <summary><c>origin</c> — optional provenance; one of the closed origin union values when present.</summary>
    public string? Origin { get; set; }

    /// <summary><c>injectId</c> — optional; required when <c>origin === 'inject'</c>.</summary>
    public string? InjectId { get; set; }

    /// <summary><c>correlationId</c> — optional/reserved; carried through unchanged.</summary>
    public string? CorrelationId { get; set; }

    /// <summary><c>causationId</c> — optional/reserved; carried through unchanged.</summary>
    public string? CausationId { get; set; }

    /// <summary><c>sequence</c> — optional/reserved; a non-negative integer when present.</summary>
    public long? Sequence { get; set; }

    /// <summary><c>source</c> — optional/reserved; carried through unchanged.</summary>
    public string? Source { get; set; }

    /// <summary><c>wallClockTime</c> — required ISO-8601 date-time with an explicit offset.</summary>
    public string? WallClockTime { get; set; }

    /// <summary><c>scenarioTime</c> — required ISO-8601 date-time with an explicit offset.</summary>
    public string? ScenarioTime { get; set; }

    /// <summary><c>timeZone</c> — required, non-empty IANA zone string (not further validated, matching the client's <c>min(1)</c>).</summary>
    public string? TimeZone { get; set; }

    /// <summary><c>target</c> — optional pointer to the entity acted on.</summary>
    public TargetRequest? Target { get; set; }

    /// <summary><c>payload</c> — optional, opaque event-type-specific JSON object; never parsed or rendered here.</summary>
    public JsonElement? Payload { get; set; }

    /// <summary><c>emittedAt</c> — required ISO-8601 date-time with an explicit offset.</summary>
    public string? EmittedAt { get; set; }

    /// <summary>
    /// Re-validates the v0 shape AND the conditional-requiredness rules server-side (defense in depth),
    /// mirroring <c>telemetryEventV0Schema</c> including its <c>superRefine</c> block. Returns an empty list
    /// when valid; otherwise the collected reasons (never echoed back to the caller verbatim — the endpoint
    /// returns an opaque <c>400</c>).
    /// </summary>
    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();

        // schemaVersion is a LITERAL — a future breaking change is a new literal, never a mutation.
        if (SchemaVersion != "v0")
        {
            errors.Add("schemaVersion must be the literal 'v0'.");
        }

        RequireNonEmpty(EventId, "eventId", errors);
        RequireNonEmpty(ExerciseId, "exerciseId", errors);
        RequireNonEmpty(EventType, "eventType", errors);
        RequireNonEmpty(TimeZone, "timeZone", errors);

        if (Channel is null || !ChannelValues.Contains(Channel))
        {
            errors.Add("channel must be one of the v0 channel values.");
        }

        if (Actor is null)
        {
            errors.Add("actor is required.");
        }
        else
        {
            if (Actor.Kind is null || !ActorKindValues.Contains(Actor.Kind))
            {
                errors.Add("actor.kind must be one of the v0 actor-kind values.");
            }

            RequireOptionalNonEmpty(Actor.ParticipantId, "actor.participantId", errors);
            RequireOptionalNonEmpty(Actor.PersonaId, "actor.personaId", errors);
            RequireOptionalNonEmpty(Actor.ActingHumanId, "actor.actingHumanId", errors);
            RequireOptionalNonEmpty(Actor.SessionId, "actor.sessionId", errors);
            RequireOptionalNonEmpty(Actor.Role, "actor.role", errors);
        }

        if (Origin is not null && !OriginValues.Contains(Origin))
        {
            errors.Add("origin must be one of the v0 origin values.");
        }

        RequireOptionalNonEmpty(InjectId, "injectId", errors);
        RequireOptionalNonEmpty(CorrelationId, "correlationId", errors);
        RequireOptionalNonEmpty(CausationId, "causationId", errors);
        RequireOptionalNonEmpty(Source, "source", errors);

        if (Sequence is < 0)
        {
            errors.Add("sequence must be a non-negative integer.");
        }

        RequireIsoDateTimeWithOffset(WallClockTime, "wallClockTime", errors);
        RequireIsoDateTimeWithOffset(ScenarioTime, "scenarioTime", errors);
        RequireIsoDateTimeWithOffset(EmittedAt, "emittedAt", errors);

        if (Target is not null)
        {
            RequireOptionalNonEmpty(Target.EntityType, "target.entityType", errors);
            RequireOptionalNonEmpty(Target.EntityId, "target.entityId", errors);
        }

        if (Payload is { } payload && payload.ValueKind != JsonValueKind.Object)
        {
            errors.Add("payload, when present, must be a JSON object.");
        }

        // Conditional requiredness — mirrors telemetryEventV0Schema.superRefine (XC-004 / COR-018 / COR-015).
        // Delegated to TelemetryEnvelopeRules so this ingest mirror and the PulseDbContext write-guard (which
        // covers the services that add TelemetryEvent rows directly, #356) enforce ONE implementation of the
        // rules rather than two that can drift.
        errors.AddRange(TelemetryEnvelopeRules.Validate(new TelemetryAttributionFacts(
            ActorPresent: Actor is not null,
            ActorKind: Actor?.Kind,
            ParticipantId: Actor?.ParticipantId,
            PersonaId: Actor?.PersonaId,
            ActingHumanId: Actor?.ActingHumanId,
            SessionId: Actor?.SessionId,
            EventType: EventType,
            Origin: Origin,
            InjectId: InjectId)));

        return errors;
    }

    /// <summary>
    /// Maps a validated request to the durable <see cref="TelemetryEvent"/> row, faithfully carrying every
    /// field (actor/target nested, reserved fields, and <c>payload</c> as its opaque JSON text). Only call
    /// after <see cref="Validate"/> returned no errors and the <paramref name="exerciseId"/> scope parsed.
    /// </summary>
    public TelemetryEvent ToEntity(Guid exerciseId)
    {
        return new TelemetryEvent
        {
            EventId = EventId!,
            SchemaVersion = SchemaVersion!,
            ExerciseId = exerciseId,
            EventType = EventType!,
            Channel = Channel!,
            Actor = new TelemetryActor
            {
                Kind = Actor!.Kind!,
                ParticipantId = Actor.ParticipantId,
                PersonaId = Actor.PersonaId,
                ActingHumanId = Actor.ActingHumanId,
                SessionId = Actor.SessionId,
                Role = Actor.Role,
            },
            Origin = Origin,
            InjectId = InjectId,
            CorrelationId = CorrelationId,
            CausationId = CausationId,
            Sequence = Sequence,
            Source = Source,
            WallClockTime = ParseDateTime(WallClockTime),
            ScenarioTime = ParseDateTime(ScenarioTime),
            TimeZone = TimeZone!,
            Target = Target is null
                ? null
                : new TelemetryTarget
                {
                    EntityType = Target.EntityType,
                    EntityId = Target.EntityId,
                },
            // payload is stored OPAQUE — its raw JSON text, never parsed or re-rendered (NFR-004).
            Payload = Payload is { } payload ? payload.GetRawText() : null,
            EmittedAt = ParseDateTime(EmittedAt),
        };
    }

    private static void RequireNonEmpty(string? value, string field, List<string> errors)
    {
        if (string.IsNullOrEmpty(value))
        {
            errors.Add($"{field} is required and must be non-empty.");
        }
    }

    private static void RequireOptionalNonEmpty(string? value, string field, List<string> errors)
    {
        // Mirrors zod `z.string().min(1).optional()`: absent is fine, but an empty string is not.
        if (value is { Length: 0 })
        {
            errors.Add($"{field}, when present, must be non-empty.");
        }
    }

    private static void RequireIsoDateTimeWithOffset(string? value, string field, List<string> errors)
    {
        if (!TryParseIsoDateTimeWithOffset(value, out _))
        {
            errors.Add($"{field} must be an ISO-8601 date-time with an explicit offset.");
        }
    }

    private static DateTimeOffset ParseDateTime(string? value)
    {
        // Only reached after Validate() confirmed every timestamp parses; guard anyway so a misuse throws
        // loudly rather than silently persisting a default (min-value) timestamp.
        if (!TryParseIsoDateTimeWithOffset(value, out var result))
        {
            throw new InvalidOperationException(
                "ToEntity() was called with an unvalidated timestamp; call Validate() first.");
        }

        return result;
    }

    /// <summary>
    /// The exact ISO-8601 date-time layouts the client's <c>z.iso.datetime({ offset: true })</c> emits —
    /// a mandatory <c>T</c> separator, seconds, optional fractional seconds, and an explicit offset that is
    /// EITHER a literal <c>Z</c> OR a numeric <c>±hh:mm</c> (<c>zzz</c>). There is deliberately no
    /// offset-optional layout (no bare <c>K</c>): an offset-less string must fail. <c>new Date().toISOString()</c>
    /// (the real emitter) produces the fractional-<c>Z</c> form, so both fractional and non-fractional are listed.
    /// </summary>
    private static readonly string[] IsoOffsetFormats =
    {
        "yyyy-MM-dd'T'HH:mm:sszzz",
        "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFzzz",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'",
    };

    /// <summary>
    /// Parses an ISO-8601 date-time that carries an explicit offset (a trailing <c>Z</c> or a numeric
    /// <c>±hh:mm</c>), mirroring the client's <c>z.iso.datetime({ offset: true })</c>. Uses
    /// <see cref="DateTimeOffset.TryParseExact(string, string[], IFormatProvider, DateTimeStyles, out DateTimeOffset)"/>
    /// against a closed set of ISO layouts rather than the lenient <c>TryParse</c> (which accepts non-ISO
    /// forms like <c>03/04/2033</c> or a space-separated date-time the client schema would reject). A bare
    /// date, a date-time with no offset, or a non-ISO string is rejected — keeping these timestamps clean
    /// for E10/E9/E8 downstream. <see cref="DateTimeStyles.AssumeUniversal"/> makes a literal-<c>Z</c> value
    /// resolve to a <c>+00:00</c> offset; a <c>zzz</c> value already carries its own offset.
    /// </summary>
    private static bool TryParseIsoDateTimeWithOffset(string? value, out DateTimeOffset result)
    {
        result = default;
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        return DateTimeOffset.TryParseExact(
            value, IsoOffsetFormats, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out result);
    }
}

/// <summary>
/// The <c>actor</c> sub-object of the v0 envelope. A strict mirror of the client's <c>telemetryActorSchema</c>
/// (<c>strictObject</c>): unknown keys are rejected; all identifiers beyond <see cref="Kind"/> are optional.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ActorRequest
{
    /// <summary><c>actor.kind</c> — required; one of the closed actor-kind union values.</summary>
    public string? Kind { get; set; }

    /// <summary><c>actor.participantId</c> — optional.</summary>
    public string? ParticipantId { get; set; }

    /// <summary><c>actor.personaId</c> — optional.</summary>
    public string? PersonaId { get; set; }

    /// <summary><c>actor.actingHumanId</c> — optional (COR-018).</summary>
    public string? ActingHumanId { get; set; }

    /// <summary><c>actor.sessionId</c> — optional (COR-015).</summary>
    public string? SessionId { get; set; }

    /// <summary><c>actor.role</c> — optional.</summary>
    public string? Role { get; set; }
}

/// <summary>
/// The optional <c>target</c> sub-object of the v0 envelope. A strict mirror of the client's
/// <c>telemetryTargetSchema</c> (<c>strictObject</c>): unknown keys are rejected; both fields are optional.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class TargetRequest
{
    /// <summary><c>target.entityType</c> — optional.</summary>
    public string? EntityType { get; set; }

    /// <summary><c>target.entityId</c> — optional.</summary>
    public string? EntityId { get; set; }
}
