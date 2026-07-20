namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The aggregate root of one exercise RUN — the isolation scope everything else hangs off (COR-001).
/// Its own <see cref="Id"/> IS the scope, so it deliberately does NOT implement <see cref="IExerciseScoped"/>.
/// Kept to the bare anchor row for the walking skeleton: any exercise-clock / scenario-time field beyond
/// this belongs to the exercise-clock feature's own future backend story (out of scope here).
/// </summary>
public sealed class Exercise
{
    /// <summary>Primary key and the isolation scope every scoped entity's <c>ExerciseId</c> references.</summary>
    public Guid Id { get; set; }

    /// <summary>Human-readable name for the run (staff-facing).</summary>
    public required string Name { get; set; }
}
