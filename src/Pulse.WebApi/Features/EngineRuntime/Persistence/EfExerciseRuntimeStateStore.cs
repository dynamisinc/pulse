namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The EF Core <see cref="IExerciseRuntimeStateStore"/> (demo-feedback story 18). A singleton that opens a fresh DI
/// scope (and with it a fresh <see cref="PulseDbContext"/>) per call, because its callers — the pause registry, the
/// clock's write queue and the rehydrator — are singletons and a captured context would be a captive dependency.
/// </summary>
/// <remarks>
/// <b>Scope per write (COR-001), the <c>ReactionLoopHost</c> pattern.</b> Each write sets the new scope's
/// <see cref="ExerciseContext.CurrentExerciseId"/> to the row's own exercise BEFORE resolving the context, so the
/// read of the existing row goes through the central query filter and the save goes through the write guard. There
/// is no client input anywhere on this path: the exercise id is always the server-resolved scope a caller already
/// acted under.
/// </remarks>
public sealed class EfExerciseRuntimeStateStore : IExerciseRuntimeStateStore
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the store.</summary>
    /// <param name="scopeFactory">Creates the per-call scope the <see cref="PulseDbContext"/> lives in.</param>
    /// <param name="timeProvider">The server wall clock that stamps <see cref="ExerciseRuntimeState.UpdatedAt"/>.</param>
    public EfExerciseRuntimeStateStore(IServiceScopeFactory scopeFactory, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(timeProvider);
        _scopeFactory = scopeFactory;
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public async Task UpsertAsync(ExerciseRuntimeStateSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        RequireExercise(snapshot.ExerciseId);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = ScopedContextFor(scope.ServiceProvider, snapshot.ExerciseId);

        var row = await dbContext.ExerciseRuntimeStates
            .SingleOrDefaultAsync(state => state.ExerciseId == snapshot.ExerciseId, cancellationToken)
            .ConfigureAwait(false);

        if (row is null)
        {
            row = new ExerciseRuntimeState { ExerciseId = snapshot.ExerciseId };
            dbContext.ExerciseRuntimeStates.Add(row);
        }

        ExerciseRuntimeStateMapping.CopyTo(snapshot, row, _timeProvider.GetUtcNow());
        await dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(
        Guid exerciseId, TelemetryEvent? auditEvent, CancellationToken cancellationToken = default)
    {
        RequireExercise(exerciseId);

        if (auditEvent is not null && auditEvent.ExerciseId != exerciseId)
        {
            throw new ArgumentException(
                "The reset's audit event must belong to the exercise being reset (COR-001).", nameof(auditEvent));
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = ScopedContextFor(scope.ServiceProvider, exerciseId);

        var row = await dbContext.ExerciseRuntimeStates
            .SingleOrDefaultAsync(state => state.ExerciseId == exerciseId, cancellationToken)
            .ConfigureAwait(false);

        // Hard delete by design (17 Gate-1 L-2): machine state, not content or AAR evidence — see the interface.
        if (row is not null)
        {
            dbContext.ExerciseRuntimeStates.Remove(row);
        }

        if (auditEvent is not null)
        {
            dbContext.TelemetryEvents.Add(auditEvent);
        }

        // ONE unit of work: the delete and its audit event commit together or not at all.
        if (row is not null || auditEvent is not null)
        {
            await dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        return row is not null;
    }

    /// <inheritdoc />
    /// <remarks>
    /// <b>The single documented cross-exercise reader (17 Gate-1 L-4; the <c>WhiteNoisePacer</c> pattern).</b> A
    /// trusted server-side startup sweep with no request and no resolved scope, so it reads with
    /// <c>IgnoreQueryFilters</c> and <c>AsNoTracking</c>; it writes nothing, and every row it returns is applied to
    /// in-memory state for THAT row's exercise only. Nothing it reads ever reaches a participant.
    /// </remarks>
    public async Task<IReadOnlyList<PersistedExerciseRuntimeState>> ReadAllForRehydrationAsync(
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

        var rows = await dbContext.ExerciseRuntimeStates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .OrderBy(state => state.ExerciseId)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (rows.Count == 0)
        {
            return [];
        }

        var ids = rows.Select(state => state.ExerciseId).ToList();

        // org-scope-exempt(ResolvedScope): an existence check by ids read from the server's own runtime-state rows (each written only under its exercise's resolved scope); it returns ids, nothing tenant-bound is disclosed or written.
        var existing = await dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => ids.Contains(exercise.Id))
            .Select(exercise => exercise.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var existingIds = existing.ToHashSet();
        return rows.Select(row => new PersistedExerciseRuntimeState(row, existingIds.Contains(row.ExerciseId))).ToList();
    }

    private static PulseDbContext ScopedContextFor(IServiceProvider provider, Guid exerciseId)
    {
        // Establish the scope BEFORE PulseDbContext is resolved, so it captures it (COR-001).
        if (provider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
        {
            exerciseContext.CurrentExerciseId = exerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the runtime-state store cannot establish its scope (COR-001).");
        }

        return provider.GetRequiredService<PulseDbContext>();
    }

    private static void RequireExercise(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A runtime-state write must name an exercise (COR-001).", nameof(exerciseId));
        }
    }
}
