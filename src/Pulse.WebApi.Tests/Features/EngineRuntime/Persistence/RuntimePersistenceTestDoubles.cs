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

    /// <summary>Failures thrown, in order, by the next upserts/deletes (before <see cref="FailWith"/> is consulted).</summary>
    public ConcurrentQueue<Exception> FailNextWrites { get; } = new();

    /// <summary>Failures thrown, in order, by the next rehydration reads.</summary>
    public ConcurrentQueue<Exception> FailNextReads { get; } = new();

    public int UpsertCount;

    public int ReadCount;

    public Task UpsertAsync(ExerciseRuntimeStateSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref UpsertCount);
        cancellationToken.ThrowIfCancellationRequested();
        if (FailNextWrites.TryDequeue(out var next))
        {
            throw next;
        }

        if (FailWith is not null)
        {
            throw FailWith;
        }

        Rows[snapshot.ExerciseId] = snapshot;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (FailNextWrites.TryDequeue(out var next))
        {
            throw next;
        }

        if (FailWith is not null)
        {
            throw FailWith;
        }

        return Task.FromResult(Rows.TryRemove(exerciseId, out _));
    }

    public Task<IReadOnlyList<PersistedExerciseRuntimeState>> ReadAllForRehydrationAsync(
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref ReadCount);
        if (FailNextReads.TryDequeue(out var next))
        {
            throw next;
        }

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

/// <summary>
/// Builds a real <see cref="Microsoft.Data.SqlClient.SqlException"/> carrying a given error number (e.g. 40613, a
/// serverless database resuming) through SqlClient's internal factories — the type has no public constructor.
/// Test-only reflection over Microsoft.Data.SqlClient 6.x.
/// </summary>
internal static class SqlExceptionFactory
{
    public static Microsoft.Data.SqlClient.SqlException Create(int number, string message = "Database is not currently available.")
    {
        const System.Reflection.BindingFlags Any =
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static;
        var errorType = typeof(Microsoft.Data.SqlClient.SqlError);
        var errorCtor = errorType.GetConstructors(Any).OrderByDescending(c => c.GetParameters().Length).First();
        var args = errorCtor.GetParameters().Select(p => p.ParameterType switch
        {
            var t when t == typeof(int) && p.Name == "infoNumber" => (object?)number,
            var t when t == typeof(int) => 0,
            var t when t == typeof(uint) => 0u,
            var t when t == typeof(byte) => (byte)0,
            var t when t == typeof(string) && p.Name == "errorMessage" => message,
            var t when t == typeof(string) => "server",
            _ => null,
        }).ToArray();
        var error = (Microsoft.Data.SqlClient.SqlError)errorCtor.Invoke(args);

        var collection = (Microsoft.Data.SqlClient.SqlErrorCollection)Activator.CreateInstance(
            typeof(Microsoft.Data.SqlClient.SqlErrorCollection), nonPublic: true)!;
        typeof(Microsoft.Data.SqlClient.SqlErrorCollection).GetMethod("Add", Any)!.Invoke(collection, [error]);

        var create = typeof(Microsoft.Data.SqlClient.SqlException).GetMethods(Any)
            .Where(m => m.Name == "CreateException")
            .OrderBy(m => m.GetParameters().Length)
            .First(m => m.GetParameters()[0].ParameterType == typeof(Microsoft.Data.SqlClient.SqlErrorCollection));
        var createArgs = create.GetParameters().Select((p, i) => i == 0 ? collection : p.ParameterType == typeof(string) ? "16.0" : (p.HasDefaultValue ? p.DefaultValue : null)).ToArray();
        return (Microsoft.Data.SqlClient.SqlException)create.Invoke(null, createArgs)!;
    }
}
