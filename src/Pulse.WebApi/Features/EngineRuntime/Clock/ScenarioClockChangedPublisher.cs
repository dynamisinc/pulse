namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The clock's fire-and-observe <c>ScenarioClockChanged</c> push (fix/noise-new-posts-clock): an
/// <see cref="IExerciseClockChangeObserver"/> that composes with the persistence slice's single
/// <see cref="IExerciseClockChangeSink"/> rather than replacing it. <see cref="ClockChanged"/> only QUEUES the exercise
/// id — it never blocks and never throws, because the clock is mutated inside <c>PauseTierRegistry</c>'s lock — and one
/// background consumer reads the exercise's CURRENT clock state and sends it through
/// <see cref="IFeedBroadcaster.BroadcastScenarioClockChangedAsync"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Coalescing.</b> An exercise already waiting in the queue is not queued twice: the payload is read at send time,
/// so one push covers every change before it, and a client always converges on the latest state.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> The exercise id comes only from the clock mutation itself (always a server-resolved
/// scope), and the frame goes through the broadcaster's lifecycle-gated group choice, so a clock change in exercise
/// A never reaches a connection in exercise B.
/// </para>
/// <para>
/// <b>Lazy dependencies (DI cycle).</b> The clock depends on this observer and this observer reads the clock, so the
/// clock is resolved from the root provider on first use, never in the constructor. The scoped
/// <see cref="IFeedBroadcaster"/> is resolved in a scope of its own per push; a host without one sends nothing.
/// </para>
/// </remarks>
public sealed partial class ScenarioClockChangedPublisher : IExerciseClockChangeObserver, IAsyncDisposable, IDisposable
{
    /// <summary>How long one push may take before it is abandoned (a stuck transport must not stall the queue).</summary>
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(10);

    private readonly IServiceProvider _services;
    private readonly ILogger<ScenarioClockChangedPublisher> _logger;
    private readonly Channel<Guid> _channel =
        Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    private readonly ConcurrentDictionary<Guid, byte> _queued = new();
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _consumer;
    private int _outstanding;

    /// <summary>Creates the queue and starts its single consumer.</summary>
    /// <param name="services">The root provider the clock and broadcaster are resolved from on use.</param>
    /// <param name="logger">Logs a failed push.</param>
    public ScenarioClockChangedPublisher(IServiceProvider services, ILogger<ScenarioClockChangedPublisher> logger)
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
            // Only after disposal: nothing more will be sent.
            _queued.TryRemove(exerciseId, out _);
            Interlocked.Decrement(ref _outstanding);
        }
    }

    /// <summary>
    /// Waits until every queued push has been attempted (tests and orderly shutdown; production code never needs to
    /// wait on it).
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
            await _consumer.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
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

    /// <summary>Synchronous disposal: stops accepting work and gives queued pushes a short, bounded chance.</summary>
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
        await foreach (var exerciseId in _channel.Reader.ReadAllAsync().ConfigureAwait(false))
        {
            // Dequeue BEFORE reading, so a change that lands during the send queues a fresh push.
            _queued.TryRemove(exerciseId, out _);
            try
            {
                await PushAsync(exerciseId).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
            {
                return;
            }
#pragma warning disable CA1031 // The consumer must outlive any one failed push; clients resync on their next read.
            catch (Exception ex)
            {
                LogPushFailed(ex, exerciseId);
            }
#pragma warning restore CA1031
            finally
            {
                Interlocked.Decrement(ref _outstanding);
            }
        }
    }

    private async Task PushAsync(Guid exerciseId)
    {
        var clock = _services.GetRequiredService<IExerciseClock>();
        var timeProvider = _services.GetService<TimeProvider>() ?? TimeProvider.System;

        await using var scope = _services.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();
        var broadcaster = scope.ServiceProvider.GetService<IFeedBroadcaster>();
        if (broadcaster is null)
        {
            return;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stopping.Token);
        timeout.CancelAfter(SendTimeout);

        // Read at send time (coalescing): the payload is the clock as it is NOW, never a stale queued snapshot.
        var state = ScenarioClockDto.Read(clock, timeProvider, exerciseId);
        await broadcaster.BroadcastScenarioClockChangedAsync(
            exerciseId, ScenarioClockChangedDto.From(exerciseId, state), timeout.Token).ConfigureAwait(false);
    }

    /// <summary>Source-generated Warning for a failed push (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The ScenarioClockChanged push for exercise {ExerciseId} failed; clients resync on their next clock read.")]
    private partial void LogPushFailed(Exception exception, Guid exerciseId);
}
