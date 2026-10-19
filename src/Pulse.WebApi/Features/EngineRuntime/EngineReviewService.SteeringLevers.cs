namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;

/// <summary>
/// The XC-004 + org-audit record of the three in-memory autonomy steering levers (issue #618): swamped mode on/off,
/// the kill switch and the restore. See <see cref="EngineSteeringLeverRecords"/> for the vocabulary.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only a real change is recorded.</b> A lever that leaves the state as it was (swamped ON while already on, OFF
/// while already off, a kill switch that does not move the posture, a restore with nothing clamped) records nothing —
/// the same rule as <see cref="EngineEventTypes.ProviderChanged"/>. A refused call (400 / 403, including the Tier-2
/// M-1 post-write revert) never reaches a record: each call site sits after every refusal.
/// </para>
/// <para>
/// <b>Attributed to the session person (WR-2).</b> The actor is <see cref="EngineReviewActionInput.Session"/>, which
/// only <c>EngineReviewEndpoints.AttributeToSessionAsync</c> sets, from the server-verified session — never the body
/// <c>actingHumanId</c>. A direct, non-HTTP caller without one records a system actor (no person), never an
/// unverified string.
/// </para>
/// <para>
/// <b>Not atomic with the change, and not fatal.</b> The lever is process memory and is already live when the record
/// is written, so — like <c>CommitSettingsEventAsync</c> and the lead-release flip — a failed save is logged and the
/// applied snapshot is still returned; the staged rows are detached so a later save in the same request cannot
/// resurrect them.
/// </para>
/// </remarks>
public sealed partial class EngineReviewService
{
    private const string ExerciseEntityType = "exercise";

    /// <summary>Records a swamped-mode change (<paramref name="wasOn"/> → <paramref name="isOn"/>); nothing when unchanged.</summary>
    private Task RecordSwampedModeChangeAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        bool wasOn,
        bool isOn,
        CancellationToken cancellationToken)
    {
        if (wasOn == isOn)
        {
            return Task.CompletedTask;
        }

        var payload = EngineSteeringLeverRecords.SwampedModePayload(wasOn, isOn, _clock.CurrentScenarioMinute(exerciseId));
        return isOn
            ? RecordSteeringLeverAsync(
                exerciseId, input, EngineSteeringLeverRecords.SwampedModeOnEventType, EngineSteeringLeverRecords.SwampedModeOnAuditKind, payload, cancellationToken)
            : RecordSteeringLeverAsync(
                exerciseId, input, EngineSteeringLeverRecords.SwampedModeOffEventType, EngineSteeringLeverRecords.SwampedModeOffAuditKind, payload, cancellationToken);
    }

    /// <summary>Records an engaged kill switch when it moved the safety posture; nothing when the posture is unchanged.</summary>
    private Task RecordKillSwitchEngagedAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        KillSwitchMode mode,
        string fromPosture,
        EngineAutonomyState state,
        CancellationToken cancellationToken)
    {
        var toPosture = EngineSteeringLeverRecords.PostureOf(state);
        if (string.Equals(fromPosture, toPosture, StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }

        var payload = EngineSteeringLeverRecords.KillSwitchPayload(mode, fromPosture, toPosture, _clock.CurrentScenarioMinute(exerciseId));
        return RecordSteeringLeverAsync(
            exerciseId, input, EngineSteeringLeverRecords.KillSwitchEngagedEventType, EngineSteeringLeverRecords.KillSwitchEngagedAuditKind, payload, cancellationToken);
    }

    /// <summary>Records a restore that really lifted a clamp (<paramref name="lifted"/>); nothing for the idempotent no-op.</summary>
    private Task RecordAutonomyRestoredAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        bool lifted,
        bool wasStopped,
        EngineAutonomyState state,
        CancellationToken cancellationToken)
    {
        if (!lifted)
        {
            return Task.CompletedTask;
        }

        // A lift implies a clamp was active before it (RestoreFromSafety returns null otherwise).
        var fromPosture = EngineSteeringLeverRecords.PostureOf(wasStopped, safetyClampActive: true);
        var payload = EngineSteeringLeverRecords.RestorePayload(
            fromPosture, EngineSteeringLeverRecords.PostureOf(state), _clock.CurrentScenarioMinute(exerciseId));
        return RecordSteeringLeverAsync(
            exerciseId, input, EngineSteeringLeverRecords.AutonomyRestoredEventType, EngineSteeringLeverRecords.AutonomyRestoredAuditKind, payload, cancellationToken);
    }

    /// <summary>
    /// Stages the event + audit through <see cref="StaffChangeRecorder"/> (the lead-release flip's recorder) and saves
    /// them in one <c>SaveChanges</c>. One server clock read is shared by both rows.
    /// </summary>
    private async Task RecordSteeringLeverAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        string eventType,
        string auditKind,
        string payload,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;

        // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope (TryResolveScope over IExerciseContext);
        // this reads only that exercise's organization (where the audit row lives), stored scenario instant and zone.
        var facts = await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => new { e.OrganizationId, e.CurrentScenarioTime, e.TimeZone })
            .FirstOrDefaultAsync(cancellationToken);
        if (facts is null)
        {
            LogSteeringLeverRecordSkipped(eventType, exerciseId);
            return;
        }

        // COR-053: the live scenario clock's instant, else the exercise's stored one (StaffChangeRecorder then falls
        // back to the wall clock, the pre-COR-050 placeholder) — never re-derived.
        var exercise = new StaffChangeExercise(
            exerciseId,
            facts.OrganizationId,
            _clock.CurrentScenarioTime(exerciseId) ?? facts.CurrentScenarioTime,
            facts.TimeZone);

        StaffChangeRecorder.Stage(
            _dbContext,
            exercise,
            input.Session,
            new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exerciseId.ToString() },
            subjectPersonId: null,
            eventType,
            auditKind,
            payload,
            now);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            DetachStagedRecords();
            throw;
        }
#pragma warning disable CA1031 // The lever is already applied and live; a record-persist failure must be loud, not fatal.
        catch (Exception ex)
        {
            DetachStagedRecords();
            LogSteeringLeverRecordFailed(eventType, exerciseId, ex);
        }
#pragma warning restore CA1031
    }

    /// <summary>Detaches the still-Added event + audit rows of a failed record save so no later save writes them.</summary>
    private void DetachStagedRecords()
    {
        foreach (var entry in _dbContext.ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added && e.Entity is TelemetryEvent or OrgAuditEvent)
            .ToList())
        {
            entry.State = EntityState.Detached;
        }
    }

    /// <summary>Source-generated Error log for a steering-lever record that could not be persisted.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Steering lever '{EventType}' for exercise {ExerciseId} was APPLIED in memory but its XC-004 event and org audit could not be persisted; the change is live and unaudited.")]
    private partial void LogSteeringLeverRecordFailed(string eventType, Guid exerciseId, Exception exception);

    /// <summary>Source-generated Error log for a steering-lever record skipped because the exercise row was not found.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Steering lever '{EventType}' for exercise {ExerciseId} was APPLIED in memory but the exercise row was not found, so it was not recorded.")]
    private partial void LogSteeringLeverRecordSkipped(string eventType, Guid exerciseId);
}
