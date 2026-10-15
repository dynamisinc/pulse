namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Writes an exercise's CURRENT in-memory steering state (tier, clock anchor, overlay) through to its
/// <see cref="ExerciseRuntimeState"/> row (demo-feedback story 18, DF-24). The pause registry awaits it after every
/// applied tier change; the clock's write queue calls it for clock-only changes; the runtime reset deletes through it.
/// </summary>
/// <remarks>
/// <b>Never throws, never rolls back.</b> The in-memory change has already happened and the world has felt it, so a
/// failed write is logged at Error and reported as <c>false</c> (the console's <c>persisted: false</c>); the caller
/// keeps the applied state. Cancellation is the one exception allowed to propagate.
/// </remarks>
public interface IExerciseRuntimeStatePersister
{
    /// <summary>
    /// Composes exercise <paramref name="exerciseId"/>'s full runtime state from memory and upserts its row.
    /// </summary>
    /// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when the row was written; <c>false</c> when the write failed (already logged).</returns>
    Task<bool> PersistAsync(Guid exerciseId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes exercise <paramref name="exerciseId"/>'s row (the runtime reset, DF-28), committing
    /// <paramref name="auditEvent"/> with it.
    /// </summary>
    /// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
    /// <param name="auditEvent">The reset's one telemetry event, committed in the same unit of work.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when the delete committed (or there was nothing to delete); <c>false</c> when it failed.</returns>
    Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IExerciseRuntimeStatePersister"/> until <c>AddExerciseRuntimePersistence()</c> is wired
/// (seam S-5): writes nothing and reports success, so the pause tier behaves exactly as before story 18 (in memory
/// only). Registered with <c>TryAddSingleton</c> by <c>AddPauseTierSteering()</c> and replaced, in either wiring
/// order, by the real <see cref="ExerciseRuntimeStateWriter"/>.
/// </summary>
public sealed class NullExerciseRuntimeStatePersister : IExerciseRuntimeStatePersister
{
    /// <inheritdoc />
    public Task<bool> PersistAsync(Guid exerciseId, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);

    /// <inheritdoc />
    public Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default) =>
        Task.FromResult(true);
}
