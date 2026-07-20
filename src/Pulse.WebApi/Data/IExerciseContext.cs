namespace Pulse.WebApi.Data;

/// <summary>
/// Resolves the exercise RUN the current unit of work is scoped to (COR-001). The
/// <see cref="PulseDbContext"/> reads this once, at construction, to drive its read-side GLOBAL query
/// filter — so every <see cref="IExerciseScoped"/> query is confined to a single exercise CENTRALLY, and
/// a newly-added scoped entity or endpoint cannot forget the scope.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail-closed contract (the always-Critical property).</b> <see cref="CurrentExerciseId"/> is
/// nullable on purpose: <c>null</c> means "no exercise has been resolved for this scope". The context
/// collapses that to <see cref="System.Guid.Empty"/>, and because the write-time guard
/// (<see cref="PulseDbContext"/>'s <c>SaveChanges</c> override) forbids persisting any scoped row with an
/// empty <c>ExerciseId</c>, an unresolved scope can only ever match ZERO rows — never all exercises.
/// Absence of a scope is a closed door, not an open one.
/// </para>
/// <para>
/// <b>Out of scope here.</b> HOW the current exercise is resolved — the per-exercise hostname (story 08),
/// participant auth (story 04), the staff cross-exercise switcher (story 05) — is deliberately NOT this
/// story's concern. This story ships the abstraction plus a default implementation that starts unset;
/// later stories populate it within the request scope.
/// </para>
/// </remarks>
public interface IExerciseContext
{
    /// <summary>
    /// The exercise run the current scope is bound to, or <c>null</c> when none has been resolved. A null
    /// (or otherwise unset) value fails closed — see the interface remarks.
    /// </summary>
    Guid? CurrentExerciseId { get; }
}
