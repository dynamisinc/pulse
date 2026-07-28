namespace Pulse.WebApi.Data.Entities;

using System.Collections.Generic;

/// <summary>
/// The LOCKED v0 envelope's conditional-requiredness rules (XC-004 / COR-018 / COR-015), single-sourced.
/// These mirror <c>telemetryEventV0Schema.superRefine</c> in
/// <c>src/frontend/src/core/telemetry/schema.ts</c> — the rules a plain object shape cannot express, where
/// one field's presence is required by another field's value.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this lives here rather than inline in a validator.</b> The rules had two server-side homes that
/// could drift: <c>TelemetryEventRequest.Validate</c> (the <c>POST /api/telemetry</c> ingest mirror) enforced
/// them, while every service that adds a <see cref="TelemetryEvent"/> straight to
/// <c>PulseDbContext.TelemetryEvents</c> did not — so an internal emitter could persist a row the public
/// ingest endpoint would reject with a 400. That is exactly what shipped: a failed participant login wrote
/// <c>actor.kind: 'participant'</c> with no <c>participantId</c> (#356). Both callers now share THIS one
/// implementation, and <c>PulseDbContext</c>'s write-guard applies it to every path.
/// </para>
/// <para>
/// Deliberately NOT validated here: the shape rules (required/non-empty fields, closed unions, ISO
/// timestamps). Those are the request mirror's job on the ingest path and the CLR type system's / the
/// migration's job on the entity path. This type is only the conditional layer.
/// </para>
/// </remarks>
public static class TelemetryEnvelopeRules
{
    /// <summary><c>actor.kind</c> value that requires <c>actor.participantId</c>.</summary>
    public const string ParticipantActorKind = "participant";

    /// <summary><c>actor.kind</c> value that requires <c>actor.personaId</c>.</summary>
    public const string PersonaActorKind = "persona";

    /// <summary><c>origin</c> value that requires <c>actor.actingHumanId</c> (COR-018).</summary>
    public const string ControllerAsPersonaOrigin = "controller-as-persona";

    /// <summary><c>origin</c> value that requires <c>injectId</c>.</summary>
    public const string InjectOrigin = "inject";

    private const string ViewEventType = "view";
    private const string ArticleViewEventType = "article_view";

    /// <summary>
    /// Collects every conditional-requiredness violation in <paramref name="facts"/>. Returns an empty list
    /// when conformant. Messages match the client schema's wording so a server-side rejection and a
    /// client-side one are traceable to the same rule.
    /// </summary>
    public static IReadOnlyList<string> Validate(TelemetryAttributionFacts facts)
    {
        var errors = new List<string>();

        // The actor-dependent rules only apply when an actor block is present at all; an ABSENT actor is a
        // shape error the caller reports separately (and would otherwise produce a confusing second error).
        if (facts.ActorPresent)
        {
            if (facts.ActorKind == ParticipantActorKind && string.IsNullOrEmpty(facts.ParticipantId))
            {
                errors.Add("actor.participantId is required when actor.kind is 'participant'.");
            }

            if (facts.ActorKind == PersonaActorKind && string.IsNullOrEmpty(facts.PersonaId))
            {
                errors.Add("actor.personaId is required when actor.kind is 'persona'.");
            }

            if (facts.Origin == ControllerAsPersonaOrigin && string.IsNullOrEmpty(facts.ActingHumanId))
            {
                errors.Add("actor.actingHumanId is required when origin is 'controller-as-persona' (COR-018).");
            }

            // View reach is participant/session-scoped by design (COR-015), regardless of actor.kind.
            if ((facts.EventType == ViewEventType || facts.EventType == ArticleViewEventType)
                && string.IsNullOrEmpty(facts.ParticipantId)
                && string.IsNullOrEmpty(facts.SessionId))
            {
                errors.Add("a view event requires actor.participantId or actor.sessionId for reach counting (COR-015).");
            }
        }

        if (facts.Origin == InjectOrigin && string.IsNullOrEmpty(facts.InjectId))
        {
            errors.Add("injectId is required when origin is 'inject'.");
        }

        return errors;
    }
}

/// <summary>
/// The subset of a v0 envelope the conditional rules read — the shared input to
/// <see cref="TelemetryEnvelopeRules.Validate"/>. A struct so neither caller allocates to validate, and a
/// named record so neither caller can transpose two same-typed arguments.
/// </summary>
/// <param name="ActorPresent">Whether the envelope carries an <c>actor</c> block at all (always true for a persisted entity, whose actor is required).</param>
/// <param name="ActorKind"><c>actor.kind</c>.</param>
/// <param name="ParticipantId"><c>actor.participantId</c>.</param>
/// <param name="PersonaId"><c>actor.personaId</c>.</param>
/// <param name="ActingHumanId"><c>actor.actingHumanId</c>.</param>
/// <param name="SessionId"><c>actor.sessionId</c>.</param>
/// <param name="EventType"><c>eventType</c>.</param>
/// <param name="Origin"><c>origin</c>.</param>
/// <param name="InjectId"><c>injectId</c>.</param>
public readonly record struct TelemetryAttributionFacts(
    bool ActorPresent,
    string? ActorKind,
    string? ParticipantId,
    string? PersonaId,
    string? ActingHumanId,
    string? SessionId,
    string? EventType,
    string? Origin,
    string? InjectId)
{
    /// <summary>Reads the conditional-rule inputs off a durable <see cref="TelemetryEvent"/> row.</summary>
    public static TelemetryAttributionFacts FromEntity(TelemetryEvent entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new TelemetryAttributionFacts(
            ActorPresent: true,
            ActorKind: entity.Actor?.Kind,
            ParticipantId: entity.Actor?.ParticipantId,
            PersonaId: entity.Actor?.PersonaId,
            ActingHumanId: entity.Actor?.ActingHumanId,
            SessionId: entity.Actor?.SessionId,
            EventType: entity.EventType,
            Origin: entity.Origin,
            InjectId: entity.InjectId);
    }
}
