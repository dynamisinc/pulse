namespace Pulse.WebApi.Features.Identity.Accounts;

using System.Security.Cryptography;
using System.Text;

/// <summary>
/// The participant-credential hasher (story 02, NFR-004/NFR-009). A participant password is a LOW-ENTROPY human
/// secret, so — unlike the fast SHA-256 used for high-entropy session TOKENS (<c>SessionTokens</c>) — it is
/// protected with a deliberately SLOW, salted key-derivation function (PBKDF2-HMAC-SHA256, the same primitive
/// ASP.NET Core's <c>PasswordHasher&lt;T&gt;</c> v3 format uses), so an offline attacker who exfiltrates the
/// <c>Account.CredentialHash</c> column cannot cheaply brute-force it. Stateless and thread-safe → registered as
/// a singleton.
/// </summary>
/// <remarks>
/// <para>
/// <b>Format.</b> <see cref="Hash"/> returns a self-describing string
/// <c>PBKDF2$SHA256${iterations}${saltBase64}${subkeyBase64}</c> so the parameters travel WITH the hash and a
/// future iteration-count bump verifies old hashes unchanged. A fresh 128-bit salt is drawn per call from a
/// CSPRNG; the derived subkey is 256-bit. The plaintext is never stored, never logged, and never returned on any
/// response (NFR-009).
/// </para>
/// <para>
/// <b>Constant-time verify + enumeration resistance.</b> <see cref="Verify"/> compares with
/// <see cref="CryptographicOperations.FixedTimeEquals"/> (no early-out on the first differing byte). When the
/// account is unknown or has no credential set, it still runs an equivalent PBKDF2 derivation against a fixed
/// dummy salt before returning <c>false</c>, so response timing does not distinguish "unknown handle" /
/// "no credential" from "wrong password" — closing a user-enumeration oracle, mirroring
/// <c>DynamisIdentityProvider</c>.
/// </para>
/// <para>
/// <b>Chosen over a package dependency (flagged for review).</b> The <c>Account</c> entity's XML doc describes
/// the column as a <c>PasswordHasher&lt;T&gt;</c>-format hash; this type deliberately uses the SAME PBKDF2
/// primitive via the base-class-library <see cref="Rfc2898DeriveBytes"/> rather than taking a new dependency on
/// <c>Microsoft.Extensions.Identity.Core</c>, keeping the slice self-contained. The security contract (slow,
/// salted, non-reversible, constant-time verify) is identical; the envelope string differs.
/// </para>
/// </remarks>
public sealed class ParticipantPasswordHasher
{
    private const string Prefix = "PBKDF2";
    private const string AlgorithmLabel = "SHA256";
    private const int Iterations = 100_000;
    private const int SaltByteLength = 16;
    private const int SubkeyByteLength = 32;

    /// <summary>A fixed, non-secret salt used only to burn equivalent CPU time when there is no real hash to verify.</summary>
    private static readonly byte[] DummySalt = new byte[SaltByteLength];

    private static readonly HashAlgorithmName Algorithm = HashAlgorithmName.SHA256;

    /// <summary>
    /// Derives a fresh, salted slow-KDF hash of <paramref name="password"/> for storage in
    /// <c>Account.CredentialHash</c>. Never returns or logs the plaintext.
    /// </summary>
    /// <param name="password">The plaintext participant password (already length-validated by the caller).</param>
    /// <returns>The self-describing <c>PBKDF2$SHA256$…</c> hash string.</returns>
    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);

        var salt = RandomNumberGenerator.GetBytes(SaltByteLength);
        var subkey = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, Iterations, Algorithm, SubkeyByteLength);

        return string.Join(
            '$',
            Prefix,
            AlgorithmLabel,
            Iterations.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Convert.ToBase64String(salt),
            Convert.ToBase64String(subkey));
    }

    /// <summary>
    /// Constant-time check of <paramref name="providedPassword"/> against a stored hash. Returns <c>false</c>
    /// (after an equivalent time-burn) when <paramref name="storedHash"/> is <c>null</c>/empty or malformed, so
    /// an unknown handle / credential-less account is indistinguishable by timing from a wrong password.
    /// </summary>
    /// <param name="storedHash">The stored <c>Account.CredentialHash</c>, or <c>null</c> when none is set.</param>
    /// <param name="providedPassword">The plaintext password presented at login (never logged).</param>
    /// <returns><c>true</c> only when a real hash is present and the password matches; otherwise <c>false</c>.</returns>
    public bool Verify(string? storedHash, string providedPassword)
    {
        ArgumentNullException.ThrowIfNull(providedPassword);

        if (string.IsNullOrEmpty(storedHash) || !TryParse(storedHash, out var iterations, out var salt, out var expectedSubkey))
        {
            // No/'malformed hash: burn equivalent PBKDF2 time against a dummy salt, then fail closed.
            _ = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(providedPassword), DummySalt, Iterations, Algorithm, SubkeyByteLength);
            return false;
        }

        var actualSubkey = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(providedPassword), salt, iterations, Algorithm, expectedSubkey.Length);

        return CryptographicOperations.FixedTimeEquals(actualSubkey, expectedSubkey);
    }

    /// <summary>Parses a <c>PBKDF2$SHA256${iterations}${saltBase64}${subkeyBase64}</c> string; fails closed on any deviation.</summary>
    private static bool TryParse(string hash, out int iterations, out byte[] salt, out byte[] subkey)
    {
        iterations = 0;
        salt = [];
        subkey = [];

        var parts = hash.Split('$');
        if (parts.Length != 5 ||
            !string.Equals(parts[0], Prefix, StringComparison.Ordinal) ||
            !string.Equals(parts[1], AlgorithmLabel, StringComparison.Ordinal) ||
            !int.TryParse(parts[2], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out iterations) ||
            iterations <= 0)
        {
            return false;
        }

        try
        {
            salt = Convert.FromBase64String(parts[3]);
            subkey = Convert.FromBase64String(parts[4]);
        }
        catch (FormatException)
        {
            return false;
        }

        return salt.Length > 0 && subkey.Length > 0;
    }
}
