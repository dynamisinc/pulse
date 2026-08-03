namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// The org-scoped exercise list behind <c>GET /api/org/exercises</c> (COR-075) — "the exercises MY ORGANIZATION
/// owns", which is a strictly different question from <c>GET /api/staff/assignments</c>'s "the exercises I am
/// personally assigned to".
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this is not a duplicate of <c>StaffAssignmentService.GetAssignmentsAsync</c>.</b> That read is
/// deliberately OWN-ONLY: it filters by the caller's <c>StaffUserId</c> so a staff human never sees another's
/// assignments, and it exists to populate the exercise switcher. This read is deliberately ORG-WIDE: an
/// org-admin administers the customer's portfolio, including runs they hold no <c>StaffAssignment</c> on, and a
/// planner needs to see what already exists before creating another. Neither is a superset of the other in a
/// useful way (an assignment can point at an exercise this list also shows), and folding them together would
/// mean either leaking unassigned exercises into the switcher or hiding the organization's own runs from its
/// administrator. They stay two endpoints with two different bounds.
/// </para>
/// <para>
/// <b>The bound is the CUSTOMER tenant, and it has to be written explicitly.</b> <c>Exercise</c> is the
/// resolution root of the inner tier, so it carries NO global query filter on either axis — the exercise filter
/// does not apply (this entity IS the scope) and the org filter deliberately does not either (filtering the
/// rows that answer "which tenant is this?" by "which tenant is this?" is a deadlock). The bound is therefore
/// <see cref="OrganizationScope.InOrganization{TEntity}"/>, taking the SERVER-resolved tenant, which fails
/// closed to zero rows when no tenant resolved — never to every customer's portfolio.
/// </para>
/// <para>
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </para>
/// </remarks>
public sealed class ExerciseListService
{
    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;

    /// <summary>Creates the service over its persistence context and the server-resolved caller seam.</summary>
    /// <param name="dbContext">The persistence context the org-bounded read runs through.</param>
    /// <param name="staffCaller">Resolves the caller's identity, role and tenant from the server-issued session.</param>
    public ExerciseListService(PulseDbContext dbContext, StaffCallerContext staffCaller)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
    }

    /// <summary>
    /// Lists the exercises owned by the CALLER'S OWN organization, ordered by name. Returns <c>null</c> when
    /// there is no live staff session or no server-resolved tenant (fail closed — the endpoint returns 401),
    /// and an EMPTY list when the tenant simply owns nothing yet.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The organization's exercises, or <c>null</c> when the caller could not be resolved.</returns>
    public async Task<IReadOnlyList<OrgExerciseDto>?> ListAsync(CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return null;
        }

        // Defense in depth over the endpoint filter — a service fails closed on its own terms.
        if (!ExerciseAdminRoles.IsExerciseAdministrator(caller.Role))
        {
            return null;
        }

        // Project the raw Guid, NOT e.Id.ToString(): a ToString() inside an EF projection is translated to SQL
        // and SQL Server renders a uniqueidentifier UPPERCASE, which would mismatch the lowercase exerciseId
        // every other endpoint emits (and which the switcher compares against). Materialize, then stringify in
        // memory — the same trap StaffAssignmentService documents.
        var rows = await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(caller.OrganizationId)
            .OrderBy(exercise => exercise.Name)
            .Select(exercise => new ExerciseRow(
                exercise.Id, exercise.Name, exercise.Status, exercise.Hostname, exercise.CreatedAt))
            .ToListAsync(cancellationToken);

        return rows
            .Select(row => new OrgExerciseDto
            {
                ExerciseId = row.Id.ToString(),
                Name = row.Name,
                Status = CanonicalStatus(row.Status),
                Hostname = row.Hostname,
                CreatedAt = row.CreatedAt?.ToString("O", CultureInfo.InvariantCulture),
            })
            .ToList();
    }

    /// <summary>
    /// Folds a stored status onto its canonical COR-032 literal, so a legacy row reads as its modern
    /// equivalent. An unrecognized literal is emitted VERBATIM rather than substituted: the frozen client
    /// guard fails closed on an unknown value, which is the correct outcome for a status the server itself
    /// cannot interpret — inventing a plausible one here would hide the data defect.
    /// </summary>
    private static string CanonicalStatus(string status) =>
        ExerciseLifecycleStates.TryParse(status, out var canonical) ? canonical : status;

    /// <summary>The materialized projection shape — a record so the EF projection stays translatable and typed.</summary>
    private sealed record ExerciseRow(Guid Id, string Name, string Status, string? Hostname, DateTimeOffset? CreatedAt);
}
