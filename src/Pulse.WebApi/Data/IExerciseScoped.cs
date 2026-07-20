namespace Pulse.WebApi.Data;

/// <summary>
/// Marks an entity that belongs to exactly one exercise RUN and therefore carries the isolation
/// scope (COR-001 / XC-001). Every implementer exposes a non-nullable <see cref="ExerciseId"/> that
/// the <see cref="PulseDbContext"/> write-guard enforces is never <see cref="System.Guid.Empty"/>.
/// </summary>
/// <remarks>
/// Which entities are scoped is a question of ownership, not convenience:
/// <list type="bullet">
///   <item><description><b>Scoped</b> — <c>Persona</c>, <c>Post</c>, <c>TelemetryEvent</c> each belong
///   to one exercise run; their rows are meaningless outside it, so they implement this marker.</description></item>
///   <item><description><b>Not scoped — aggregate root:</b> <c>Exercise</c> IS the scope. Its own
///   <c>Id</c> is what everything else points at, so it does not carry a separate <c>ExerciseId</c>.</description></item>
///   <item><description><b>Not scoped — shared library asset:</b> <c>PersonaTemplate</c> is a reusable
///   authoring-library record shared across many runs (XC-005 — the telemetry schema's note that
///   persona templates are shared across runs, "never a reusable template id"). Binding it to a single
///   exercise would be wrong, so it is deliberately NOT scoped.</description></item>
/// </list>
/// </remarks>
public interface IExerciseScoped
{
    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="System.Guid.Empty"/>.</summary>
    Guid ExerciseId { get; }
}
