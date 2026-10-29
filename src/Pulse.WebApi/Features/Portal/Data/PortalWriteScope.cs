namespace Pulse.WebApi.Features.Portal.Data;

using Pulse.WebApi.Data;

/// <summary>
/// The portal's write-side scope check (exercise-portal story 01, XC-001): a portal row may be written only into the
/// exercise the request resolved. The config and resources services (03/04) call it before <c>Add</c>.
/// </summary>
/// <remarks>
/// The context's central write guard refuses only an empty <c>ExerciseId</c>, and an UPDATE of another exercise's row
/// already fails (<c>ExerciseId</c> is a concurrency token on both portal tables). An INSERT that names another
/// exercise is the remaining gap, so this check refuses it, the way <c>ParticipantPostProjector</c> refuses a post
/// outside the scope.
/// </remarks>
public static class PortalWriteScope
{
    /// <summary>
    /// Throws unless an exercise is resolved and <paramref name="row"/> belongs to it.
    /// </summary>
    /// <param name="scope">The request's exercise scope.</param>
    /// <param name="row">The portal row about to be added or changed.</param>
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
