namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/staff/shared-credential/rotate</c> success response (story 07). Carries the freshly-generated
/// shared password in the CLEAR — this is the ONE and only time the plaintext is exposed; it is never persisted
/// unhashed and never returned again (NFR-009). Staff read it once here and announce it to the room. This is a
/// STAFF-world response (the caller is an authenticated staff user reading its own write), so it is not subject
/// to the participant-facing XC-002 provenance-omission rule. Every property has an explicit
/// <see cref="JsonPropertyNameAttribute"/> (camelCase).
/// </summary>
public sealed class SharedCredentialRotateResponseDto
{
    /// <summary>The fresh plaintext shared password — shown exactly once; never persisted in the clear.</summary>
    [JsonPropertyName("password")]
    public required string Password { get; init; }

    /// <summary>
    /// ISO-8601 instant (round-trip) after which the PREVIOUS password stops authenticating, or omitted when no
    /// old password was carried into a grace window (a rotation of a disabled/revoked/never-set credential).
    /// </summary>
    [JsonPropertyName("graceExpiresAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? GraceExpiresAt { get; init; }

    /// <summary>Builds the rotate response from the service result.</summary>
    /// <param name="result">The rotation result (must be a rotated outcome carrying the new password).</param>
    /// <returns>The rotate response DTO.</returns>
    public static SharedCredentialRotateResponseDto From(SharedCredentialRotateResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new SharedCredentialRotateResponseDto
        {
            Password = result.NewPassword ?? throw new InvalidOperationException(
                "A rotated result must carry the freshly-generated password."),
            GraceExpiresAt = result.GraceExpiresAt?.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        };
    }
}

/// <summary>
/// The <c>POST /api/staff/shared-credential/revoke</c> success response (story 07): confirmation plus the count
/// of active read-only sessions terminated by the immediate revoke. A STAFF-world response (no participant
/// surface, no provenance concern). Every property has an explicit <see cref="JsonPropertyNameAttribute"/>.
/// </summary>
public sealed class SharedCredentialRevokeResponseDto
{
    /// <summary>Always <c>true</c> on a successful revoke — the credential is now revoked/disabled with no grace.</summary>
    [JsonPropertyName("revoked")]
    public required bool Revoked { get; init; }

    /// <summary>How many active read-only sessions were terminated by the revoke (0 when none were live).</summary>
    [JsonPropertyName("terminatedSessions")]
    public required int TerminatedSessions { get; init; }

    /// <summary>Builds the revoke response from the service result.</summary>
    /// <param name="result">The revocation result.</param>
    /// <returns>The revoke response DTO.</returns>
    public static SharedCredentialRevokeResponseDto From(SharedCredentialRevokeResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new SharedCredentialRevokeResponseDto
        {
            Revoked = true,
            TerminatedSessions = result.TerminatedSessionCount,
        };
    }
}
