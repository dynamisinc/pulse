namespace Pulse.WebApi.Features.Identity.Providers;

using Microsoft.AspNetCore.Identity;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// THE slow-hash (PBKDF2) verification seam of staff sign-in (#602 M-2 / M-5): every Pulse-password verification —
/// real (<see cref="PulsePasswordIdentityProvider"/>) or dummy (the login funnels' padding) — goes through ONE
/// instance per request, which counts them. The login funnels then pad the request to a FIXED number of slow
/// verifications (<see cref="PadTo"/>), so the PBKDF2 work a request performs is independent of whether the slug or
/// email exists, whether the person has a Pulse password, whether a candidate is locked out, and how many candidates
/// share the email — closing the timing side channels of a variable verification count.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scoped</b> (one per request, shared by the provider and the funnel through DI), over the singleton
/// <see cref="IPasswordHasher{TUser}"/> — the default <see cref="PasswordHasher{TUser}"/> (PBKDF2 / HMAC-SHA-512),
/// the same format every stored <see cref="Person.PasswordHash"/> and the dummy hash below are written in, so a dummy
/// verification costs exactly what a real one does. Tests substitute a counting hasher to assert the count.
/// </para>
/// <para>Never logs or returns the secret or a hash (NFR-004 / NFR-009).</para>
/// </remarks>
public sealed class StaffPasswordVerifier
{
    // The PasswordHasher<T> API threads a TUser instance through, but the default PBKDF2 implementation never reads it.
    private static readonly Person HashSubject = new() { DisplayName = string.Empty };

    /// <summary>A throwaway hash (of a random value no submission will ever equal) in the stored format.</summary>
    private static readonly Lazy<string> DummyHash = new(() =>
        new PasswordHasher<Person>().HashPassword(HashSubject, Guid.NewGuid().ToString("N")));

    private readonly IPasswordHasher<Person> _hasher;

    /// <summary>Creates the verifier over the password hasher.</summary>
    /// <param name="hasher">The PBKDF2 password hasher (the default <see cref="PasswordHasher{TUser}"/>).</param>
    public StaffPasswordVerifier(IPasswordHasher<Person> hasher)
    {
        ArgumentNullException.ThrowIfNull(hasher);
        _hasher = hasher;
    }

    /// <summary>How many slow-hash verifications (real and dummy) this instance has performed.</summary>
    public int SlowVerifications { get; private set; }

    /// <summary>Verifies <paramref name="password"/> against a stored hash (one counted slow verification).</summary>
    /// <param name="storedHash">The stored <see cref="Person.PasswordHash"/>.</param>
    /// <param name="password">The presented password (never logged).</param>
    /// <returns><c>true</c> when it matches; a malformed stored hash fails closed.</returns>
    public bool Verify(string storedHash, string password)
    {
        ArgumentNullException.ThrowIfNull(storedHash);
        ArgumentNullException.ThrowIfNull(password);

        SlowVerifications++;
        try
        {
            return _hasher.VerifyHashedPassword(HashSubject, storedHash, password) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            // A malformed stored hash fails closed rather than throwing.
            return false;
        }
    }

    /// <summary>
    /// Performs dummy slow verifications until <see cref="SlowVerifications"/> reaches <paramref name="target"/> (no-op
    /// when it already has), so every attempt of a funnel costs the same PBKDF2 work.
    /// </summary>
    /// <param name="target">The fixed total this request must reach.</param>
    /// <param name="password">The presented password (hashed against the dummy; never logged).</param>
    public void PadTo(int target, string password)
    {
        ArgumentNullException.ThrowIfNull(password);

        while (SlowVerifications < target)
        {
            _ = Verify(DummyHash.Value, password);
        }
    }
}
