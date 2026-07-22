namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The FROZEN session wire shape — the server-side mirror of the frontend <c>Session</c> type
/// (<c>src/frontend/src/core/auth/sessionResolver.ts</c>). <c>GET /api/session</c> (story 03) returns exactly
/// this, field-for-field, so flipping <c>USE_MOCK_SESSION</c> live drives <c>useSession()</c> with no
/// consumer change. Accommodates all three login kinds: participant named account, staff (no
/// <see cref="PersonaId"/>), and shared read-only (<see cref="IsReadOnly"/> true; <see cref="AccountId"/> /
/// <see cref="ActingHumanId"/> are the ephemeral identity).
/// </summary>
/// <remarks>
/// XC-002 by construction: this shape carries no provenance / staff-only fields. Every property has an
/// explicit <see cref="JsonPropertyNameAttribute"/> (camelCase) so the wire shape is independent of host
/// serializer config. <see cref="PersonaId"/> is OMITTED (not null) when absent — the frozen client validator
/// accepts <c>undefined | string</c> but rejects <c>null</c> — via
/// <see cref="JsonIgnoreCondition.WhenWritingNull"/>. Wave-0 freezes the shape only; the endpoint is story 03.
/// </remarks>
public sealed class SessionDto
{
    /// <summary>The bound exercise id (COR-012).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The bound principal id (named account / staff user / ephemeral read-only identity).</summary>
    [JsonPropertyName("accountId")]
    public required string AccountId { get; init; }

    /// <summary>The session role — the <c>ExerciseRole</c> string vocabulary.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>The persona this account posts as; OMITTED when absent (never serialized as <c>null</c>).</summary>
    [JsonPropertyName("personaId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PersonaId { get; init; }

    /// <summary>The individual human behind the (possibly shared) account (COR-018); ephemeral for a read-only session.</summary>
    [JsonPropertyName("actingHumanId")]
    public required string ActingHumanId { get; init; }

    /// <summary>Whether this is a view-only session (COR-015).</summary>
    [JsonPropertyName("isReadOnly")]
    public required bool IsReadOnly { get; init; }

    /// <summary>ISO-8601 wall-clock expiry (round-trip <c>"O"</c>); short-lived, past expiry forces re-auth.</summary>
    [JsonPropertyName("expiresAt")]
    public required string ExpiresAt { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="Session"/> to the frozen wire shape. The wire <c>accountId</c> is the
    /// session's canonical <see cref="Session.PrincipalId"/> (uniform across kinds); <c>personaId</c> is
    /// omitted when the session has none; <c>expiresAt</c> is the persisted instant round-trip ISO-8601,
    /// never re-derived. No staff-only / provenance field is read (XC-002).
    /// </summary>
    /// <param name="session">The persisted session to project.</param>
    /// <returns>The frozen participant-safe session projection.</returns>
    public static SessionDto FromSession(Session session)
    {
        ArgumentNullException.ThrowIfNull(session);

        return new SessionDto
        {
            ExerciseId = session.ExerciseId.ToString(),
            AccountId = session.PrincipalId,
            Role = session.Role,
            PersonaId = session.PersonaId?.ToString(),
            ActingHumanId = session.ActingHumanId,
            IsReadOnly = session.IsReadOnly,
            ExpiresAt = session.ExpiresAt.ToString("O"),
        };
    }
}
