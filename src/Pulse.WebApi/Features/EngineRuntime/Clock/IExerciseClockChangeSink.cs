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

/// <summary>
/// Told, synchronously and AFTER the in-memory apply, that exercise <paramref name="exerciseId"/>'s clock state
/// changed — the multi-registration hook beside the single <see cref="IExerciseClockChangeSink"/>
/// (fix/noise-new-posts-clock). The persistence slice owns (and replaces) the one sink; observers are additive, so a
/// second consumer (the <c>ScenarioClockChanged</c> push) composes with the write-through instead of displacing it.
/// </summary>
/// <remarks>
/// <para>
/// <b>When.</b> After every <see cref="IExerciseClock.Start"/>, <see cref="IExerciseClock.Freeze"/>,
/// <see cref="IExerciseClock.Unfreeze"/> and <see cref="IExerciseClock.Jump"/> (like the sink), AND after
/// <see cref="IExerciseClockPersistence.Restore"/> (the startup rehydrate) and <see cref="IExerciseClockPersistence.Clear"/>
/// (the runtime reset) — neither of which tells the sink, because those writes are already current.
/// </para>
/// <para>
/// <b>Contract: never block, never throw.</b> The same rule as the sink: the clock's mutators run inside
/// <c>PauseTierRegistry</c>'s lock, so an implementation only QUEUES work and logs its own failures.
/// </para>
/// </remarks>
public interface IExerciseClockChangeObserver
{
    /// <summary>Records that exercise <paramref name="exerciseId"/>'s clock state changed.</summary>
    /// <param name="exerciseId">The exercise whose clock changed.</param>
    void ClockChanged(Guid exerciseId);
}
