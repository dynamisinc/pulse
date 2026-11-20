namespace Pulse.WebApi.Features.Identity.Sessions;

using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The person facts a session's validity depends on (#839): whether its person is disabled, their org-level grant, and
/// when their password last changed. Read in the SAME statement as the session row (see
/// <see cref="SessionHolderQueries.WithHolderStanding"/>), never by a second round-trip.
/// </summary>
internal sealed class SessionHolderStanding
{
    /// <summary>The person's <see cref="Person.DisabledAt"/>.</summary>
    public DateTimeOffset? DisabledAt { get; init; }

    /// <summary>The person's <see cref="Person.OrgRole"/>.</summary>
    public string? OrgRole { get; init; }

    /// <summary>The person's <see cref="Person.PasswordChangedAt"/>.</summary>
    public DateTimeOffset? PasswordChangedAt { get; init; }
}

/// <summary>A session row together with its person's current standing (<c>null</c> when the session names no person row).</summary>
internal sealed class SessionWithHolder
{
    /// <summary>The session row (tracked or not, as the source query is).</summary>
    public required Session Session { get; init; }

    /// <summary>The standing of the session's person, or <c>null</c> when it has none.</summary>
    public SessionHolderStanding? Holder { get; init; }
}

/// <summary>
/// The person-state half of "is this session still valid" (#839), shared by every place that authenticates a presented
/// session token: the request middleware's <see cref="SessionAuthenticator"/>, <see cref="CurrentStaffSessionAccessor"/>,
/// and <see cref="SessionService"/>'s <c>GET /api/session</c> and refresh paths.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> Demote, disable and password reset revoke a person's sessions by sweeping the rows visible inside
/// their own transaction. A sign-in running at the same moment can read the person before that transaction commits and
/// insert its session after the sweep's read, so the new session escapes the sweep. Re-checking the person's CURRENT state
/// on every authenticated request closes that window for the state checks: once the change commits, the next request on
/// the escaped session fails, whatever the sweep saw.
/// </para>
/// <para>
/// <b>One round-trip.</b> The person's standing is a correlated subquery of the session lookup (SQL Server
/// <c>OUTER APPLY</c> over the <c>People</c> primary key), so the check adds no extra query per request.
/// </para>
/// </remarks>
internal static class SessionHolderQueries
{
    /// <summary>
    /// Projects each session onto itself plus its person's current standing, in the same statement. The person is the
    /// session's own <see cref="Session.PersonId"/>, or its <see cref="Session.StaffUserId"/> for a staff session minted
    /// before the person column existed (shared key).
    /// </summary>
    /// <param name="sessions">The session query (already narrowed to the presented token or id).</param>
    /// <param name="dbContext">The context whose <c>People</c> set the standing is read from.</param>
    /// <returns>The sessions with their holders' standing.</returns>
    public static IQueryable<SessionWithHolder> WithHolderStanding(this IQueryable<Session> sessions, PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(dbContext);

        return sessions.Select(session => new SessionWithHolder
        {
            Session = session,

            // org-scope-exempt(OwnIdentity): the person named by the server-issued session row itself (its PersonId, or
            // the shared-key StaffUserId), never a request value, so this cannot reach another tenant's person.
            Holder = dbContext.People
                .Where(person => person.Id == (session.PersonId ?? session.StaffUserId))
                .Select(person => new SessionHolderStanding
                {
                    DisabledAt = person.DisabledAt,
                    OrgRole = person.OrgRole,
                    PasswordChangedAt = person.PasswordChangedAt,
                })
                .FirstOrDefault(),
        });
    }

    /// <summary>
    /// Whether the session's person still holds what the session was minted on (#839). Fails closed when:
    /// the person is disabled; an ORG-SCOPE session's person is no longer an org admin (or has no person row); or the
    /// password changed after the session was issued (<see cref="Session.IssuedAt"/>, renewed on each refresh). A session
    /// without a person (a one-off participant, a read-only viewer) has nothing to re-check and passes, unless it is org
    /// scope.
    /// </summary>
    /// <param name="session">The session row.</param>
    /// <param name="holder">Its person's standing, as read by <see cref="WithHolderStanding"/>.</param>
    /// <returns><c>true</c> when the person still permits the session.</returns>
    public static bool HolderPermits(Session session, SessionHolderStanding? holder)
    {
        ArgumentNullException.ThrowIfNull(session);

        var isOrgScope = session.ExerciseId is null;
        if (holder is null)
        {
            // No person to re-check. An org-scope session is ONLY ever an org admin's, so it needs one (fail closed).
            return !isOrgScope;
        }

        if (holder.DisabledAt is not null)
        {
            return false;
        }

        if (isOrgScope && !Person.IsOrgAdmin(holder.OrgRole))
        {
            return false;
        }

        return holder.PasswordChangedAt is not { } changedAt || changedAt <= session.IssuedAt;
    }
}
