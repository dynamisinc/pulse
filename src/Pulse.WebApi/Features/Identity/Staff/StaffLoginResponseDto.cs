namespace Pulse.WebApi.Features.Identity.Staff;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The <c>POST /api/auth/staff/login</c> success response: the raw session token/refresh material the story-03
/// issuer minted (handed to the client exactly once, never persisted in the clear — NFR-009) plus the frozen
/// <see cref="SessionDto"/> projection of the issued session.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cross-wave seam.</b> HOW the client subsequently presents the token (Authorization header vs. cookie)
/// and the token lifecycle are story 03's auth scheme. This story returns the raw token from the
/// <see cref="ISessionIssuer"/> result in the login response body so the client has it once; story 03
/// reconciles the delivery/consumption mechanism. The <see cref="Session"/> projection reuses the frozen
/// <see cref="SessionDto"/> shape (XC-002: no provenance).
/// </para>
/// </remarks>
public sealed class StaffLoginResponseDto
{
    /// <summary>The raw opaque session token to present on subsequent requests (only its hash is persisted).</summary>
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    /// <summary>The raw refresh token, or omitted when the issued session has no refresh material.</summary>
    [JsonPropertyName("refreshToken")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RefreshToken { get; init; }

    /// <summary>The issued session, projected to the frozen participant-safe wire shape.</summary>
    [JsonPropertyName("session")]
    public required SessionDto Session { get; init; }

    /// <summary>Builds the login response from the issuer's result.</summary>
    /// <param name="result">The <see cref="ISessionIssuer"/> result carrying the persisted session + raw token(s).</param>
    /// <returns>The login response DTO.</returns>
    public static StaffLoginResponseDto From(SessionIssueResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new StaffLoginResponseDto
        {
            Token = result.SessionToken,
            RefreshToken = result.RefreshToken,
            Session = SessionDto.FromSession(result.Session),
        };
    }
}
