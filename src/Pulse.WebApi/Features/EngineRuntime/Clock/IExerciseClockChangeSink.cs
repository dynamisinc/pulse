namespace Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Told, synchronously and AFTER the in-memory apply, that exercise <paramref name="exerciseId"/>'s clock anchor
/// changed (<see cref="IExerciseClock.Start"/>, <see cref="IExerciseClock.Freeze"/>,
/// <see cref="IExerciseClock.Unfreeze"/> or <see cref="IExerciseClock.Jump"/>) — the hook the persistence slice
/// (story 18) uses to write the anchor through.
/// </summary>
/// <remarks>
/// <b>Contract: never block, never throw.</b> The clock's readers are synchronous and the clock's mutators are called
/// inside <c>PauseTierRegistry</c>'s lock, so an implementation must only QUEUE work (fire-and-observe) and log its
/// own failures. <see cref="IExerciseClock.CurrentScenarioMinute"/>-style reads never call the sink at all.
/// </remarks>
public interface IExerciseClockChangeSink
{
    /// <summary>Records that exercise <paramref name="exerciseId"/>'s clock anchor changed.</summary>
    /// <param name="exerciseId">The exercise whose clock changed.</param>
    void ClockChanged(Guid exerciseId);
}

/// <summary>
/// Told, like <see cref="IExerciseClockChangeSink"/>, that an exercise's clock anchor changed — but any number may be
/// registered (the sink is a single slot the persistence slice owns). Background services that sleep while no exercise
/// clock is running register one, so a clock that starts or unfreezes wakes them (idle-db-autopause). Same contract:
/// never block, never throw.
/// </summary>
public interface IExerciseClockChangeListener
{
    /// <summary>Told that exercise <paramref name="exerciseId"/>'s clock anchor changed.</summary>
    /// <param name="exerciseId">The exercise whose clock changed.</param>
    void ClockChanged(Guid exerciseId);
}

/// <summary>
/// The default <see cref="IExerciseClockChangeSink"/>: does nothing. Registered with <c>TryAddSingleton</c> by
/// <see cref="ExerciseClockServiceCollectionExtensions.AddExerciseClock"/>, and replaced by
/// <c>AddExerciseRuntimePersistence()</c> (story 18) with the queue that writes the anchor through.
/// </summary>
public sealed class NullExerciseClockChangeSink : IExerciseClockChangeSink
{
    /// <inheritdoc />
    public void ClockChanged(Guid exerciseId)
    {
    }
}
