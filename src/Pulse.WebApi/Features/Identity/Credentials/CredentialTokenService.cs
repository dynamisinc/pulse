namespace Pulse.WebApi.Features.Identity.Credentials;

using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The lifecycle of single-use invite and reset tokens (identity-auth-roles/21, ADMIN-IDENTITY-MODEL §3.3): issue
/// (returning the raw token ONCE, storing only its SHA-256), find a redeemable token with a uniform failure, claim it
/// exactly once, and void every outstanding token of an identity whose credential changed.
/// </summary>
/// <remarks>
/// <para>
/// <b>The token.</b> 32 bytes from the OS CSPRNG, base64url-encoded (43 URL-safe characters, no padding). Stored as the
/// upper-case hex SHA-256 (<see cref="SessionTokens.Hash"/>, the same primitive sessions and the org choice use); the
/// raw value exists only in the issue result and is never persisted or logged.
/// </para>
/// <para>
/// <b>Lifetimes</b>: <see cref="ResetLifetime"/> and <see cref="InviteLifetime"/>. <b>Issuing voids</b> the identity's
/// earlier unused tokens of the SAME purpose (a reset leaves an outstanding invite alone, and vice versa) — the
/// credential-change invalidation (<see cref="StageCredentialChangeInvalidationAsync"/>) is what voids both.
/// </para>
/// <para>
/// <b>Uniform failure.</b> <see cref="FindRedeemableAsync"/> answers <c>null</c> for a missing, malformed, unknown,
/// expired, used or voided token alike, and <see cref="TryClaimAsync"/> is ONE conditional statement
/// (<c>UsedAt IS NULL AND ExpiresAt &gt; now</c>), so two concurrent redemptions of one token cannot both win.
/// </para>
/// <para>
/// <b>Tenant.</b> <see cref="CredentialToken"/> is an org-owned RESOLUTION ROOT: the by-hash lookup is the one
/// unbounded read (it is how the tenant is discovered); every other read here is
/// <see cref="OrganizationScope.InOrganization{TEntity}"/>-bounded.
/// </para>
/// </remarks>
public sealed class CredentialTokenService
{
    /// <summary>How long a reset token may be redeemed (§3.3).</summary>
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromMinutes(60);

