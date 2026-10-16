namespace Pulse.WebApi.Features.Identity.Providers;

using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The Pulse password provider (ADMIN-IDENTITY-MODEL §1.3, identity-auth-roles/16): authenticates a staff human
/// against their <see cref="Person"/>'s own password hash, CHAINED in front of the config-allowlist
/// <see cref="DynamisIdentityProvider"/> for the A1→A2 interim. It is the default <see cref="IIdentityProvider"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The chain (§1.3, "Interim between A1 and A2").</b>
/// <list type="number">
///   <item><description>If the <see cref="Person"/> named by the credentials (the login handle as an email, in the
///   organization the caller resolved) has a <see cref="Person.PasswordHash"/>, this provider is AUTHORITATIVE: the
///   password verifies or the attempt is rejected — there is no fallback.</description></item>
///   <item><description>Otherwise the Dynamis allowlist is tried, keyed on <see cref="StaffUser.ExternalSubject"/>,
///   so every backfilled legacy staff member signs in exactly as before. An allowlist success for a staff human
///   whose person HAS a Pulse password is still rejected — Pulse stays authoritative for them.</description></item>
/// </list>
/// Invites and resets (<c>CredentialToken</c>) arrive in A2; until then no person carries a Pulse password, so the
/// second step is what every sign-in takes. The provider itself stays stateless: the per-person lockout (§3.2) is
/// applied by each login funnel around it — <c>OrgStaffLoginService</c> and, for the people
/// <see cref="FindPasswordPersonAsync"/> names, <c>StaffLoginService</c> — so one attempt is counted exactly once.
/// </para>
/// <para>
/// <b>Never logs or returns the secret or the hash</b> (NFR-004 / NFR-009). The person read is bounded by the
/// SERVER-resolved organization (<see cref="StaffCredentials.OrganizationId"/>); without one this step is skipped.
/// </para>
/// </remarks>
public sealed class PulsePasswordIdentityProvider : IIdentityProvider
{
    private static readonly Person HashSubject = new() { DisplayName = string.Empty };

    private readonly PulseDbContext _dbContext;
    private readonly DynamisIdentityProvider _fallback;
    private readonly PasswordHasher<Person> _hasher = new();

    /// <summary>Creates the chained provider.</summary>
    /// <param name="dbContext">The persistence context the person and staff facet are read through.</param>
    /// <param name="fallback">The break-glass allowlist provider tried for people without a Pulse password.</param>
    public PulsePasswordIdentityProvider(PulseDbContext dbContext, DynamisIdentityProvider fallback)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(fallback);

