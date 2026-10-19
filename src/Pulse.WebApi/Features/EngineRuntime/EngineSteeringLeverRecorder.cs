namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;

/// <summary>One steering-lever change to record (#618): what changed, on which exercise, and who changed it.</summary>
/// <param name="ExerciseId">The SERVER-resolved exercise the lever acted on (never a request value).</param>
/// <param name="Actor">The verified session person behind the lever, or <c>null</c> for a system action.</param>
/// <param name="EventType">The XC-004 event type (<see cref="StaffChangeEventTypes"/>).</param>
/// <param name="AuditKind">The org-audit kind.</param>
/// <param name="Payload">The opaque JSON payload (shared by the event and the audit row).</param>
/// <param name="ScenarioTime">The live scenario clock's instant, or <c>null</c> when the clock has not started.</param>
/// <param name="WallClock">The ONE server wall-clock read of the operation.</param>
public sealed record EngineSteeringLeverRecord(
    Guid ExerciseId,
    StaffChangeActor? Actor,
    string EventType,
    string AuditKind,
    string Payload,
    DateTimeOffset? ScenarioTime,
    DateTimeOffset WallClock);

/// <summary>
/// Persists a steering-lever record (XC-004 event + org audit) — the seam <see cref="EngineReviewService"/> records its
/// in-memory autonomy levers through (#618).
/// </summary>
public interface IEngineSteeringLeverRecorder
{
    /// <summary>
    /// Records <paramref name="record"/>. Best-effort and NEVER throws: the lever is process memory and is already live,
    /// so a failed record is logged, never surfaced (it must not turn an applied lever into a 500, nor skip anything the
    /// caller does after it).
    /// </summary>
    /// <param name="record">The change to record.</param>
    /// <returns>A task that completes when the record was written or its failure logged.</returns>
    Task RecordAsync(EngineSteeringLeverRecord record);
}

/// <summary>
/// The production <see cref="IEngineSteeringLeverRecorder"/>: stages the event + audit through the shared
/// <see cref="StaffChangeRecorder"/> in its OWN DI scope (its own <see cref="PulseDbContext"/>), exactly like the
/// "no lead ⇒ swamped off" record in <c>ExerciseCallerRole.EnsureSwampedOffWithoutLeadAsync</c> (Gate-1 WR-003) — so it
/// never flushes, nor is poisoned by, whatever the request's unit of work has tracked. It runs with
/// <see cref="CancellationToken.None"/>: an aborted request must not lose the record of a change that already applied.
/// </summary>
public sealed partial class EngineSteeringLeverRecorder : IEngineSteeringLeverRecorder
{
    private const string ExerciseEntityType = "exercise";

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<EngineSteeringLeverRecorder> _logger;

    /// <summary>Creates the recorder.</summary>
    /// <param name="scopes">Creates the record's own DI scope (and so its own <see cref="PulseDbContext"/>).</param>
    /// <param name="logger">Logs a record that could not be written.</param>
    public EngineSteeringLeverRecorder(IServiceScopeFactory scopes, ILogger<EngineSteeringLeverRecorder>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(scopes);
        _scopes = scopes;
        _logger = logger ?? NullLogger<EngineSteeringLeverRecorder>.Instance;
    }

    /// <inheritdoc />
    public async Task RecordAsync(EngineSteeringLeverRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        try
        {
            await using var scope = _scopes.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // org-scope-exempt(ResolvedScope): record.ExerciseId is the SERVER-resolved scope the lever acted on
            // (EngineReviewService.TryResolveScope over IExerciseContext); this reads only that exercise's organization
            // (where the audit row lives), stored scenario instant and zone.
            var facts = await dbContext.Exercises
                .AsNoTracking()
                .Where(e => e.Id == record.ExerciseId)
                .Select(e => new { e.OrganizationId, e.CurrentScenarioTime, e.TimeZone })
                .FirstOrDefaultAsync(CancellationToken.None);
            if (facts is null)
            {
                LogRecordSkipped(record.EventType, record.ExerciseId);
                return;
            }

            // COR-053: the live scenario clock's instant, else the exercise's stored one (StaffChangeRecorder then falls
            // back to the wall clock, the pre-COR-050 placeholder every staff event uses) — never re-derived.
            var exercise = new StaffChangeExercise(
                record.ExerciseId,
                facts.OrganizationId,
                record.ScenarioTime ?? facts.CurrentScenarioTime,
                facts.TimeZone);

            StaffChangeRecorder.Stage(
                dbContext,
                exercise,
                record.Actor,
                new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = record.ExerciseId.ToString() },
                subjectPersonId: null,
                record.EventType,
                record.AuditKind,
                record.Payload,
                record.WallClock);
            await dbContext.SaveChangesAsync(CancellationToken.None);
        }
#pragma warning disable CA1031 // The lever is already applied and live; a record failure must be loud, never fatal.
        catch (Exception exception)
        {
            LogRecordFailed(record.EventType, record.ExerciseId, exception);
        }
#pragma warning restore CA1031
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Steering lever '{EventType}' for exercise {ExerciseId} was APPLIED in memory but its XC-004 event and org audit could not be persisted; the change is live and unaudited.")]
    private partial void LogRecordFailed(string eventType, Guid exerciseId, Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Steering lever '{EventType}' for exercise {ExerciseId} was APPLIED in memory but the exercise row was not found, so it was not recorded.")]
    private partial void LogRecordSkipped(string eventType, Guid exerciseId);
}
