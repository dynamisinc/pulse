namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The <c>POST /api/auth/shared</c> success response (COR-015): the raw session token/refresh material the
/// story-03 issuer minted (handed to the client exactly once, never persisted in the clear — NFR-009) plus the
/// frozen <see cref="SessionDto"/> projection of the issued VIEW-ONLY session. Mirrors
/// <c>StaffLoginResponseDto</c>'s shape so every login method returns the same <c>{ token, refreshToken?,
/// session }</c> envelope; the session projection reuses the frozen <see cref="SessionDto"/> (XC-002: no
/// provenance), which carries the ephemeral identity as its <c>accountId</c> / <c>actingHumanId</c> and
/// <c>isReadOnly: true</c>. Every property has an explicit <see cref="JsonPropertyNameAttribute"/> (camelCase).
/// </summary>
public sealed class SharedReadOnlyLoginResponseDto
{
    /// <summary>The raw opaque session token to present on subsequent requests (only its hash is persisted).</summary>
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    /// <summary>The raw refresh token, or omitted when the issued session has no refresh material.</summary>
    [JsonPropertyName("refreshToken")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RefreshToken { get; init; }

    /// <summary>The issued view-only session, projected to the frozen participant-safe wire shape.</summary>
    [JsonPropertyName("session")]
    public required SessionDto Session { get; init; }

    /// <summary>Builds the login response from the issuer's result.</summary>
    /// <param name="result">The <see cref="ISessionIssuer"/> result carrying the persisted session + raw token(s).</param>
    /// <returns>The login response DTO.</returns>
    public static SharedReadOnlyLoginResponseDto From(SessionIssueResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new SharedReadOnlyLoginResponseDto
        {
            Token = result.SessionToken,
            RefreshToken = result.RefreshToken,
            Session = SessionDto.FromSession(result.Session),
        };
    }
}
