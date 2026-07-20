namespace Pulse.WebApi.Data;

/// <summary>
/// Default <see cref="IExerciseContext"/> — a simple per-scope holder for the current exercise run.
/// Registered with a Scoped lifetime by <c>AddExerciseScoping</c> so it lives exactly as long as the
/// request / unit of work the <see cref="PulseDbContext"/> also belongs to, and so that context can
/// inject it.
/// </summary>
/// <remarks>
/// It starts UNSET (<see cref="CurrentExerciseId"/> is <c>null</c>) — the fail-closed default. Until a
/// later story resolves the exercise from the hostname (story 08) / participant auth (story 04) / the
/// staff switcher (story 05) and assigns it within the scope, every scoped query matches zero rows rather
/// than leaking across exercises. The settable property is the seam those stories write to; the read-side
/// <see cref="IExerciseContext"/> interface the context depends on stays get-only.
/// </remarks>
public sealed class ExerciseContext : IExerciseContext
{
    /// <inheritdoc cref="IExerciseContext.CurrentExerciseId" />
    public Guid? CurrentExerciseId { get; set; }
}
