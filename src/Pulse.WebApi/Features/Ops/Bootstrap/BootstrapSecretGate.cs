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
        // Run the fixed-time digest comparison UNCONDITIONALLY (never short-circuit on an unconfigured secret),
        // so a DISABLED endpoint (empty configured secret) and a CONFIGURED-BUT-WRONG one take the identical code
        // path / time — no enabled-state timing oracle (both still 404 at the endpoint). Mirrors
        // DynamisIdentityProvider, which computes the constant-time match first and only THEN combines it with the
        // account-exists / secret-configured checks. AND-ing the configured check keeps an empty configured
        // secret fail-closed: it can never authorize, not even an empty presented secret ("any secret works" is
        // impossible). The `&&` short-circuit here is on the CONFIGURED (non-secret) side only — the secret
        // compare has already run — so it leaks nothing about the presented secret.
        var matches = SecretsMatch(presentedSecret ?? string.Empty, configuredSecret ?? string.Empty);
        return matches && !string.IsNullOrEmpty(configuredSecret);
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
