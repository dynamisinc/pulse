namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

/// <summary>Which of a person's live sessions <see cref="PersonSessionRevoker"/> revokes.</summary>
public enum PersonSessionScope
{
    /// <summary>
    /// Every live session of the person: staff and participant, any exercise AND org scope (a disable, a credential
    /// change — ADMIN-IDENTITY-MODEL §1.1 "all of the person's sessions").
    /// </summary>
    All,

    /// <summary>
    /// Only the person's org-scope sessions (<c>Session.ExerciseId</c> null) — the sessions minted from the
    /// <c>OrgRole</c> grant, revoked when that grant is revoked (§1.1 "org-scope sessions, for an OrgRole revoke").
    /// </summary>
    OrgScopeOnly,
}

/// <summary>
/// The PERSON-WIDE half of the grant-revoke rule (ADMIN-IDENTITY-MODEL §1.1, identity-auth-roles/19): stages the
/// revocation of a person's live sessions — across every exercise and org scope, unlike the exercise-bound
/// <c>EnrollmentService.RevokeExerciseSessionsAsync</c> — and returns their ids so the caller can cut the matching hub
/// connections through <see cref="Realtime.ISessionConnectionRevoker"/> AFTER its commit.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staged, not saved.</b> The rows are loaded tracked and stamped <c>RevokedAt</c>; the caller's ONE
/// <c>SaveChanges</c> commits them in the same unit of work as the mutation that revoked the grant. <c>RevokedAt</c>
/// stops both the access token and the refresh token (the authenticator and the refresh path both refuse a revoked
/// row).
/// </para>
/// <para>
/// <b>Both person columns.</b> Sessions minted before <c>Session.PersonId</c> existed carry the person only as
/// <c>StaffUserId</c> (the shared key), so both are matched. <c>Session</c> is unscoped (looked up pre-scope by
/// token); the person predicate is the confinement, and the person id is always one the caller already bounded to
/// its own organization.
/// </para>
/// </remarks>
public static class PersonSessionRevoker
{
    /// <summary>Stages the revocation of the person's live sessions in <paramref name="scope"/>; the caller saves.</summary>
    /// <param name="dbContext">The unit of work to stage into.</param>
    /// <param name="personId">The person whose sessions are revoked (already tenant-bounded by the caller).</param>
    /// <param name="scope">Which sessions.</param>
    /// <param name="now">The ONE server wall-clock read of the operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The ids of the sessions staged as revoked (for the post-commit connection cut).</returns>
    public static async Task<List<Guid>> StageRevokeAsync(
        PulseDbContext dbContext,
        Guid personId,
        PersonSessionScope scope,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var query = dbContext.Sessions
            .Where(s => s.RevokedAt == null && (s.PersonId == personId || s.StaffUserId == personId));
        if (scope == PersonSessionScope.OrgScopeOnly)
        {
            query = query.Where(s => s.ExerciseId == null);
        }

        var sessions = await query.ToListAsync(cancellationToken);
        foreach (var session in sessions)
        {
            session.RevokedAt = now;
        }

        return sessions.Select(session => session.Id).ToList();
    }
}
