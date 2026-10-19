namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;

/// <summary>
/// The XC-004 + org-audit record of the three in-memory autonomy steering levers (issue #618): swamped mode on/off,
/// the kill switch and the restore. See <see cref="EngineSteeringLeverRecords"/> for the vocabulary.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only a real change is recorded.</b> A lever that leaves the state as it was (swamped ON while already on, OFF
/// while already off, a kill switch that does not move the posture, a restore with nothing clamped) records nothing —
/// the same rule as <see cref="EngineEventTypes.ProviderChanged"/>. A refused call (400 / 403) records nothing; the one
/// exception is a refused swamped ON that reverts swamped mode which was ALREADY on (Tier-2 M-1 with a lost lead): that
/// is a real ON→OFF change and is recorded as a system <c>lead-lost-revert</c>.
/// </para>
/// <para>
/// <b>Recorded LAST.</b> Each call site sits after every state change of its lever (for the kill switch, after the
/// ambient demotion — AC6), so the record can never skip a safety effect.
/// </para>
/// <para>
/// <b>Attributed to the session person (WR-2).</b> The actor is <see cref="EngineReviewActionInput.Session"/>, which
/// only <c>EngineReviewEndpoints.AttributeToSessionAsync</c> sets, from the server-verified session — never the body
/// <c>actingHumanId</c>. A direct, non-HTTP caller without one records a system actor (no person), never an
/// unverified string.
/// </para>
/// <para>
/// <b>The previous state is read beside the write, not atomically with it.</b> <c>EngineAutonomyState</c> has no
/// compare-and-set for swamped mode or the clamp, so a concurrent lever on the same exercise between the read and the
/// write can make one record's <c>wasOn</c> / <c>fromPosture</c> stale. That is the same window the state itself has
/// (last writer wins); the record still names a real change by a real, verified person.
/// </para>
/// <para>
/// <b>Never fatal.</b> The lever is process memory and is already live, so the record is written by
/// <see cref="IEngineSteeringLeverRecorder"/> in its own scope, and any failure — including one the recorder failed to
/// contain — is logged here and swallowed: an applied lever is never turned into a 500.
/// </para>
/// </remarks>
public sealed partial class EngineReviewService
{
    /// <summary>Records a swamped-mode change (<paramref name="wasOn"/> → <paramref name="isOn"/>); nothing when unchanged.</summary>
    private Task RecordSwampedModeChangeAsync(Guid exerciseId, EngineReviewActionInput input, bool wasOn, bool isOn)
    {
        if (wasOn == isOn)
        {
            return Task.CompletedTask;
        }

        var payload = EngineSteeringLeverRecords.SwampedModePayload(
            EngineSteeringLeverRecords.ControllerReason, wasOn, isOn, EngineSteeringLeverRecords.ScenarioMinuteOrNull(_clock, exerciseId));
        return isOn
            ? RecordSteeringLeverAsync(
                exerciseId, input, EngineSteeringLeverRecords.SwampedModeOnEventType, EngineSteeringLeverRecords.SwampedModeOnAuditKind, payload)
            : RecordSteeringLeverAsync(
                exerciseId, input, EngineSteeringLeverRecords.SwampedModeOffEventType, EngineSteeringLeverRecords.SwampedModeOffAuditKind, payload);
    }

    /// <summary>
    /// Records the Tier-2 M-1 revert of a refused swamped ON — but only when swamped mode was ALREADY on before the
    /// request (the revert then turned an ON exercise OFF). A system action: the revert is the lost lead's consequence,
    /// not the caller's choice. When it was off before, the revert restored it exactly, so nothing is recorded.
    /// </summary>
    private Task RecordSwampedLeadLostRevertAsync(Guid exerciseId, bool wasOn)
    {
        if (!wasOn)
        {
            return Task.CompletedTask;
        }

        var payload = EngineSteeringLeverRecords.SwampedModePayload(
            EngineSteeringLeverRecords.LeadLostRevertReason, wasOn: true, isOn: false, EngineSteeringLeverRecords.ScenarioMinuteOrNull(_clock, exerciseId));
        return RecordSteeringLeverAsync(
            exerciseId,
            new EngineReviewActionInput(null, null),
            EngineSteeringLeverRecords.SwampedModeOffEventType,
            EngineSteeringLeverRecords.SwampedModeOffAuditKind,
            payload);
    }

    /// <summary>Records an engaged kill switch when it moved the safety posture; nothing when the posture is unchanged.</summary>
    private Task RecordKillSwitchEngagedAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        KillSwitchMode mode,
        string fromPosture,
        EngineAutonomyState state)
    {
        var toPosture = EngineSteeringLeverRecords.PostureOf(state);
        if (string.Equals(fromPosture, toPosture, StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }

        var payload = EngineSteeringLeverRecords.KillSwitchPayload(
            mode, fromPosture, toPosture, EngineSteeringLeverRecords.ScenarioMinuteOrNull(_clock, exerciseId));
        return RecordSteeringLeverAsync(
            exerciseId, input, EngineSteeringLeverRecords.KillSwitchEngagedEventType, EngineSteeringLeverRecords.KillSwitchEngagedAuditKind, payload);
    }

    /// <summary>Records a restore that really lifted a clamp (<paramref name="lifted"/>); nothing for the idempotent no-op.</summary>
    private Task RecordAutonomyRestoredAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        bool lifted,
        bool wasStopped,
        EngineAutonomyState state)
    {
        if (!lifted)
        {
            return Task.CompletedTask;
        }

        // A lift implies a clamp was active before it (RestoreFromSafety returns null otherwise).
        var fromPosture = EngineSteeringLeverRecords.PostureOf(wasStopped, safetyClampActive: true);
        var payload = EngineSteeringLeverRecords.RestorePayload(
            fromPosture, EngineSteeringLeverRecords.PostureOf(state), EngineSteeringLeverRecords.ScenarioMinuteOrNull(_clock, exerciseId));
        return RecordSteeringLeverAsync(
            exerciseId, input, EngineSteeringLeverRecords.AutonomyRestoredEventType, EngineSteeringLeverRecords.AutonomyRestoredAuditKind, payload);
    }

    /// <summary>Hands one record to <see cref="IEngineSteeringLeverRecorder"/>; never throws (see the remarks).</summary>
    private async Task RecordSteeringLeverAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        string eventType,
        string auditKind,
        string payload)
    {
        try
        {
            await _steeringLeverRecorder.RecordAsync(new EngineSteeringLeverRecord(
                exerciseId,
                input.Session,
                eventType,
                auditKind,
                payload,
                _clock.CurrentScenarioTime(exerciseId),
                DateTimeOffset.UtcNow));
        }
#pragma warning disable CA1031 // The lever is already applied and live; a record failure must be loud, never fatal.
        catch (Exception exception)
        {
            LogSteeringLeverRecordFailed(eventType, exerciseId, exception);
        }
#pragma warning restore CA1031
    }

    /// <summary>Source-generated Error log for a steering-lever record whose recorder threw.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Steering lever '{EventType}' for exercise {ExerciseId} was APPLIED in memory but recording it failed; the change is live and unaudited.")]
    private partial void LogSteeringLeverRecordFailed(string eventType, Guid exerciseId, Exception exception);

    /// <summary>The recorder used when none is injected (direct, non-DI constructions): records nothing.</summary>
    private sealed class NullSteeringLeverRecorder : IEngineSteeringLeverRecorder
    {
        public static readonly NullSteeringLeverRecorder Instance = new();

        public Task RecordAsync(EngineSteeringLeverRecord record) => Task.CompletedTask;
    }
}
