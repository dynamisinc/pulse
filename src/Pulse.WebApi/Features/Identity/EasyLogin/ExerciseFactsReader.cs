namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

/// <summary>
/// The ONE read of the <c>Exercises</c> table for the whole easy-login feature (EL-17, gotcha 3). Stories 02 to 06
/// take the exercise name, time zone, lifecycle status and tenant from here instead of
/// adding reads of their own, so the pinned <c>org-scope-exempt(ResolvedScope)</c> inventory in
/// <c>OrganizationScopeSweepTests</c> moves by exactly one for the feature. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Callers pass a SERVER-RESOLVED exercise id only</b>: <see cref="IExerciseContext.CurrentExerciseId"/> (the
/// host-resolved scope for a pre-auth sign-in, the active exercise for a staff request) or a server-issued
/// <c>Session</c>'s bound <c>ExerciseId</c> (a refresh). Never an id from a body, route or query. <c>Exercise</c> is
/// the scope root and carries no global query filter, so this read is only as safe as the provenance of its id; that
/// provenance is the claim the exemption marker below makes.
/// </para>
/// <para>
/// <b>Fail closed.</b> An empty id, or an id with no exercise row, yields <c>null</c>; the caller refuses (401 on a
/// sign-in path). The facts are staff/server-side values: <see cref="ExerciseFacts.OrganizationId"/> in particular
/// must never reach any wire shape (XC-002).
/// </para>
/// </remarks>
public sealed class ExerciseFactsReader
{
    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the reader over the request's persistence context.</summary>
    /// <param name="dbContext">The persistence context.</param>
    public ExerciseFactsReader(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <summary>Reads the facts about one exercise, or <c>null</c> when the id is empty or unknown.</summary>
    /// <param name="exerciseId">A server-resolved exercise id (see the remarks); never a client-supplied one.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The exercise facts, or <c>null</c> (fail closed).</returns>
    public async Task<ExerciseFacts?> GetAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            return null;
        }

        // org-scope-exempt(ResolvedScope): exerciseId is the server-resolved scope (IExerciseContext, set by the
        // request pipeline, or a server-issued Session's bound ExerciseId) and never a request field, so this read of
        // the exercise's own row cannot cross an exercise or a customer tenant.
        var row = await _dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => new
            {
                exercise.Name,
                exercise.TimeZone,
                exercise.Status,
                exercise.OrganizationId,
            })
            .FirstOrDefaultAsync(cancellationToken);

        return row is null
            ? null
            : new ExerciseFacts(row.Name, row.TimeZone, row.Status, row.OrganizationId);
    }
}

/// <summary>
/// What the easy-login stories need to know about the exercise a request is scoped to. Server-side only: never
/// serialized as-is (the tenant id must not reach a wire shape, XC-002).
/// </summary>
/// <param name="Name">The exercise display name (the card sheet's <c>exerciseName</c>).</param>
/// <param name="TimeZone">The stored IANA zone id, verbatim (resolve it with <see cref="ExerciseDay.ResolveTimeZone"/>; blank or unknown means UTC).</param>
/// <param name="Status">The stored lifecycle status, verbatim (the <c>ExerciseLifecycleStates</c> vocabulary).</param>
/// <param name="OrganizationId">The owning customer tenant, for an <c>.InOrganization(...)</c>-bounded staff read.</param>
/// <remarks>
/// engine-runtime/08 (CLK-2): the record no longer carries a stored scenario instant. Telemetry scenario time comes from
/// <c>IScenarioNow</c> (clock, else the exercise's latest post, else now).
/// </remarks>
public sealed record ExerciseFacts(
    string Name,
    string TimeZone,
    string Status,
    Guid OrganizationId);
