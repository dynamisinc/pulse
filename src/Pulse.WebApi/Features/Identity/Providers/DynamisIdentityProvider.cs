namespace Pulse.WebApi.Features.Identity.Providers;

using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

/// <summary>
/// The Phase-1 concrete <see cref="IIdentityProvider"/> — a config-driven staff allowlist
/// (<see cref="DynamisIdentityProviderOptions"/>) that authenticates a staff credential and resolves the
/// external <see cref="StaffIdentity"/> a <c>StaffUser</c> is provisioned from (COR-014). It exists ONLY behind
/// the interface: a future Entra ID / AD / SSO / Cadence-federation (E9) provider replaces this concrete type
/// with no change to any call site (the staff-login endpoint depends on <see cref="IIdentityProvider"/>, never
/// on this class).
/// </summary>
/// <remarks>
/// <para>
/// <b>PHASE-1 STUB — flagged for Tier-2 human sign-off.</b> Real staff authentication (Entra/AD/SSO) is
/// explicitly out of scope for this story; this stand-in lets the staff-login path be built and tested behind
/// the seam. It is deliberately fail-closed: an empty allowlist, an unknown username, an entry with an empty
/// secret / subject, or a secret mismatch all yield <see cref="StaffAuthenticationOutcome.Rejected"/> with NO
/// resolved identity.
/// </para>
/// <para>
/// <b>Never logs the secret (NFR-009).</b> This type has no logger and never surfaces the presented or
/// configured secret. Secret comparison is constant-time over SHA-256 digests
/// (<see cref="CryptographicOperations.FixedTimeEquals"/>), and a comparison is performed even when the
/// username is unknown, so response timing does not distinguish "unknown user" from "wrong secret"
/// (user-enumeration resistance).
/// </para>
/// </remarks>
public sealed class DynamisIdentityProvider : IIdentityProvider
{
    private readonly DynamisIdentityProviderOptions _options;

    /// <summary>Creates the provider over its bound allowlist options.</summary>
    /// <param name="options">The bound Phase-1 allowlist options.</param>
    public DynamisIdentityProvider(IOptions<DynamisIdentityProviderOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value ?? new DynamisIdentityProviderOptions();
    }

    /// <inheritdoc />
    public Task<StaffAuthenticationResult> AuthenticateAsync(
        StaffCredentials credentials,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);

        // Resolve the allowlist entry (case-insensitive handle). Only entries that could ever authenticate —
        // a non-empty configured secret AND a non-empty external subject to map to — are considered.
        var account = _options.Accounts.FirstOrDefault(a =>
            !string.IsNullOrEmpty(a.ExternalSubject)
            && !string.IsNullOrEmpty(a.Secret)
            && string.Equals(a.Username, credentials.Username, StringComparison.OrdinalIgnoreCase));

        // Always compare (against a placeholder when the user is unknown) so timing does not leak whether the
        // username exists — the whole reason the comparison is unconditional and constant-time.
        var configuredSecret = account?.Secret ?? string.Empty;
        var secretMatches = SecretMatches(credentials.Secret, configuredSecret);

        if (account is null || !secretMatches)
        {
            return Task.FromResult(new StaffAuthenticationResult
            {
                Outcome = StaffAuthenticationOutcome.Rejected,
            });
        }

        return Task.FromResult(new StaffAuthenticationResult
        {
            Outcome = StaffAuthenticationOutcome.Authenticated,
            Identity = new StaffIdentity
            {
                ExternalSubject = account.ExternalSubject,
                DisplayName = account.DisplayName,
                Username = string.IsNullOrEmpty(account.Username) ? null : account.Username,
            },
        });
    }

    /// <summary>
    /// Constant-time secret comparison over SHA-256 digests. Hashing first means the fixed-time compare runs
    /// over equal-length (32-byte) inputs regardless of the raw secret lengths, so neither the match result nor
    /// the secret lengths are leaked by timing. Never logs either value (NFR-009).
    /// </summary>
    private static bool SecretMatches(string presented, string configured)
    {
        Span<byte> presentedDigest = stackalloc byte[SHA256.HashSizeInBytes];
        Span<byte> configuredDigest = stackalloc byte[SHA256.HashSizeInBytes];

        SHA256.HashData(Encoding.UTF8.GetBytes(presented), presentedDigest);
        SHA256.HashData(Encoding.UTF8.GetBytes(configured), configuredDigest);

        return CryptographicOperations.FixedTimeEquals(presentedDigest, configuredDigest);
    }
}
