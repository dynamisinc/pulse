namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Security.Cryptography;
using System.Text;

/// <summary>
/// The opaque-token primitives for the story-03 auth scheme (COR-012 / NFR-009). A session (and its refresh)
/// reference is a cryptographically-random OPAQUE token — not a JWT, carries no claims — handed to the client
/// exactly once; the server stores only its <see cref="Hash"/> and, on every authenticated request, hashes the
/// presented token and looks the session up by that hash. The raw token is never persisted (NFR-009).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a plain hash (not a password KDF).</b> A session token is a 256-bit value from a cryptographically
/// secure RNG (<see cref="RandomNumberGenerator"/>), so there is nothing to brute-force — an attacker cannot
/// enumerate a 2^256 keyspace, so the slow, salted KDFs that protect low-entropy PASSWORDS buy nothing here.
/// A single fast SHA-256 is the standard treatment for high-entropy bearer references (the same shape GitHub
/// PATs / opaque access tokens use): it lets the store hold only a non-reversible fingerprint while keeping
/// the per-request lookup a single indexed equality match. The hash is deterministic (no salt) precisely so it
/// can be the lookup key.
/// </para>
/// <para>
/// Tokens and hashes are uppercase hex (URL-safe, header-safe, no padding); 32 random bytes → a 64-char token,
/// SHA-256 → a 64-char hash, both well within the frozen 256-char <c>Session.TokenHash</c>/<c>RefreshTokenHash</c>
/// columns. No token or hash is ever logged.
/// </para>
/// </remarks>
public static class SessionTokens
{
    /// <summary>The opaque-token entropy: 32 bytes = 256 bits from a CSPRNG (infeasible to guess/enumerate).</summary>
    private const int TokenByteLength = 32;

    /// <summary>
    /// Generates a fresh cryptographically-random opaque token (uppercase hex). Used for both the session
    /// reference and the refresh reference; the raw value is returned to the caller once and never persisted.
    /// </summary>
    /// <returns>A new 256-bit opaque token as an uppercase hex string.</returns>
    public static string Generate() => Convert.ToHexString(RandomNumberGenerator.GetBytes(TokenByteLength));

    /// <summary>
    /// Computes the stored lookup hash of a raw token: <c>SHA-256(UTF-8(rawToken))</c> as uppercase hex. This
    /// is the value persisted in <c>Session.TokenHash</c>/<c>RefreshTokenHash</c>; the presented token is
    /// hashed the same way for the per-request lookup. Deterministic by design (it is the lookup key).
    /// </summary>
    /// <param name="rawToken">The raw opaque token presented by / handed to the client.</param>
    /// <returns>The uppercase-hex SHA-256 hash of the token.</returns>
    public static string Hash(string rawToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(rawToken);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
    }
}
