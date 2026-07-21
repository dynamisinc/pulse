namespace Pulse.WebApi.Tests.Features.EngineRuntime;

/// <summary>
/// A hand-advanced <see cref="TimeProvider"/> for clock tests — the CI box has no <c>FakeTimeProvider</c>
/// package, so scenario time is driven deterministically here. Advancing moves both the monotonic timestamp
/// (what <see cref="ExerciseClockService"/> reads via <see cref="TimeProvider.GetElapsedTime(long)"/>) and the
/// wall clock in lockstep.
/// </summary>
internal sealed class ManualTimeProvider : TimeProvider
{
    private long _timestamp;
    private DateTimeOffset _utcNow;

    public ManualTimeProvider(DateTimeOffset start)
    {
        _utcNow = start;
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public override long GetTimestamp() => _timestamp;

    /// <summary>Advances both the monotonic timestamp and the wall clock by <paramref name="by"/>.</summary>
    public void Advance(TimeSpan by)
    {
        _utcNow += by;
        _timestamp += (long)(by.TotalSeconds * TimestampFrequency);
    }
}
