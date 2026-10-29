namespace Pulse.WebApi.Features.Portal.Data;

using Pulse.WebApi.Data;

/// <summary>
/// The portal's write-side scope check (exercise-portal story 01, XC-001): a portal row may be written only into the
/// exercise the request resolved. The config and resources services (03/04) call it before every <c>Add</c>,
/// <c>Update</c> or <c>Remove</c> of a portal row built or changed from request input.
/// </summary>
/// <remarks>
/// <para>
/// The context's central write guard refuses only an empty <c>ExerciseId</c>. <c>ExerciseId</c> is a concurrency token on
/// both portal tables, so a stub that names the caller's OWN exercise for another exercise's row id matches no row. But a
/// row that itself carries another exercise's id (for example a stub <c>{ Id = A's id, ExerciseId = A }</c> attached under
/// B) passes the context on INSERT, UPDATE and DELETE alike (given the row's current <c>Version</c>, the other token). This check is what refuses it, the way
/// <c>ParticipantPostProjector</c> refuses a post outside the scope.
/// </para>
/// <para>
/// It is a convention, not a structural guarantee: closing the gap for every scoped entity needs the context's guard to
/// compare each row against the resolved scope, which is an orchestrator follow-up outside this story.
/// </para>
/// </remarks>
public static class PortalWriteScope
{
    /// <summary>
    /// Throws unless an exercise is resolved and <paramref name="row"/> belongs to it.
    /// </summary>
    /// <param name="scope">The request's exercise scope.</param>
    /// <param name="row">The portal row about to be added, changed or removed.</param>
    /// <exception cref="ExerciseScopeViolationException">No exercise is resolved, or the row names another one.</exception>
    public static void EnsureInScope(IExerciseContext? scope, IExerciseScoped row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var current = scope?.CurrentExerciseId;
        if (current is null || current.Value == Guid.Empty || row.ExerciseId != current.Value)
        {
            throw new ExerciseScopeViolationException(
                $"Refusing to write {row.GetType().Name} outside the resolved exercise scope (COR-001/XC-001).");
        }
    }
}