        _dbContext = dbContext;
        _fallback = fallback;
    }

    /// <inheritdoc />
    public async Task<StaffAuthenticationResult> AuthenticateAsync(
        StaffCredentials credentials,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);

        var person = await FindPasswordPersonAsync(_dbContext, credentials.Username, credentials.OrganizationId, cancellationToken);
        if (person is { PasswordHash: { Length: > 0 } passwordHash, OrganizationId: var organizationId })
        {
            // Step 1: Pulse is authoritative — verify, or reject. Never fall back.
            return await AuthenticatePulsePasswordAsync(person, passwordHash, credentials.Secret, organizationId, cancellationToken);
        }

        // Step 2: the break-glass allowlist, for people with no Pulse password (every backfilled legacy staffer).
        var fallback = await _fallback.AuthenticateAsync(credentials, cancellationToken);
        if (fallback.Outcome != StaffAuthenticationOutcome.Authenticated || fallback.Identity is null)
        {
            return fallback;
        }

        return await HasPulsePasswordAsync(fallback.Identity.ExternalSubject, cancellationToken)
            ? Rejected()
            : fallback;
    }

    /// <summary>
    /// THE definition of "a person this provider is authoritative for": the <see cref="Person"/> named by
    /// <paramref name="handle"/> (as an email) in the SERVER-resolved <paramref name="organizationId"/>, when that person
    /// carries a Pulse password. Shared with the exercise-bound staff login (identity-auth-roles/15, Gate-1 M-3), which
    /// applies the per-person lockout and disable to exactly these people — never to an allowlist-only staffer, whose
    /// legacy behaviour stays unchanged. The row is TRACKED so the caller can record a failure or success on it in its
    /// own unit of work.
    /// </summary>
    /// <param name="dbContext">The persistence context to read through.</param>
    /// <param name="handle">The presented login handle.</param>
    /// <param name="organizationId">The server-resolved organization; <c>null</c> / empty finds no one.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The person with a Pulse password, or <c>null</c>.</returns>
    public static async Task<Person?> FindPasswordPersonAsync(
        PulseDbContext dbContext,
        string? handle,
        Guid? organizationId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var email = NormalizeEmail(handle);
        if (email is null || organizationId is not { } organization || organization == Guid.Empty)
        {
            return null;
        }

        var person = await dbContext.People
            .InOrganization(organization)
            .FirstOrDefaultAsync(p => p.Email == email, cancellationToken);

        return person is { PasswordHash: { Length: > 0 } } ? person : null;
    }

    /// <summary>Normalizes a login handle to the stored email form, or <c>null</c> when it is not an email.</summary>
    /// <param name="handle">The presented login handle.</param>
    /// <returns>The trimmed, lower-case email, or <c>null</c>.</returns>
    public static string? NormalizeEmail(string? handle)
    {
        var trimmed = handle?.Trim();
        return string.IsNullOrEmpty(trimmed) || !trimmed.Contains('@', StringComparison.Ordinal) || trimmed.Length > Person.MaxEmailLength
            ? null
            : trimmed.ToLowerInvariant();
    }

    private static StaffAuthenticationResult Rejected() => new() { Outcome = StaffAuthenticationOutcome.Rejected };

    private async Task<StaffAuthenticationResult> AuthenticatePulsePasswordAsync(
        Person person,
        string passwordHash,
        string secret,
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        if (!Verify(passwordHash, secret) || person.DisabledAt is not null)
        {
            return Rejected();
        }

        // The staff facet shares the person's id; a person with no staff facet holds no staff enrollment, so there is
        // no staff identity to sign in as.
        var staffUser = await _dbContext.StaffUsers
            .AsNoTracking()
            .InOrganization(organizationId)
            .FirstOrDefaultAsync(u => u.Id == person.Id, cancellationToken);

        if (staffUser is null)
        {
            return Rejected();
        }

        return new StaffAuthenticationResult
        {
            Outcome = StaffAuthenticationOutcome.Authenticated,
            Identity = new StaffIdentity
            {
                ExternalSubject = staffUser.ExternalSubject,
                DisplayName = person.DisplayName,
                Username = staffUser.Username,
            },
        };
    }

    private async Task<bool> HasPulsePasswordAsync(string externalSubject, CancellationToken cancellationToken)
    {
        // org-scope-exempt(ResolutionRoot): IdP subject → staff human, before any session or tenant exists — the same
        // resolve-by-subject read StaffLoginService performs. The row it finds CARRIES the tenant bounding the next read.
        var facet = await _dbContext.StaffUsers
            .AsNoTracking()
            .Where(u => u.ExternalSubject == externalSubject)
            .Select(u => new { u.Id, u.OrganizationId })
            .FirstOrDefaultAsync(cancellationToken);

        return facet is not null
            && await _dbContext.People
                .AsNoTracking()
                .InOrganization(facet.OrganizationId)
                .AnyAsync(p => p.Id == facet.Id && p.PasswordHash != null && p.PasswordHash != string.Empty, cancellationToken);
    }

    private bool Verify(string storedHash, string providedPassword)
    {
        try
        {
            return _hasher.VerifyHashedPassword(HashSubject, storedHash, providedPassword) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            // A malformed stored hash fails closed rather than throwing.
            return false;
        }
    }
}
