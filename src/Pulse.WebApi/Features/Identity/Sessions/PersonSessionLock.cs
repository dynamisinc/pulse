namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The person-row lock that serializes a staff session MINT against every change that SWEEPS a person's sessions
/// (#839). Both sides take an exclusive row lock on the person's <c>People</c> row, in their own transaction, BEFORE
/// they read anything the other side writes: the mint before it reads the person's grants and inserts its session, the
/// change before its sweep reads the person's sessions. Whichever side locks first wins outright, and the other waits:
/// <list type="bullet">
///   <item><description>the change first — the mint's conditional lock then re-reads the COMMITTED person: a changed
///   password, a disable or a lost org-admin grant matches nothing and the mint is refused; a lost enrollment is not
///   found by the grant read that follows the lock;</description></item>
///   <item><description>the mint first — its session is committed before the change gets the lock, so the change's
///   sweep sees it and revokes it.</description></item>
/// </list>
/// So no session can be minted from a person state that a concurrent change is replacing and still escape that change's
/// sweep. <see cref="SessionHolderQueries"/> stays as the defence in depth behind it.
/// </summary>
/// <remarks>
/// <para>
    /// <b>Lock order and deadlocks.</b> Every participant locks person rows FIRST and the person's sessions after:
/// <list type="bullet">
///   <item><description>the mint: ONE person row → its grant read (no lock) → the session insert;</description></item>
///   <item><description>a credential change: the issuer → the person → its token → sessions;</description></item>
///   <item><description>an org-directory change: the organization's enabled admin rows → the caller → the target →
///   sessions;</description></item>
///   <item><description>an enrollment change: the caller and the target in ONE statement → the exercise's enrollment
///   rows → sessions.</description></item>
/// </list>
/// The MINT can never be part of a deadlock cycle: it holds exactly one person row and waits for nothing else that a
/// change holds while waiting for it. Two CHANGE paths can still deadlock with each other — for example, an
/// enrollment change and an org-directory change that each hold a person row the other wants. Every change path
/// recovers: SQL Server rolls the victim back whole, and the service retries it once from the top (then answers a
/// clean 409, or for a credential change the uniform invalid-token).
/// </para>
/// <para>
/// <b>Tenant-bounded.</b> Every statement carries <c>InOrganization</c>: a person id from another organization matches
/// nothing. The lock is a no-op <c>SET PasswordHash = PasswordHash</c>; it changes no data.
/// </para>
/// </remarks>
public static class PersonSessionLock
{
    /// <summary>
    /// The CHANGE side: takes the exclusive row lock on <paramref name="personId"/>'s row (held to the caller's commit).
    /// Call it inside the change's transaction before the sweep reads the person's sessions.
    /// </summary>
    /// <param name="dbContext">The change's unit of work (with its transaction open).</param>
    /// <param name="personId">The person whose sessions the change sweeps.</param>
    /// <param name="organizationId">The person's (server-resolved) organization.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many rows were locked (0 when no such person exists in the organization).</returns>
    public static Task<int> LockAsync(
        PulseDbContext dbContext,
        Guid personId,
        Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        return dbContext.People
            .InOrganization(organizationId)
            .Where(p => p.Id == personId)
            .ExecuteUpdateAsync(set => set.SetProperty(p => p.PasswordHash, p => p.PasswordHash), cancellationToken);
    }

    /// <summary>
    /// The MINT side: locks <paramref name="personId"/>'s row ONLY while it still holds what the sign-in verified — the
    /// same password hash (a null hash for a sign-in that verified no Pulse password), not disabled, and, for an
    /// org-scope session, the org-admin grant. Call it inside the mint's transaction before the grant read and the
    /// session insert.
    /// </summary>
    /// <param name="dbContext">The sign-in's unit of work (with its transaction open).</param>
    /// <param name="personId">The person signing in.</param>
    /// <param name="organizationId">The organization the sign-in is for.</param>
    /// <param name="verifiedPasswordHash">The hash the password was verified against; <c>null</c> when none was.</param>
    /// <param name="requireOrgAdmin">Whether the session is org scope (needs the org-admin grant).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// <c>true</c> to mint (the row is locked, or there is no person row with this id in ANY organization — a legacy
    /// staff facet with nothing a change could sweep); <c>false</c> when the person changed since the sign-in read it, or
    /// the id names a person of another organization (the uniform refusal).
    /// </returns>
    public static async Task<bool> TryLockForMintAsync(
        PulseDbContext dbContext,
        Guid personId,
        Guid organizationId,
        string? verifiedPasswordHash,
        bool requireOrgAdmin,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var noVerifiedHash = verifiedPasswordHash is null;
        var locked = await dbContext.People
            .InOrganization(organizationId)
            .Where(p => p.Id == personId
                && p.DisabledAt == null
                && (p.PasswordHash == verifiedPasswordHash || (noVerifiedHash && p.PasswordHash == string.Empty))
                && (!requireOrgAdmin || p.OrgRole == Person.OrgAdminRole))
            .ExecuteUpdateAsync(set => set.SetProperty(p => p.PasswordHash, p => p.PasswordHash), cancellationToken);

        if (locked == 1)
        {
            return true;
        }

        if (requireOrgAdmin)
        {
            // An org-scope session always has a person, so there is no legacy exception to make.
            return false;
        }

        // A person row exists in the organization but no longer matches what was verified: refused.
        if (await dbContext.People.InOrganization(organizationId).AnyAsync(p => p.Id == personId, cancellationToken))
        {
            return false;
        }

        // org-scope-exempt(TenantChecked): an existence probe (no row returned) for this id in ANOTHER organization;
        // the explicit OrganizationId comparison is the point, and a match only ever REFUSES the mint.
        var inAnotherOrganization = await dbContext.People
            .AnyAsync(p => p.Id == personId && p.OrganizationId != organizationId, cancellationToken);

        // Legacy staff (S-001): a staff facet with NO person row anywhere has nothing a change could sweep, so there is
        // nothing to serialize with and the mint proceeds unlocked. A person row in another organization is refused.
        return !inAnotherOrganization;
    }
}
