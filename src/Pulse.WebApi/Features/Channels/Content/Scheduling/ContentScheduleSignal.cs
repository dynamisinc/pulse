namespace Pulse.WebApi.Features.Channels.Content.Scheduling;

using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Injects;

/// <summary>
/// The <see cref="ContentScheduleRunner"/>'s wake-up line (a singleton): a clock change pokes it so a jump or a resume
/// publishes what became due at once instead of on the next interval. Wake-ups coalesce (the
/// <see cref="InjectRunnerSignal"/> mechanics, a separate instance).
/// </summary>
public sealed class ContentScheduleSignal
{
    private readonly InjectRunnerSignal _wakes = new();

    /// <summary>Asks the runner to sweep now. Never blocks.</summary>
    public void Wake() => _wakes.Wake();

    /// <summary>Waits for a wake-up or <paramref name="timeout"/>, whichever comes first.</summary>
    /// <param name="timeout">The longest wait.</param>
    /// <param name="timeProvider">The clock the timeout runs on.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when a wake-up ended the wait.</returns>
    public Task<bool> WaitAsync(TimeSpan timeout, TimeProvider timeProvider, CancellationToken cancellationToken) =>
        _wakes.WaitAsync(timeout, timeProvider, cancellationToken);
}

/// <summary>
/// Wakes the <see cref="ContentScheduleRunner"/> whenever an exercise's clock changes (a jump, a freeze, a resume; COR-051):
/// a forward jump past scheduled items publishes them at once. Only queues a wake-up, per the
/// <see cref="IExerciseClockChangeObserver"/> contract (never block, never throw).
/// </summary>
public sealed class ContentScheduleClockObserver : IExerciseClockChangeObserver
{
    private readonly ContentScheduleSignal _signal;

    /// <summary>Creates the observer.</summary>
    /// <param name="signal">The runner's wake-up line.</param>
    public ContentScheduleClockObserver(ContentScheduleSignal signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        _signal = signal;
    }

    /// <inheritdoc />
    public void ClockChanged(Guid exerciseId) => _signal.Wake();
}
