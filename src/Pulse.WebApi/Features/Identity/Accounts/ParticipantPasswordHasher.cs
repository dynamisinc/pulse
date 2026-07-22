namespace Pulse.WebApi.Features.Identity.Accounts;

using Microsoft.AspNetCore.Identity;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The participant-credential hasher (story 02, NFR-004/NFR-009). A participant password is a LOW-ENTROPY human
/// secret, so — unlike the fast SHA-256 used for high-entropy session TOKENS (<c>SessionTokens</c>) — it is
/// protected with a deliberately SLOW, salted key-derivation function. It wraps the ASP.NET Core shared-framework
/// <see cref="PasswordHasher{TUser}"/> (PBKDF2, versioned envelope, per-hash random salt, framework-provided
/// constant-time verify), so an offline attacker who exfiltrates the <c>Account.CredentialHash</c> column cannot
/// cheaply brute-force it. Stateless and thread-safe → registered as a singleton.
/// </summary>
/// <remarks>
/// <para>
/// <b>Framework format, one identity tier (Gate-1).</b> The stored value is exactly a
/// <see cref="PasswordHasher{TUser}"/>-format hash — matching the <c>Account.CredentialHash</c> contract and the
/// shared-credential hasher (story 06) — so story 07's credential lifecycle / lockout and any AAR credential
/// audit can verify story-02 credentials with a plain <c>PasswordHasher&lt;Account&gt;</c>. The plaintext is
/// never stored, never logged, and never returned on any response (NFR-009).
/// </para>
/// <para>
/// <b>Enumeration resistance + fail closed.</b> When the account is unknown or has no credential set,
/// <see cref="Verify"/> still runs an equivalent framework verify against a fixed decoy hash before returning
/// <c>false</c>, so response timing / code path does not distinguish "unknown handle" / "no credential" from
/// "wrong password" — closing a user-enumeration oracle, mirroring <c>DynamisIdentityProvider</c>. A malformed
/// stored hash fails closed (rejects) rather than throwing.
/// </para>
/// </remarks>
public sealed class ParticipantPasswordHasher
{
    /// <summary>
    /// A throwaway <see cref="Account"/> the framework hasher requires as its <c>TUser</c> argument; the default
    /// <see cref="PasswordHasher{TUser}"/> implementation ignores the instance entirely (its salt is random,
    /// derived per call), so a shared, empty subject is safe and stateless.
    /// </summary>
    private static readonly Account HashSubject = new() { Username = string.Empty, DisplayName = string.Empty, Role = string.Empty };

    private readonly PasswordHasher<Account> _hasher = new();
    private readonly string _decoyHash;

    /// <summary>Creates the hasher and precomputes the decoy hash used by the enumeration-resistant verify path.</summary>
    public ParticipantPasswordHasher() =>
        _decoyHash = _hasher.HashPassword(HashSubject, "pulse-participant-enumeration-decoy");

    /// <summary>
    /// Derives a fresh, salted slow-KDF hash of <paramref name="password"/> for storage in
    /// <c>Account.CredentialHash</c>. Never returns or logs the plaintext.
    /// </summary>
    /// <param name="password">The plaintext participant password (already length-validated by the caller).</param>
    /// <returns>The framework <see cref="PasswordHasher{TUser}"/>-format hash string.</returns>
    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        return _hasher.HashPassword(HashSubject, password);
    }

    /// <summary>
    /// Constant-time (framework-provided) check of <paramref name="providedPassword"/> against a stored hash.
    /// Returns <c>false</c> — after an equivalent verify against the decoy — when <paramref name="storedHash"/>
    /// is <c>null</c>/empty or malformed, so an unknown handle / credential-less account is indistinguishable by
    /// timing or path from a wrong password.
    /// </summary>
    /// <param name="storedHash">The stored <c>Account.CredentialHash</c>, or <c>null</c> when none is set.</param>
    /// <param name="providedPassword">The plaintext password presented at login (never logged).</param>
    /// <returns><c>true</c> only when a real hash is present and the password matches; otherwise <c>false</c>.</returns>
    public bool Verify(string? storedHash, string providedPassword)
    {
        ArgumentNullException.ThrowIfNull(providedPassword);

        if (string.IsNullOrEmpty(storedHash))
        {
            // No credential set: run an equivalent verify against the decoy, then fail closed.
            _ = _hasher.VerifyHashedPassword(HashSubject, _decoyHash, providedPassword);
            return false;
        }

        try
        {
            var result = _hasher.VerifyHashedPassword(HashSubject, storedHash, providedPassword);
            return result is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
        }
        catch (FormatException)
        {
            // A corrupt / non-framework hash string can never authenticate — fail closed, never throw.
            return false;
        }
    }
}
