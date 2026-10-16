namespace Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The restart-resilience side of the native clock (demo-feedback story 18, DF-24/DF-25), kept OFF
/// <see cref="IExerciseClock"/> on purpose: the engine-facing clock contract (and every test double of it) is
/// unchanged, and only the persistence slice reaches for these three operations. <see cref="ExerciseClockService"/>
/// implements both interfaces; a clock that does not implement this one is simply not persisted.
/// </summary>
public interface IExerciseClockPersistence
{
    /// <summary>
    /// Reads exercise <paramref name="exerciseId"/>'s current anchor, or <c>null</c> when its clock has never been
    /// started (or was cleared). Synchronous and in-memory: it never touches a database.
    /// </summary>
    /// <param name="exerciseId">The exercise whose clock to snapshot.</param>
    /// <returns>The anchor, or <c>null</c> for an unstarted clock.</returns>
    ExerciseClockAnchor? GetAnchor(Guid exerciseId);

    /// <summary>
    /// Rebuilds exercise <paramref name="exerciseId"/>'s clock from a persisted <paramref name="anchor"/> at startup.
    /// A running anchor resumes at <c>elapsedAtAnchor + (utcNow - wallAnchorUtc)</c> (the clock kept advancing
    /// through the downtime); a frozen one holds <c>elapsedAtAnchor</c>. This is NOT a <see cref="IExerciseClock.Start"/>:
    /// it does not reset the minute and it raises no change notification (the row it came from is already current).
    /// </summary>
    /// <param name="exerciseId">The exercise to restore (COR-001); must not be empty.</param>
    /// <param name="anchor">The persisted anchor.</param>
    void Restore(Guid exerciseId, ExerciseClockAnchor anchor);

    /// <summary>
    /// Clears exercise <paramref name="exerciseId"/>'s clock back to UNSTARTED (the runtime reset, DF-28): afterwards
    /// <see cref="IExerciseClock.IsRunning"/> and <see cref="IExerciseClock.IsFrozen"/> are both false and the
    /// scenario minute reads 0. Raises no change notification (the reset deletes the row itself).
    /// </summary>
    /// <param name="exerciseId">The exercise whose clock to clear.</param>
    /// <returns><c>true</c> when a started clock was cleared; <c>false</c> when there was none.</returns>
    bool Clear(Guid exerciseId);
}
