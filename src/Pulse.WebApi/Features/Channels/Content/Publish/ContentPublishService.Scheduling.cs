namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The funnel's one write for a scheduled publish it refused (channels-foundation story 05): the item goes back to
/// <c>draft</c> with a staff-visible <see cref="ContentItem.LastError"/> and ONE <c>content_schedule_failed</c> event, so
/// the scheduler never retry-loops on it. Only the scheduler calls it; nothing else writes <see cref="ContentItem"/> rows.
/// </summary>
public interface IContentScheduleFailureRecorder
{
    /// <summary>
    /// Returns the scheduled item <paramref name="id"/> to <c>draft</c> with <paramref name="error"/> as its
    /// <c>LastError</c>, if it is still <c>scheduled</c> at <paramref name="expectedVersion"/>. Anything else (it was
    /// published, unscheduled or edited meanwhile, or another instance recorded the failure first) changes nothing.
    /// </summary>
    /// <param name="id">The content item id, in the ambient exercise scope.</param>
    /// <param name="expectedVersion">The <c>Version</c> the scheduler saw when it found the item due.</param>
    /// <param name="error">The funnel's refusal, staff-facing.</param>
    /// <param name="caller">The scheduler's caller (the human who scheduled the item).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when this call recorded the failure.</returns>
    Task<bool> RecordScheduleFailureAsync(
        Guid id, int expectedVersion, string error, ContentCaller caller, CancellationToken cancellationToken = default);
}

/// <content>The scheduled-publish failure write (story 05).</content>
public sealed partial class ContentPublishService : IContentScheduleFailureRecorder
{
    /// <summary>The telemetry <c>payload.action</c> for a refused scheduled publish (outside the FC-1 table).</summary>
    public const string ScheduleFailedAction = "schedule_failed";

    /// <inheritdoc />
    public async Task<bool> RecordScheduleFailureAsync(
        Guid id, int expectedVersion, string error, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(error);
        caller = NormalizeCaller(caller);

        if (Scope() is not { } exerciseId)
        {
            return false;
        }

        // The central filter already scopes this read; the explicit predicate restates it at the call site.
        var item = await _db.ContentItems
            .FirstOrDefaultAsync(candidate => candidate.Id == id && candidate.ExerciseId == exerciseId, cancellationToken);
        if (item is null
            || item.Version != expectedVersion
            || ContentTransitions.TargetOf(ContentTransitions.Unschedule, item.Status) is null)
        {
            return false;
        }

        var lastError = error.Length > ContentItem.MaxLastErrorLength ? error[..ContentItem.MaxLastErrorLength] : error;
        var time = await ClockAsync(exerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusDraft;
        item.ScheduledScenarioTime = null;
        item.LastError = lastError;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ScheduleFailedAction, item, caller, time, error: lastError));

        return await TrySaveAsync(item.Id, cancellationToken) is null;
    }
}
