namespace Pulse.WebApi.Features.Injects;

using System.Threading.Channels;

/// <summary>
/// The in-process wake-up line from <see cref="InjectQueueService"/> to <see cref="InjectBurstRunner"/> (L6). The
/// runner idles at a slow cadence when nothing is firing and ticks every second while something is; a controller
/// action that starts or resumes a burst calls <see cref="Wake"/> so the runner switches cadence at once instead of
/// waiting out its idle sleep. Singleton; wakes coalesce (any number of wakes before the runner looks count as one).
/// </summary>
public sealed class InjectRunnerSignal
{
    private readonly Channel<bool> _wakes = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    /// <summary>Asks the runner to tick now. Never blocks; extra wakes are coalesced.</summary>
    public void Wake() => _wakes.Writer.TryWrite(true);

    /// <summary>
    /// Waits until <see cref="Wake"/> is called or <paramref name="timeout"/> elapses on <paramref name="timeProvider"/>.
    /// </summary>
    /// <param name="timeout">The longest to wait.</param>
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
