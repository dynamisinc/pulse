namespace Pulse.WebApi.Data;

/// <summary>
/// Thrown by the <see cref="PulseDbContext"/> write-guard when a tracked <see cref="IExerciseScoped"/>
/// entity is about to be persisted with a default (<see cref="System.Guid.Empty"/>) <c>ExerciseId</c>.
/// This is the write-time half of the fail-closed isolation guarantee (COR-001 / XC-001): the row never
/// reaches the database. Derives from <see cref="InvalidOperationException"/> so existing catch sites
/// that expect an invalid-state failure still handle it.
/// </summary>
public sealed class ExerciseScopeViolationException : InvalidOperationException
{
    /// <summary>Creates the exception with a default message.</summary>
    public ExerciseScopeViolationException()
        : base("An exercise-scoped entity was saved with a default (empty) ExerciseId; the write was blocked (COR-001/XC-001).")
    {
    }

    /// <summary>Creates the exception with a caller-supplied message.</summary>
    public ExerciseScopeViolationException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a caller-supplied message and inner exception.</summary>
    public ExerciseScopeViolationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
