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
/// <para>
/// <b>identity-auth-roles/16 frozen-type change (ADMIN-IDENTITY-MODEL §9, cleared by the orchestrator).</b>
/// <c>exerciseId</c> is now <c>string | null</c> (null = org scope, ALWAYS written), and the shape gains
/// <c>personId</c> (<c>string | null</c>, always written), <c>world</c> (<c>'staff' | 'participant'</c>),
/// <c>scope</c> (<c>'exercise' | 'org'</c>) and <c>isLead</c>. <c>role</c> is <c>ExerciseRole | 'orgAdmin'</c>, where
/// <c>'orgAdmin'</c> appears only with <c>scope: 'org'</c> and an exercise role only with <c>scope: 'exercise'</c>.
/// </para>
/// </remarks>
public sealed class SessionDto
{
    /// <summary>The bound exercise id (COR-012), or <c>null</c> for an org-scope session (written as <c>null</c>).</summary>
    [JsonPropertyName("exerciseId")]
    public required string? ExerciseId { get; init; }

    /// <summary>The person the session was minted for, or <c>null</c> (one-off participant, read-only viewer).</summary>
    [JsonPropertyName("personId")]
    public required string? PersonId { get; init; }

    /// <summary>The session's world: <c>staff</c> (staff sessions) or <c>participant</c> (participant and read-only).</summary>
    [JsonPropertyName("world")]
    public required string World { get; init; }

    /// <summary>The session's scope: <c>exercise</c>, or <c>org</c> when no exercise is bound.</summary>
    [JsonPropertyName("scope")]
    public required string Scope { get; init; }

    /// <summary>
    /// Whether the session's person holds the exercise's lead-controller enrollment — read LIVE from
    /// <c>Enrollment.IsLead</c> when the DTO is built, never stored on the session.
    /// </summary>
    [JsonPropertyName("isLead")]
    public required bool IsLead { get; init; }

    /// <summary>The bound principal id (named account / staff user / ephemeral read-only identity).</summary>
    [JsonPropertyName("accountId")]
    public required string AccountId { get; init; }

    /// <summary>The session role — an <c>ExerciseRole</c> (exercise scope) or <c>orgAdmin</c> (org scope only).</summary>
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

    /// <summary>The <c>scope</c> value of a session bound to an exercise.</summary>
    public const string ExerciseScope = "exercise";

    /// <summary>The <c>scope</c> value of an org-scope session (no exercise bound).</summary>
    public const string OrgScope = "org";

    /// <summary>
    /// Projects a persisted <see cref="Session"/> to the frozen wire shape. The wire <c>accountId</c> is the
    /// session's canonical <see cref="Session.PrincipalId"/> (uniform across kinds); <c>personaId</c> is
    /// omitted when the session has none; <c>expiresAt</c> is the persisted instant round-trip ISO-8601,
    /// never re-derived. No staff-only / provenance field is read (XC-002).
    /// </summary>
    /// <param name="session">The persisted session to project.</param>
    /// <param name="isLead">The LIVE lead flag of the session's enrollment (false for every non-staff session).</param>
    /// <returns>The frozen participant-safe session projection.</returns>
    public static SessionDto FromSession(Session session, bool isLead = false)
    {
        ArgumentNullException.ThrowIfNull(session);

        return new SessionDto
        {
            ExerciseId = session.ExerciseId?.ToString(),
            PersonId = session.PersonId?.ToString(),
            World = SessionIssuer.WorldOf(session.Kind),
            Scope = session.ExerciseId is null ? OrgScope : ExerciseScope,
            IsLead = isLead,
            AccountId = session.PrincipalId,
            Role = session.Role,
            PersonaId = session.PersonaId?.ToString(),
            ActingHumanId = session.ActingHumanId,
            IsReadOnly = session.IsReadOnly,
            ExpiresAt = session.ExpiresAt.ToString("O"),
        };
    }
}
