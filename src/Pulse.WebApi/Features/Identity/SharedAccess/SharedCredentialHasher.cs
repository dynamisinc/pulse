namespace Pulse.WebApi.Features.Identity.SharedAccess;

using Microsoft.AspNetCore.Identity;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Hashes and verifies the shared, view-only credential's password (COR-015 / NFR-009). A shared password is a
/// LOW-ENTROPY, human-shared secret (an exercise URL + a short password handed to a room of passive
/// participants), so unlike the high-entropy opaque session token — which is a 256-bit CSPRNG value treated
/// with a single fast SHA-256 (see <c>SessionTokens</c>) — it MUST be protected by a slow, salted key-derivation
/// function so a leaked hash cannot be brute-forced offline. This wraps the ASP.NET Core
/// <see cref="PasswordHasher{TUser}"/> (PBKDF2 / HMAC-SHA-512, per-hash random salt, iteration-hardened) and
/// verifies in constant time (<c>PasswordHasher</c> uses <see cref="System.Security.Cryptography.CryptographicOperations.FixedTimeEquals"/>
/// internally, so a wrong password cannot be distinguished by timing). The raw password is never logged.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only two operations, deliberately.</b> Story 06 uses <see cref="Verify"/> to authenticate a shared login
/// against <c>SharedCredential.CurrentHash</c>; <see cref="Hash"/> produces the stored format. The credential
/// LIFECYCLE — rotation-with-grace (<c>PreviousHash</c>), immediate revoke, brute-force lockout — is story 07
/// (Wave 4) and lives in a different slice; this hasher is the shared primitive both use, so hashing here is the
/// SAME format story 07's rotation writes.
/// </para>
/// <para>
/// The <see cref="PasswordHasher{TUser}"/> API threads a <c>TUser</c> instance through hashing/verification for
/// callers whose KDF salts per-user; the default PBKDF2 implementation ignores it (the salt is embedded in the
/// hash), so a single shared sentinel instance is passed. Registered as a singleton — it is stateless and
/// thread-safe.
/// </para>
/// </remarks>
public sealed class SharedCredentialHasher : ISharedCredentialHasher
{
    // The PasswordHasher<T> API requires a TUser instance but the default PBKDF2 implementation never reads it
    // (the salt is per-hash and embedded), so one immutable sentinel is safe to share across all calls.
    private static readonly SharedCredential Sentinel = new();

    private readonly PasswordHasher<SharedCredential> _hasher = new();

    /// <inheritdoc />
    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        return _hasher.HashPassword(Sentinel, password);
    }

    /// <inheritdoc />
    public bool Verify(string? currentHash, string providedPassword)
    {
        // Fail closed: a credential with no stored hash, or an empty submission, authenticates nothing. No
        // early-return timing signal is meaningful here (a missing hash is a configuration state, not a guess).
        if (string.IsNullOrEmpty(currentHash) || string.IsNullOrEmpty(providedPassword))
        {
            return false;
        }

        var result = _hasher.VerifyHashedPassword(Sentinel, currentHash, providedPassword);

        // Success and SuccessRehashNeeded both mean the password matched; the rehash signal (an older KDF
        // format) is a story-07 rotation concern, not an authentication failure — so it is accepted here.
        return result is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
    }
}

/// <summary>
/// The shared-credential password KDF seam (COR-015 / NFR-009). Kept behind an interface so a test can supply a
/// deterministic stand-in and so the slow-KDF choice is a single, reviewable implementation detail. The raw
/// password is never logged by any implementation.
/// </summary>
public interface ISharedCredentialHasher
{
    /// <summary>
    /// Produces the stored hash of a shared password in the slow-KDF format persisted to
    /// <c>SharedCredential.CurrentHash</c>. Throws when <paramref name="password"/> is null/empty.
    /// </summary>
    /// <param name="password">The raw shared password (never logged).</param>
    /// <returns>The PBKDF2-format hash to persist.</returns>
    string Hash(string password);

    /// <summary>
    /// Verifies a submitted password against a stored hash in constant time. Fails closed (returns
    /// <c>false</c>) when the stored hash is null/empty or the submission is empty — never throws for a bad
    /// guess.
    /// </summary>
    /// <param name="currentHash">The stored <c>SharedCredential.CurrentHash</c>, or <c>null</c> when unset.</param>
    /// <param name="providedPassword">The raw submitted password (never logged).</param>
    /// <returns><c>true</c> only when the submission matches the stored hash.</returns>
    bool Verify(string? currentHash, string providedPassword);
}
