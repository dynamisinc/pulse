namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Buffers.Text;
using System.Security.Cryptography;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The personal-link token primitives (EL-5). A link token is 128 bits from a CSPRNG, written as base64url
/// (22 characters, no padding) so it sits in a URL path segment with no escaping. The server stores only its
/// <see cref="Hash"/> for lookup (plus an encrypted copy, see <see cref="IParticipantLinkTokenProtector"/>); the raw
/// token is never persisted, logged or put in telemetry.
/// </summary>
/// <remarks>
/// <see cref="Hash"/> is exactly <see cref="SessionTokens.Hash"/>: a plain SHA-256 is the right treatment for a
/// high-entropy bearer reference (nothing to brute-force in a 2^128 space) and it keeps the join lookup a single
/// indexed equality match, the same shape as the session lookup. Deterministic by design (it is the lookup key).
/// </remarks>
public static class ParticipantLinkTokens
{
    /// <summary>The token entropy in bytes: 16 bytes = 128 bits.</summary>
    public const int TokenByteLength = 16;

    /// <summary>The length of a generated token: 16 bytes as unpadded base64url is 22 characters.</summary>
    public const int TokenLength = 22;

    /// <summary>Generates a fresh random link token: 16 CSPRNG bytes as unpadded base64url (22 characters).</summary>
    /// <returns>A new raw link token. Hand it out once (inside the join URL); persist only its hash.</returns>
    public static string Generate() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenByteLength));

    /// <summary>
    /// The stored lookup hash of a raw link token: <see cref="SessionTokens.Hash"/> (SHA-256 of the UTF-8 bytes, as
    /// 64 upper-case hex characters). The value persisted in <c>ParticipantLink.TokenHash</c>.
    /// </summary>
    /// <param name="rawToken">The raw token from the join URL.</param>
    /// <returns>The 64-character upper-case hex hash.</returns>
    public static string Hash(string rawToken) => SessionTokens.Hash(rawToken);
}