    /// <summary>How long an invite token may be redeemed (§3.3).</summary>
    public static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);

    /// <summary>The number of random bytes in a raw token.</summary>
    public const int TokenByteLength = 32;

    /// <summary>The longest raw token accepted for a lookup (an issued one is 43 characters).</summary>
    public const int MaxRawTokenLength = 256;

    private readonly PulseDbContext _dbContext;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (the caller's unit of work).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    public CredentialTokenService(PulseDbContext dbContext, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _timeProvider = timeProvider;
    }

    /// <summary>The lifetime of a token of <paramref name="purpose"/>.</summary>
    /// <param name="purpose">A <see cref="CredentialTokenPurposes"/> value.</param>
    /// <returns>The lifetime.</returns>
    public static TimeSpan LifetimeFor(string purpose) => purpose switch
    {
        CredentialTokenPurposes.Reset => ResetLifetime,
        CredentialTokenPurposes.Invite => InviteLifetime,
        _ => throw new ArgumentOutOfRangeException(nameof(purpose), purpose, "Not a credential-token purpose."),
    };

    /// <summary>
    /// STAGES (does not save) a new token of <paramref name="purpose"/> for one identity, and voids that identity's
    /// earlier unused tokens of the same purpose in the same unit of work. The caller saves — together with its own
    /// audit record — so the token, the voiding and the record commit or fail as one.
    /// </summary>
    /// <param name="purpose">Invite or reset.</param>
    /// <param name="subject">The person or the one-off account the token sets a password for.</param>
    /// <param name="organizationId">The subject's own organization (server-resolved, never a client value).</param>
    /// <param name="issuedByPersonId">The issuing person (an admin), or <c>null</c>.</param>
    /// <param name="now">The single wall-clock read of the calling operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staged row and the raw token, which exists ONLY here.</returns>
    public async Task<IssuedCredentialToken> StageIssueAsync(
        string purpose,
        CredentialSubject subject,
        Guid organizationId,
        Guid? issuedByPersonId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(subject);
        if (!CredentialTokenPurposes.IsDefined(purpose))
        {
            throw new ArgumentOutOfRangeException(nameof(purpose), purpose, "Not a credential-token purpose.");
        }

        if (organizationId == Guid.Empty)
        {
            throw new ArgumentException("A credential token must belong to a resolved organization.", nameof(organizationId));
        }

        var earlier = await OutstandingFor(subject, organizationId)
            .Where(t => t.Purpose == purpose)
            .ToListAsync(cancellationToken);
        foreach (var token in earlier)
        {
            token.UsedAt = now;
        }

        var raw = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenByteLength));
        var row = new CredentialToken
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(raw),
            Purpose = purpose,
            PersonId = subject.PersonId,
            AccountId = subject.AccountId,
            OrganizationId = organizationId,
            ExpiresAt = now + LifetimeFor(purpose),
            IssuedByPersonId = issuedByPersonId,
            CreatedAt = now,
        };
        _dbContext.CredentialTokens.Add(row);

        return new IssuedCredentialToken(row, raw);
    }

    /// <summary>
    /// The redeemable token <paramref name="rawToken"/> names, read without tracking — or <c>null</c>, uniformly, when it
    /// is missing, malformed, unknown, expired, used or voided. Does NOT consume it: call <see cref="TryClaimAsync"/>.
    /// </summary>
    /// <param name="rawToken">The raw token from the request.</param>
    /// <param name="now">The single wall-clock read of the calling operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The token row, or <c>null</c>.</returns>
    public async Task<CredentialToken?> FindRedeemableAsync(string? rawToken, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var trimmed = rawToken?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxRawTokenLength)
        {
            return null;
        }

        var hash = SessionTokens.Hash(trimmed);

        // org-scope-exempt(ResolutionRoot): redeeming a token IS the resolution of whose credential it is — a pre-auth
        // lookup by the SHA-256 of a 256-bit secret, before any tenant is known. The person it names is then read only
        // inside the token's own OrganizationId (InOrganization), so nothing crosses a tenant.
        var token = await _dbContext.CredentialTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

        return token is not null && token.UsedAt is null && token.ExpiresAt > now ? token : null;
    }

    /// <summary>
    /// Consumes token <paramref name="tokenId"/> in ONE conditional statement — only while it is still unused and
    /// unexpired — so of two concurrent redemptions exactly one wins. Run it inside the caller's transaction, so the
    /// claim rolls back with the credential change if that fails.
    /// </summary>
    /// <param name="tokenId">The token found by <see cref="FindRedeemableAsync"/>.</param>
    /// <param name="organizationId">Its organization (the bound every non-lookup read carries).</param>
    /// <param name="now">The single wall-clock read of the calling operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when this call consumed the token.</returns>
    public async Task<bool> TryClaimAsync(Guid tokenId, Guid organizationId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var claimed = await _dbContext.CredentialTokens
            .InOrganization(organizationId)
            .Where(t => t.Id == tokenId && t.UsedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.UsedAt, now), cancellationToken);

        return claimed == 1;
    }

    /// <summary>
    /// STAGES (does not save) the credential-change rule (ADMIN-IDENTITY-MODEL §3.3, Copilot review 5): every
    /// outstanding token of BOTH purposes for <paramref name="subject"/> is voided, so an older invite or reset link can
    /// never set a password again. Call it in the SAME unit of work as the credential change.
    /// </summary>
    /// <param name="dbContext">The unit of work the credential change is saved through.</param>
    /// <param name="subject">The person or account whose credential changed.</param>
    /// <param name="organizationId">Its organization.</param>
    /// <param name="now">The single wall-clock read of the calling operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many tokens were staged as voided.</returns>
    public static async Task<int> StageCredentialChangeInvalidationAsync(
        PulseDbContext dbContext,
        CredentialSubject subject,
        Guid organizationId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(subject);

        var outstanding = await Outstanding(dbContext, subject, organizationId).ToListAsync(cancellationToken);
        foreach (var token in outstanding)
        {
            token.UsedAt = now;
        }

        return outstanding.Count;
    }

    private IQueryable<CredentialToken> OutstandingFor(CredentialSubject subject, Guid organizationId) =>
        Outstanding(_dbContext, subject, organizationId);

    private static IQueryable<CredentialToken> Outstanding(PulseDbContext dbContext, CredentialSubject subject, Guid organizationId)
    {
        var tokens = dbContext.CredentialTokens.InOrganization(organizationId).Where(t => t.UsedAt == null);
        return subject.PersonId is { } personId
            ? tokens.Where(t => t.PersonId == personId)
            : tokens.Where(t => t.AccountId == subject.AccountId);
    }
}

/// <summary>The identity a credential token is for: exactly one of a directory person or a one-off account.</summary>
public sealed class CredentialSubject
{
    private CredentialSubject(Guid? personId, Guid? accountId)
    {
        PersonId = personId;
        AccountId = accountId;
    }

    /// <summary>The person, or <c>null</c> for an account.</summary>
    public Guid? PersonId { get; }

    /// <summary>The one-off account, or <c>null</c> for a person.</summary>
    public Guid? AccountId { get; }

    /// <summary>A directory person.</summary>
    /// <param name="personId">The person id.</param>
    /// <returns>The subject.</returns>
    public static CredentialSubject ForPerson(Guid personId) =>
        personId == Guid.Empty ? throw new ArgumentException("A person id is required.", nameof(personId)) : new(personId, null);

    /// <summary>A one-off participant account.</summary>
    /// <param name="accountId">The account id.</param>
    /// <returns>The subject.</returns>
    public static CredentialSubject ForAccount(Guid accountId) =>
        accountId == Guid.Empty ? throw new ArgumentException("An account id is required.", nameof(accountId)) : new(null, accountId);
}

/// <summary>A freshly staged token and its raw value — the ONLY place the raw value exists.</summary>
/// <param name="Token">The staged row (hash only).</param>
/// <param name="RawToken">The raw token, to be shown or sent once and then discarded. Never log it.</param>
public sealed record IssuedCredentialToken(CredentialToken Token, string RawToken)
{
    /// <inheritdoc />
    public override string ToString() => $"IssuedCredentialToken {{ Id = {Token.Id}, Purpose = {Token.Purpose} }}";
}
