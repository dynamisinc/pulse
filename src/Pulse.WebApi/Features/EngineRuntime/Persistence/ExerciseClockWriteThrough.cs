namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The clock's fire-and-observe write-through (demo-feedback story 18): the real <see cref="IExerciseClockChangeSink"/>.
/// <see cref="ClockChanged"/> only QUEUES the exercise id — it never blocks and never throws, because the clock is
/// mutated inside <c>PauseTierRegistry</c>'s lock and its readers are synchronous — and one background consumer
/// writes each queued exercise's current state through <see cref="IExerciseRuntimeStatePersister"/>, which logs a
/// failure at Error.
/// </summary>
/// <remarks>
/// <para>
/// <b>Coalescing.</b> An exercise already waiting in the queue is not queued twice: the write composes the state at
/// write time, so one write covers every change that happened before it (a Freeze that starts then freezes a cold
/// clock is one or two writes, not a backlog).
/// </para>
/// <para>
/// <b>Lazy persister (DI cycle).</b> The clock depends on this sink, and the persister depends on the clock, so the
/// persister is resolved from the root provider on first use, never in the constructor.
/// </para>
/// </remarks>
public sealed partial class ExerciseClockWriteThrough : IExerciseClockChangeSink, IAsyncDisposable, IDisposable
{
    private readonly IServiceProvider _services;
    private readonly ILogger<ExerciseClockWriteThrough> _logger;
    private readonly Channel<Guid> _channel =
        Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    private readonly ConcurrentDictionary<Guid, byte> _queued = new();
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _consumer;
    private int _outstanding;

    /// <summary>Creates the queue and starts its single consumer.</summary>
    /// <param name="services">The root provider the persister is resolved from on first use.</param>
    /// <param name="logger">Logs a consumer fault.</param>
    public ExerciseClockWriteThrough(IServiceProvider services, ILogger<ExerciseClockWriteThrough> logger)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(logger);
        _services = services;
        _logger = logger;
        _consumer = Task.Run(ConsumeAsync);
    }

    /// <inheritdoc />
    public void ClockChanged(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty || !_queued.TryAdd(exerciseId, 0))
        {
            return;
        }

        Interlocked.Increment(ref _outstanding);
        if (!_channel.Writer.TryWrite(exerciseId))
        {
            // Only after disposal: nothing more will be written.
            _queued.TryRemove(exerciseId, out _);
            Interlocked.Decrement(ref _outstanding);
        }
    }

    /// <summary>
    /// Waits until every queued clock write has been attempted (tests and orderly shutdown; production code never
    /// needs to wait on it).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the queue is idle.</returns>
    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        while (Volatile.Read(ref _outstanding) > 0)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(5), cancellationToken).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        _channel.Writer.TryComplete();
        try
        {
            // Give queued writes a bounded chance to land on an orderly shutdown, then stop.
            await _consumer.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            await _stopping.CancelAsync().ConfigureAwait(false);
            if (!_consumer.IsCompleted)
            {
                // The consumer still holds the token; leave the source to the finalizer rather than race it.
                return;
            }
        }

        _stopping.Dispose();
    }

    /// <summary>
    /// Synchronous disposal (a container disposed with <c>Dispose</c>): stops accepting work and gives queued writes
    /// a short, bounded chance to land.
    /// </summary>
    public void Dispose()
    {
        _channel.Writer.TryComplete();
        if (!_consumer.Wait(TimeSpan.FromSeconds(2)))
        {
            _stopping.Cancel();
            return;
        }

        _stopping.Dispose();
    }

    private async Task ConsumeAsync()
    {
        IExerciseRuntimeStatePersister? persister = null;

        await foreach (var exerciseId in _channel.Reader.ReadAllAsync().ConfigureAwait(false))
        {
            // Dequeue BEFORE writing, so a change that lands during the write queues a fresh one.
            _queued.TryRemove(exerciseId, out _);
            try
            {
                persister ??= _services.GetRequiredService<IExerciseRuntimeStatePersister>();
                await persister.PersistAsync(exerciseId, _stopping.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
            {
                return;
            }
#pragma warning disable CA1031 // The consumer must outlive any one failed write (the persister already logs its own).
            catch (Exception ex)
            {
                LogConsumerFault(ex, exerciseId);
            }
#pragma warning restore CA1031
            finally
            {
                Interlocked.Decrement(ref _outstanding);
            }
        }
    }

    /// <summary>Source-generated Error for an unexpected consumer fault (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The queued clock write-through for exercise {ExerciseId} faulted; the clock STANDS in memory.")]
    private partial void LogConsumerFault(Exception exception, Guid exerciseId);
}
