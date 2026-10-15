namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Persistence;

/// <summary>A logger that records every entry's level, message and exception (story 18 tests).</summary>
/// <typeparam name="T">The category.</typeparam>
internal sealed class RecordingLogger<T> : ILogger<T>
{
    public ConcurrentQueue<(LogLevel Level, string Message, Exception? Exception)> Entries { get; } = new();

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Entries.Enqueue((logLevel, formatter(state, exception), exception));
}

/// <summary>
/// An in-memory <see cref="IExerciseRuntimeStateStore"/> that can be told to fail, and that records every call —
/// for the unit-level write-through and rehydrator tests (the SQL behaviour is proven against the real store).
/// </summary>
internal sealed class InMemoryRuntimeStateStore : IExerciseRuntimeStateStore
{
    public ConcurrentDictionary<Guid, ExerciseRuntimeStateSnapshot> Rows { get; } = new();

    public List<PersistedExerciseRuntimeState> RehydrationRows { get; } = [];

    public Exception? FailWith { get; set; }

    public Exception? FailReadWith { get; set; }

    public int UpsertCount;

    public Task UpsertAsync(ExerciseRuntimeStateSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref UpsertCount);
        if (FailWith is not null)
        {
            throw FailWith;
        }

        Rows[snapshot.ExerciseId] = snapshot;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default)
    {
        if (FailWith is not null)
        {
            throw FailWith;
        }

        return Task.FromResult(Rows.TryRemove(exerciseId, out _));
    }

    public Task<IReadOnlyList<PersistedExerciseRuntimeState>> ReadAllForRehydrationAsync(
        CancellationToken cancellationToken = default)
    {
        if (FailReadWith is not null)
        {
            throw FailReadWith;
        }

        return Task.FromResult<IReadOnlyList<PersistedExerciseRuntimeState>>(RehydrationRows.ToList());
    }
}

/// <summary>A persister that records each call and runs an optional callback, reporting a configurable result.</summary>
internal sealed class RecordingPersister : IExerciseRuntimeStatePersister
{
    public List<Guid> Persisted { get; } = [];

    public bool Result { get; set; } = true;

    public Action<Guid>? OnPersist { get; set; }

    public Task<bool> PersistAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        Persisted.Add(exerciseId);
        OnPersist?.Invoke(exerciseId);
        return Task.FromResult(Result);
    }

    public Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default) =>
        Task.FromResult(Result);
}
