namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The personal-link mechanics (easy-login/03, EL-5): the real <see cref="IParticipantLinkIssuer"/> that story 02's
/// roster provisioning calls, plus the two staff link operations, <see cref="ReissueAsync"/> and <see cref="Revoke"/>.
/// It replaces story 01's fail-closed <c>NullParticipantLinkIssuer</c> through <c>AddPersonalLinks()</c>. Scoped,
/// matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Stages only.</b> Every method changes rows on the CALLER's tracked <see cref="PulseDbContext"/> and never calls
/// <c>SaveChanges</c> or emits telemetry, so a roster row (story 02) or a staff action (this story) commits the link,
/// its session terminations and its one XC-004 event together, in the caller's single save.
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> A link is read only through the central exercise filter, and a new
/// link's <c>ExerciseId</c> is stamped from the ACCOUNT's own exercise, never from a request value. One row per
/// account (the unique <c>(ExerciseId, AccountId)</c> index): a reissue rotates the row IN PLACE, so the old token's
/// hash leaves the table and the old URL is simply an unknown token.
/// </para>
/// <para>
/// <b>Scope guard.</b> Every method refuses (<see cref="InvalidOperationException"/>) an account whose exercise is not
/// the request's resolved <see cref="IExerciseContext.CurrentExerciseId"/>, or any account while the scope is unresolved:
/// a caller bug surfaces as a readable error rather than as a unique-index violation at its save.
/// </para>
/// <para>
/// <b>Secrets.</b> The raw token exists only in memory here: the row stores its SHA-256 (<see cref="ParticipantLinkTokens.Hash"/>)
/// and a Data Protection copy (<see cref="IParticipantLinkTokenProtector"/>). Nothing here logs.
/// </para>
/// </remarks>
public sealed class ParticipantLinkService : IParticipantLinkIssuer
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IParticipantLinkTokenProtector _protector;

    /// <summary>Creates the link service over the request's unit of work.</summary>
    /// <param name="dbContext">The caller's persistence context; changes are staged on it, never saved here.</param>
    /// <param name="exerciseContext">The request's resolved exercise; every account must belong to it.</param>
    /// <param name="protector">Encrypts the reprintable copy of each new token.</param>
    public ParticipantLinkService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IParticipantLinkTokenProtector protector)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(protector);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _protector = protector;
    }

    /// <inheritdoc />
    /// <remarks>
    /// An ACTIVE link is returned unchanged, even one whose stored copy no longer decrypts (that is staff's explicit
    /// reissue, never a silent rotation). A revoked link is re-activated with a fresh token; no link gets a first one.
    /// </remarks>
    public async Task<ParticipantLink?> EnsureActiveAsync(
        Account account,
        Guid? issuedByStaffUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        RequireScopedAccount(account);

        var link = await FindLinkAsync(account, cancellationToken);
        if (link is null)
        {
            return CreateLink(account, issuedByStaffUserId, now);
        }

        if (link.RevokedAt is not null)
        {
            Rotate(link, issuedByStaffUserId, now);
        }

        return link;
    }

    /// <summary>
    /// Replaces the account's token: a new token, hash and protected copy, <c>Generation</c> + 1, <c>RevokedAt</c>
    /// cleared, and the use counters reset (<c>UseCount</c> 0, no <c>LastUsedAt</c>: they describe the new token). The
    /// old hash leaves the table, so the old URL stops working the moment the caller saves. Issues the
    /// first link when the account has none. Never a no-op.
    /// </summary>
    /// <param name="account">The participant, loaded under the central exercise filter.</param>
    /// <param name="staffUserId">The staff user reissuing, recorded as the issuer.</param>
    /// <param name="now">The caller's one server wall-clock read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staged link (new, or rotated in place).</returns>
    public async Task<ParticipantLink> ReissueAsync(
        Account account,
        Guid staffUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        RequireScopedAccount(account);

        var link = await FindLinkAsync(account, cancellationToken);
        if (link is null)
        {
            return CreateLink(account, staffUserId, now);
        }

        Rotate(link, staffUserId, now);
        return link;
    }

    /// <summary>
    /// Revokes an active link: <c>RevokedAt</c> and the revoking staff user are stamped and the protected copy is
    /// cleared, so no join URL can be rebuilt. The hash is kept (a revoked token stays a dead lookup). Revoking a link
    /// that is already revoked changes nothing.
    /// </summary>
    /// <param name="link">The account's link, tracked by the caller's context.</param>
    /// <param name="staffUserId">The staff user revoking.</param>
    /// <param name="now">The caller's one server wall-clock read.</param>
    /// <returns><c>true</c> when the link was active and is now revoked; <c>false</c> when it was already revoked.</returns>
    public static bool Revoke(ParticipantLink link, Guid staffUserId, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(link);

        if (link.RevokedAt is not null)
        {
            return false;
        }

        link.RevokedAt = now;
        link.RevokedByStaffUserId = staffUserId == Guid.Empty ? null : staffUserId;
        link.ProtectedToken = null;
        return true;
    }

    /// <summary>
    /// The account's one link: a row this unit of work has already staged (story 02 may ensure a link for an account
    /// it has not saved yet), else the stored row, read under the central exercise filter.
    /// </summary>
    private async Task<ParticipantLink?> FindLinkAsync(Account account, CancellationToken cancellationToken)
    {
        var staged = _dbContext.ParticipantLinks.Local
            .FirstOrDefault(l => l.AccountId == account.Id && l.ExerciseId == account.ExerciseId);
        if (staged is not null)
        {
            return staged;
        }

        return await _dbContext.ParticipantLinks
            .FirstOrDefaultAsync(l => l.AccountId == account.Id, cancellationToken);
    }

    private ParticipantLink CreateLink(Account account, Guid? issuedByStaffUserId, DateTimeOffset now)
    {
        var token = ParticipantLinkTokens.Generate();

        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),

            // Stamped from the account's own exercise (COR-001), never a request value.
            ExerciseId = account.ExerciseId,
            AccountId = account.Id,
            TokenHash = ParticipantLinkTokens.Hash(token),
            ProtectedToken = _protector.Protect(token),
            Generation = 1,
            IssuedAt = now,
            IssuedByStaffUserId = NullIfEmpty(issuedByStaffUserId),
        };

        _dbContext.ParticipantLinks.Add(link);
        return link;
    }

    /// <summary>
    /// A fresh token on the same row (reissue, or re-activating a revoked link). The use counters restart: they belong
    /// to the token, and a reprinted card has never been used.
    /// </summary>
    private void Rotate(ParticipantLink link, Guid? issuedByStaffUserId, DateTimeOffset now)
    {
        var token = ParticipantLinkTokens.Generate();

        link.TokenHash = ParticipantLinkTokens.Hash(token);
        link.ProtectedToken = _protector.Protect(token);
        link.Generation += 1;
        link.IssuedAt = now;
        link.IssuedByStaffUserId = NullIfEmpty(issuedByStaffUserId);
        link.RevokedAt = null;
        link.RevokedByStaffUserId = null;
        link.UseCount = 0;
        link.LastUsedAt = null;
    }

    /// <summary>
    /// Fails before any read or write unless <paramref name="account"/> has an id and belongs to the request's resolved
    /// exercise (COR-001). A mismatch is a caller bug: refused with a readable error, never left to the unique index.
    /// </summary>
    private void RequireScopedAccount(Account account)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (account.Id == Guid.Empty || account.ExerciseId == Guid.Empty)
        {
            throw new ArgumentException("A personal link needs an account with an id and an exercise.", nameof(account));
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            throw new InvalidOperationException(
                "A personal link cannot be issued while the request's exercise scope is unresolved.");
        }

        if (account.ExerciseId != scope.Value)
        {
            throw new InvalidOperationException(
                "A personal link can only be issued for an account in the request's resolved exercise; this account "
                + "belongs to a different exercise.");
        }
    }

    private static Guid? NullIfEmpty(Guid? id) => id is { } value && value != Guid.Empty ? value : null;
}
