namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// The real <see cref="IExerciseRuntimeStatePersister"/> (demo-feedback story 18): composes an exercise's full
/// runtime state from the three in-memory singletons — the tier from <see cref="PauseTierRegistry"/> (through the
/// lazy <see cref="PauseTierReader"/>, which breaks the registry → persister → registry cycle), the anchor from the
/// clock (<see cref="IExerciseClockPersistence"/>) and the overlay from <see cref="OverlayStateService"/> — and writes
/// the whole row through <see cref="IExerciseRuntimeStateStore"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ordered per exercise.</b> The compose and the write happen together under a per-exercise gate, so two writers
/// (the registry's awaited write and a queued clock write) cannot land out of order: whichever composes later also
/// commits later, and the row always ends on the newest in-memory state. Exercises never wait on each other.
/// </para>
/// <para>
/// <b>Never throws, never rolls back</b> (see <see cref="IExerciseRuntimeStatePersister"/>): a failed write is logged
/// at Error — never with the row's content — and returns <c>false</c>.
/// </para>
/// </remarks>
public sealed partial class ExerciseRuntimeStateWriter : IExerciseRuntimeStatePersister
{
    private readonly IExerciseRuntimeStateStore _store;
    private readonly PauseTierReader _tierReader;
    private readonly IExerciseClock _clock;
    private readonly OverlayStateService _overlayState;
    private readonly ILogger<ExerciseRuntimeStateWriter> _logger;
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _gates = new();

    /// <summary>Creates the writer.</summary>
    /// <param name="store">The durable row store.</param>
    /// <param name="tierReader">Reads the authoritative tier lazily (breaks the registry DI cycle).</param>
    /// <param name="clock">The clock; persisted only when it implements <see cref="IExerciseClockPersistence"/>.</param>
    /// <param name="overlayState">The participant overlay store.</param>
    /// <param name="logger">Logs a failed write at Error.</param>
    public ExerciseRuntimeStateWriter(
        IExerciseRuntimeStateStore store,
        PauseTierReader tierReader,
        IExerciseClock clock,
        OverlayStateService overlayState,
        ILogger<ExerciseRuntimeStateWriter> logger)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(tierReader);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(logger);

        _store = store;
        _tierReader = tierReader;
        _clock = clock;
        _overlayState = overlayState;
        _logger = logger;
    }

    /// <summary>
    /// Composes exercise <paramref name="exerciseId"/>'s full runtime state from memory, right now.
    /// </summary>
    /// <param name="exerciseId">The exercise to snapshot.</param>
    /// <returns>The snapshot the row would be written from.</returns>
    public ExerciseRuntimeStateSnapshot Compose(Guid exerciseId) =>
        new(
            exerciseId,
            _tierReader(exerciseId),
            (_clock as IExerciseClockPersistence)?.GetAnchor(exerciseId),
            _overlayState.Get(exerciseId));

    /// <inheritdoc />
    public async Task<bool> PersistAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            LogUnscopedWriteIgnored();
            return false;
        }

        var gate = _gates.GetOrAdd(exerciseId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _store.UpsertAsync(Compose(exerciseId), cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogWriteFailed(ex, exerciseId);
            return false;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(
        Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            LogUnscopedWriteIgnored();
            return false;
        }

        var gate = _gates.GetOrAdd(exerciseId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _store.DeleteAsync(exerciseId, auditEvent, cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogDeleteFailed(ex, exerciseId);
            return false;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Source-generated Error for a failed write-through (CA1848). Never logs the row's content.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The runtime-state write-through for exercise {ExerciseId} FAILED. The in-memory tier, clock and " +
                  "overlay STAND, but a restart now would restore the previous persisted state.")]
    private partial void LogWriteFailed(Exception exception, Guid exerciseId);

    /// <summary>Source-generated Error for a failed runtime reset delete (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The runtime-state reset could not delete the row for exercise {ExerciseId}. The in-memory reset " +
                  "STANDS, but a restart now would restore the previous persisted state.")]
    private partial void LogDeleteFailed(Exception exception, Guid exerciseId);

    /// <summary>Source-generated warning for a write that named no exercise (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A runtime-state write named no exercise; nothing was written (COR-001 fail-closed).")]
    private partial void LogUnscopedWriteIgnored();
}
