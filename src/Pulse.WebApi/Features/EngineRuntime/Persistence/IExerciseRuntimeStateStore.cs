namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The durable home of each exercise's steering runtime state — one <see cref="ExerciseRuntimeState"/> row per
/// exercise (demo-feedback story 18, DF-24). The pause registry and the clock are singletons, so the implementation
/// opens its own scoped <c>PulseDbContext</c> per call.
/// </summary>
/// <remarks>
/// <b>Writes are scoped; the one cross-exercise read is not, and is read-only (17 Gate-1 L-4).</b>
/// <see cref="UpsertAsync"/> and <see cref="DeleteAsync"/> run under an <c>ExerciseContext</c> set to the row's own
/// exercise, so the central query filter and write guard apply exactly as on a request.
/// <see cref="ReadAllForRehydrationAsync"/> is the single documented <c>IgnoreQueryFilters</c> reader, used only by
/// the startup rehydrator, and never writes.
/// </remarks>
public interface IExerciseRuntimeStateStore
{
    /// <summary>
    /// Writes the WHOLE row for <see cref="ExerciseRuntimeStateSnapshot.ExerciseId"/> from
    /// <paramref name="snapshot"/>, inserting it when the exercise has none. Last writer wins.
    /// </summary>
    /// <param name="snapshot">The full runtime state to persist.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the row is committed; faults when the write fails.</returns>
    Task UpsertAsync(ExerciseRuntimeStateSnapshot snapshot, CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes exercise <paramref name="exerciseId"/>'s row (the runtime reset, DF-28), committing
    /// <paramref name="auditEvent"/> in the SAME unit of work when one is given (XC-004).
    /// </summary>
    /// <remarks>
    /// <b>A hard delete is deliberate (17 Gate-1 L-2).</b> The row is machine state — which tier, where the clock
    /// anchor is, which holding page is up — not in-fiction content and not AAR evidence, so XC-010's retention rule
    /// (never hard-delete exercise content) does not apply. The audit trail of the reset is the
    /// <c>steering.runtime_reset</c> telemetry event committed with the delete, and the tier changes themselves keep
    /// their own events.
    /// </remarks>
    /// <param name="exerciseId">The exercise whose row to delete (COR-001); never <see cref="Guid.Empty"/>.</param>
    /// <param name="auditEvent">The event to commit with the delete, or <c>null</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when a row existed and was deleted; <c>false</c> when there was none.</returns>
    Task<bool> DeleteAsync(Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads EVERY exercise's row for the startup rehydrator — the single cross-exercise reader. Read-only (no
    /// tracking); also reports whether each row's exercise still exists, so a row for a missing exercise is skipped.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Every persisted row, ordered by exercise id.</returns>
    Task<IReadOnlyList<PersistedExerciseRuntimeState>> ReadAllForRehydrationAsync(CancellationToken cancellationToken = default);
}

/// <summary>One row as read by <see cref="IExerciseRuntimeStateStore.ReadAllForRehydrationAsync"/>.</summary>
/// <param name="Row">The detached row.</param>
/// <param name="ExerciseExists">Whether the row's exercise still exists.</param>
public sealed record PersistedExerciseRuntimeState(ExerciseRuntimeState Row, bool ExerciseExists);
