namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Resolves the three server-authoritative facts every endpoint in this slice needs about its caller — WHO
/// they are (<c>StaffUser</c> id), WHAT role they hold, and WHICH customer tenant they belong to — from the
/// server-issued session alone. One place, so the authorization filter and the services can never disagree
/// about the answer, and no handler ever has a reason to read any of it off a request.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every fact is server-resolved; none is client-supplied.</b> The <c>StaffUser</c> id comes from
/// <see cref="ICurrentStaffSessionAccessor"/> (which yields a caller only for a live, non-revoked, unexpired
/// <c>staff</c>-kind session — participant, shared read-only and anonymous callers all yield <c>null</c>). The
/// role is read off that caller's OWN persisted <c>Session</c> row. The tenant is read off
/// <see cref="IOrganizationContext"/>, which <c>UseOrganizationResolution()</c> populated from the caller's own
/// <c>StaffUser.OrganizationId</c>. A body, route or query value contributes nothing to any of them.
/// </para>
/// <para>
/// <b>Why the tenant comes from <see cref="IOrganizationContext"/> rather than a second <c>StaffUser</c>
/// read.</b> The request-scoped <c>PulseDbContext</c>'s org-axis global query filter was ALSO built from that
/// value, so taking the explicit <c>InOrganization(...)</c> bound from the same source makes it structurally
/// impossible for the filtered and the explicitly-bounded halves of a request to be scoped to two different
/// customers. It also makes the middleware load-bearing rather than decorative: if the orchestrator ever
/// dropped <c>UseOrganizationResolution()</c> from the pipeline, this resolver returns <c>null</c> and every
/// endpoint in the slice 401s — loudly and fail-closed, never quietly serving the wrong tenant.
/// </para>
/// <para>
/// <b>Fail closed, every branch.</b> No staff session, a session row that has vanished or is not staff-kind, a
/// blank role, or an unresolved/empty tenant all yield <c>null</c> — which the filter turns into a <c>401</c>.
/// There is no "unknown tenant sees everything" path. Scoped lifetime (it holds the <c>PulseDbContext</c> unit
/// of work) and memoized per request, so the filter and the service it gates share one lookup.
/// </para>
/// </remarks>
public sealed class StaffCallerContext
{
    /// <summary>The <c>Session.Kind</c> a caller must present. Re-checked here as defense in depth.</summary>
    private const string StaffSessionKind = "staff";

    private readonly PulseDbContext _dbContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly IOrganizationContext _organizationContext;

    private StaffCaller? _resolved;
    private bool _hasResolved;

    /// <summary>Creates the resolver over its collaborators.</summary>
    /// <param name="dbContext">The request-scoped persistence context the session-role read runs through.</param>
    /// <param name="currentStaffSession">The B2 seam identifying the authenticated staff caller.</param>
    /// <param name="organizationContext">The server-resolved customer tenant for this request.</param>
    public StaffCallerContext(
        PulseDbContext dbContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        IOrganizationContext organizationContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(organizationContext);

        _dbContext = dbContext;
        _currentStaffSession = currentStaffSession;
        _organizationContext = organizationContext;
    }

    /// <summary>
    /// Resolves the current staff caller, or <c>null</c> when there is no live staff session or no resolved
    /// tenant (fail closed — the endpoint filter maps <c>null</c> to <c>401</c>). Memoized per request.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The caller's server-resolved identity, role and tenant, or <c>null</c>.</returns>
    public async Task<StaffCaller?> ResolveAsync(CancellationToken cancellationToken = default)
    {
        if (_hasResolved)
        {
            return _resolved;
        }

        _hasResolved = true;

        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return null;
        }

        // The caller's OWN session row — Session is unscoped (looked up pre-scope by token), so this is not
        // filtered, and it is confined to the one row the accessor already authenticated. The staff-kind and
        // staff-user re-checks cost nothing on the happy path and keep this safe against any future accessor
        // regression that handed back a session that is not the caller's own staff session.
        var role = await _dbContext.Sessions
            .AsNoTracking()
            .Where(session => session.Id == current.SessionId
                && session.StaffUserId == current.StaffUserId
                && session.Kind == StaffSessionKind)
            .Select(session => session.Role)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(role))
        {
            return null;
        }

        // The SERVER-resolved customer tenant (UseOrganizationResolution → the caller's own
        // StaffUser.OrganizationId). Unresolved, or the Guid.Empty sentinel no persisted row can carry, means
        // "no tenant" — and no tenant reaches NOTHING, never everything.
        var organizationId = _organizationContext.CurrentOrganizationId;
        if (organizationId is not { } tenant || tenant == Guid.Empty)
        {
            return null;
        }

        _resolved = new StaffCaller
        {
            StaffUserId = current.StaffUserId,
            SessionId = current.SessionId,
            Role = role,
            OrganizationId = tenant,
        };

        return _resolved;
    }
}

/// <summary>
/// The server-resolved facts about the current staff caller. Never serialized — in particular
/// <see cref="OrganizationId"/> is a staff/platform-tier value that must never reach any wire shape (XC-002).
/// </summary>
public sealed class StaffCaller
{
    /// <summary>The authenticated caller's <c>StaffUser</c> id — the telemetry <c>actingHumanId</c>.</summary>
    public required Guid StaffUserId { get; init; }

    /// <summary>The persisted <c>Session.Id</c> the caller presented.</summary>
    public required Guid SessionId { get; init; }

    /// <summary>The caller's role, verbatim from their session row (the frozen <c>ExerciseRole</c> vocabulary).</summary>
    public required string Role { get; init; }

    /// <summary>The caller's OWN customer tenant (COR-010) — the only organization they may ever read or write.</summary>
    public required Guid OrganizationId { get; init; }
}
