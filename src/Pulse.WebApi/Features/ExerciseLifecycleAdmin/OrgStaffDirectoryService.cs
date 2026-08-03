namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

/// <summary>
/// The org-scoped staff-assignment view behind <c>GET /api/org/staff-assignments</c> (COR-076) — the second
/// half of the OrgAdmin surface family's Phase-1 minimum content: which staff humans hold which role on which
/// of the organization's exercises.
/// </summary>
/// <remarks>
/// <para>
/// <b>OrgAdmin only, and that is the point.</b> This is the one read in the slice a planner cannot reach.
/// <c>roles.ts</c> has always described <c>orgAdmin</c> as "a third, separate surface family"; a family that
/// every planner could also walk into would be a bigger staff role, not a separate one. The gate is
/// <see cref="OrgAdminAuthorizationFilter.OrgAdminOnly"/>, and the service re-checks the same role itself.
/// </para>
/// <para>
/// <b>Bounded on BOTH joins, by the SERVER-resolved tenant.</b> <c>StaffAssignment</c> is the model's one
/// deliberately cross-exercise object and carries no filter of any kind, so an unbounded join here would
/// enumerate every customer's staff roster. Both of the entities it joins to are org-owned resolution roots
/// with no global filter of their own, so each is bounded explicitly with
/// <see cref="OrganizationScope.InOrganization{TEntity}"/>. Bounding BOTH — rather than just the exercise — is
/// deliberate: an assignment that straddles a customer boundary (a foreign human on our exercise, or our human
/// on a foreign exercise) is then invisible from either side rather than half-rendered, and an unresolved
/// tenant matches zero rows on both sides instead of one.
/// </para>
/// <para>
/// Staff/platform world only (XC-002) — an access record (exercise, human, role), never participant content.
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </para>
/// </remarks>
public sealed class OrgStaffDirectoryService
{
    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;

    /// <summary>Creates the service over its persistence context and the server-resolved caller seam.</summary>
    /// <param name="dbContext">The persistence context the org-bounded read runs through.</param>
    /// <param name="staffCaller">Resolves the caller's identity, role and tenant from the server-issued session.</param>
    public OrgStaffDirectoryService(PulseDbContext dbContext, StaffCallerContext staffCaller)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
    }

    /// <summary>
    /// Lists every staff assignment within the caller's OWN organization. Returns <c>null</c> when the caller
    /// is not a live org-admin with a resolved tenant (fail closed — the endpoint returns 401/403).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The organization's staff assignments, or <c>null</c> when the caller could not be resolved.</returns>
    public async Task<IReadOnlyList<OrgStaffAssignmentDto>?> ListAsync(CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return null;
        }

        // Defense in depth over OrgAdminOnly: a planner reaching this method directly must still be refused.
        if (!ExerciseAdminRoles.IsOrgAdmin(caller.Role))
        {
            return null;
        }

        var tenant = caller.OrganizationId;

        // Guids are projected raw and stringified in memory below (SQL Server renders uniqueidentifier
        // UPPERCASE inside a translated ToString(), which would mismatch every other endpoint's casing).
        var rows = await (
            from assignment in _dbContext.StaffAssignments.AsNoTracking()
            join exercise in _dbContext.Exercises.AsNoTracking().InOrganization(tenant)
                on assignment.ExerciseId equals exercise.Id
            join staffUser in _dbContext.StaffUsers.AsNoTracking().InOrganization(tenant)
                on assignment.StaffUserId equals staffUser.Id
            orderby exercise.Name, staffUser.DisplayName
            select new AssignmentRow(
                assignment.ExerciseId,
                exercise.Name,
                staffUser.Id,
                staffUser.DisplayName,
                assignment.Role,
                assignment.CreatedAt)).ToListAsync(cancellationToken);

        return rows
            .Select(row => new OrgStaffAssignmentDto
            {
                ExerciseId = row.ExerciseId.ToString(),
                ExerciseName = row.ExerciseName,
                StaffUserId = row.StaffUserId.ToString(),
                DisplayName = row.DisplayName,
                Role = row.Role,
                AssignedAt = row.AssignedAt.ToString("O", CultureInfo.InvariantCulture),
            })
            .ToList();
    }

    /// <summary>The materialized projection shape — a record so the EF projection stays translatable and typed.</summary>
    private sealed record AssignmentRow(
        Guid ExerciseId,
        string ExerciseName,
        Guid StaffUserId,
        string DisplayName,
        string Role,
        DateTimeOffset AssignedAt);
}
