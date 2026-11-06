namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The funnel's two scheduler-only entry points (channels-foundation story 05): publish a DUE scheduled item under the
/// claim the runner discovered, and return a refused one to <c>draft</c>. Only the scheduler calls them; nothing else
/// writes <see cref="ContentItem"/> rows.
/// </summary>
public interface IScheduledContentPublisher
{
    /// <summary>
    /// Publishes scheduled item <paramref name="id"/> exactly like <see cref="IContentPublishService.PublishAsync"/> with
    /// no options (FC-7a replay), but ONLY if it is still <c>scheduled</c>, still due, and still at
    /// <paramref name="expectedVersion"/>; otherwise <see cref="ContentPublishOutcome.Conflict"/> and nothing changes, so a
    /// staff unschedule, edit or reschedule that lands after discovery always wins. The item is stamped at its OWN
    /// scheduled time (COR-051), never before <paramref name="notBefore"/> and never after the current scenario time.
    /// </summary>
    /// <param name="id">The content item id, in the ambient exercise scope.</param>
    /// <param name="expectedVersion">The <c>Version</c> the scheduler saw when it found the item due.</param>
    /// <param name="notBefore">The scenario time the schedule was made at, so a past schedule never back-dates the item; null = no floor.</param>
    /// <param name="caller">The human who scheduled the item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The funnel's outcome.</returns>
    Task<ContentPublishResult> PublishDueAsync(
        Guid id, int expectedVersion, DateTimeOffset? notBefore, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the scheduled item <paramref name="id"/> to <c>draft</c> with <paramref name="reason"/> as its
    /// <c>LastError</c> and ONE <c>content_schedule_failed</c> event, if it is still <c>scheduled</c> at
    /// <paramref name="expectedVersion"/>, so the scheduler never retry-loops on it. Anything else (it was published,
    /// unscheduled or edited meanwhile, or another instance recorded the failure first) changes nothing.
    /// </summary>
    /// <param name="id">The content item id, in the ambient exercise scope.</param>
    /// <param name="expectedVersion">The <c>Version</c> the scheduler saw when it found the item due.</param>
    /// <param name="reason">The funnel's refusal, staff-facing.</param>
    /// <param name="caller">The scheduler's caller (the human who scheduled the item).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when this call recorded the failure.</returns>
    Task<bool> RecordScheduleFailureAsync(
        Guid id, int expectedVersion, string reason, ContentCaller caller, CancellationToken cancellationToken = default);
}

/// <content>The scheduler's entry points (story 05).</content>
public sealed partial class ContentPublishService : IScheduledContentPublisher
{
    /// <summary>The telemetry <c>payload.action</c> for a refused scheduled publish (outside the FC-1 table).</summary>
    public const string ScheduleFailedAction = "schedule_failed";

    /// <summary>The 409 when the item changed after the scheduler found it due (the runner skips it silently).</summary>
    public const string ScheduledClaimLostMessage = "The item is no longer the scheduled, due item the scheduler found.";

    /// <inheritdoc />
    public Task<ContentPublishResult> PublishDueAsync(
        Guid id, int expectedVersion, DateTimeOffset? notBefore, ContentCaller caller, CancellationToken cancellationToken = default) =>
        PublishCoreAsync(id, options: null, caller, new ScheduledClaim(expectedVersion, notBefore), cancellationToken);

    /// <inheritdoc />
    public async Task<bool> RecordScheduleFailureAsync(
        Guid id, int expectedVersion, string reason, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
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

        // The schedule is cleared like an unschedule, so the error keeps the time it was due for (staff reschedule from it).
        var message = item.ScheduledScenarioTime is { } due
            ? $"Scheduled publish for {due.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)} was refused: {reason}"
            : reason;
        var lastError = message.Length > ContentItem.MaxLastErrorLength ? message[..ContentItem.MaxLastErrorLength] : message;
        var time = await ClockAsync(exerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusDraft;
        item.ScheduledScenarioTime = null;
        item.LastError = lastError;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ScheduleFailedAction, item, caller, time, error: lastError));

        return await TrySaveAsync(item.Id, cancellationToken) is null;
    }

    /// <summary>
    /// COR-051: a due item goes live AT its own scheduled time, so a tick after a forward jump (or a restart) never stamps
    /// the jump target; but never before the schedule was made (a past schedule must not back-date it) and never after now.
    /// </summary>
    private static DateTimeOffset ScheduledPublishTime(ContentItem item, ScheduledClaim claim, ContentEventTime time)
    {
        var due = item.ScheduledScenarioTime ?? time.ScenarioTime;
        var stamp = claim.NotBefore is { } floor && floor > due ? floor : due;
        return stamp > time.ScenarioTime ? time.ScenarioTime : stamp;
    }

    /// <summary>The scheduler's claim on a due item: the version it discovered and the back-dating floor.</summary>
    private sealed record ScheduledClaim(int ExpectedVersion, DateTimeOffset? NotBefore);
}
