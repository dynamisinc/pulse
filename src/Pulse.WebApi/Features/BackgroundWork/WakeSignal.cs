namespace Pulse.WebApi.Features.BackgroundWork;

using System.Threading.Channels;

/// <summary>
/// An in-process wake-up line from the code that creates background work to the hosted service that does it. The
/// service sleeps (indefinitely, when idle) and a producer calls <see cref="Wake"/> AFTER it commits the work, so the
/// service sweeps at once instead of polling the database on a fixed cadence. Singleton per service; wakes coalesce
/// (any number of wakes before the service looks count as one), and a wake raised while the service is busy is kept
/// for its next wait, so a wake can never be lost between a sweep and the sleep that follows it.
/// </summary>
/// <remarks>
/// Polling on a fixed cadence while there is nothing to do kept the serverless database awake around the clock
/// (it can only auto-pause after an hour with no queries). Idle services now sleep until woken.
/// </remarks>
public class WakeSignal
{
    private readonly Channel<bool> _wakes = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    /// <summary>Asks the service to sweep now. Never blocks; extra wakes are coalesced.</summary>
    public void Wake() => _wakes.Writer.TryWrite(true);

    /// <summary>
    /// Waits until <see cref="Wake"/> is called or <paramref name="timeout"/> elapses on <paramref name="timeProvider"/>.
    /// </summary>
    /// <param name="timeout">The longest to wait; <see cref="Timeout.InfiniteTimeSpan"/> waits for a wake only.</param>
    /// <param name="timeProvider">The clock the timeout runs on.</param>
    /// <param name="cancellationToken">Cancels the wait (throws).</param>
    /// <returns><c>true</c> when woken; <c>false</c> when the timeout elapsed.</returns>
    public async Task<bool> WaitAsync(TimeSpan timeout, TimeProvider timeProvider, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);

        if (_wakes.Reader.TryRead(out _))
        {
            return true;
        }

        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var woken = _wakes.Reader.WaitToReadAsync(stop.Token).AsTask();
        var elapsed = Task.Delay(timeout, timeProvider, stop.Token);
        var first = await Task.WhenAny(woken, elapsed).ConfigureAwait(false);
        await stop.CancelAsync().ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        return first == woken && _wakes.Reader.TryRead(out _);
    }
}
