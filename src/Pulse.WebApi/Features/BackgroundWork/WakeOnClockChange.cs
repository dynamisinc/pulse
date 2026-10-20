namespace Pulse.WebApi.Features.BackgroundWork;

using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Wakes a <see cref="WakeSignal"/> whenever any exercise clock changes. A service that treats "no exercise clock is
/// running" as idle (nothing it watches can progress) registers one, so a clock that starts or unfreezes — the reaction
/// loop's first tick, leaving Freeze — wakes it. Never blocks or throws (<see cref="WakeSignal.Wake"/> is a TryWrite).
/// </summary>
public sealed class WakeOnClockChange : IExerciseClockChangeListener
{
    private readonly WakeSignal _signal;

    /// <summary>Creates the listener.</summary>
    /// <param name="signal">The signal to wake.</param>
    public WakeOnClockChange(WakeSignal signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        _signal = signal;
    }

    /// <inheritdoc />
    public void ClockChanged(Guid exerciseId) => _signal.Wake();
}
