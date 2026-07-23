namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Security.Cryptography;
using System.Text;

/// <summary>
/// The fail-closed, constant-time gate for the UAT bootstrap endpoint (story login/05, NFR-009). Mirrors
/// <c>DynamisIdentityProvider</c>'s secret comparison exactly: the presented and configured secrets are hashed
/// to SHA-256 digests and compared with <see cref="CryptographicOperations.FixedTimeEquals"/>, so neither the
/// match result nor the secret lengths leak by timing. Never logs either value.
/// </summary>
/// <remarks>
/// Extracted as a pure static helper (no <c>DbContext</c>, no options) so the fail-closed contract is unit
/// testable in isolation — the same shape <c>DynamisIdentityProvider</c>'s secret logic is proven with.
/// </remarks>
public static class BootstrapSecretGate
{
    /// <summary>
    /// Decides whether a presented secret authorizes the bootstrap endpoint. FAILS CLOSED: a null/empty
    /// <paramref name="configuredSecret"/> disables the endpoint entirely (returns <c>false</c> for ANY presented
    /// value — never "any secret works"), and a mismatch returns <c>false</c>. The comparison is constant-time.
    /// </summary>
    /// <param name="configuredSecret">The configured <see cref="BootstrapOptions.Secret"/> (empty when unset).</param>
    /// <param name="presentedSecret">The secret presented in the <c>X-Bootstrap-Secret</c> header (may be <c>null</c>).</param>
    /// <returns><c>true</c> only when the endpoint is configured AND the presented secret matches exactly.</returns>
    public static bool IsAuthorized(string? configuredSecret, string? presentedSecret)
    {
        // Fail closed: an unconfigured (null/empty) secret DISABLES the endpoint entirely — the same
        // "empty configured secret rejects everything" contract the staff allowlist uses. Returning here (rather
        // than comparing against an empty configured value) keeps a disabled endpoint and a wrong secret
        // indistinguishable to the caller (both 404).
        if (string.IsNullOrEmpty(configuredSecret))
        {
            return false;
        }

        return SecretsMatch(presentedSecret ?? string.Empty, configuredSecret);
    }

    /// <summary>
    /// Constant-time secret comparison over SHA-256 digests. Hashing first means the fixed-time compare runs over
    /// equal-length (32-byte) inputs regardless of the raw secret lengths, so neither the match result nor the
    /// secret lengths are leaked by timing. Never logs either value (NFR-009).
    /// </summary>
    private static bool SecretsMatch(string presented, string configured)
    {
        Span<byte> presentedDigest = stackalloc byte[SHA256.HashSizeInBytes];
        Span<byte> configuredDigest = stackalloc byte[SHA256.HashSizeInBytes];

        SHA256.HashData(Encoding.UTF8.GetBytes(presented), presentedDigest);
        SHA256.HashData(Encoding.UTF8.GetBytes(configured), configuredDigest);

        return CryptographicOperations.FixedTimeEquals(presentedDigest, configuredDigest);
    }
}
