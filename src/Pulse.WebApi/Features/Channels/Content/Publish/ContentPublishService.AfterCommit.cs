namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

// The post-commit half of the funnel: the participant-safe broadcast, the observers and the optional side effects. Every
// step runs after the state change committed, with CancellationToken.None (a client that disconnects now must not cancel
// the fan-out of a change that already happened), and none of them can fail the call or roll the change back.
public sealed partial class ContentPublishService
{
    /// <summary>The warning when an alert was requested but no <see cref="IAlertRaiser"/> is registered.</summary>
    public const string NoAlertSourceMessage = "An alert was requested, but no alert source is available; none was raised.";

    /// <summary>The warning when an alert could not be raised.</summary>
    public const string AlertFailedMessage = "The alert could not be raised; the item was published without it.";

    /// <summary>The warning when a paired post was requested but no <see cref="IPairedSocialPoster"/> is registered.</summary>
    public const string NoPairedPosterMessage = "A paired Social post was requested, but no paired poster is available; none was made.";

    /// <summary>The warning when the outlet has no paired persona.</summary>
    public const string NoPairedPersonaMessage = "The outlet has no paired Social account; no post was made.";

    /// <summary>The warning when the paired post could not be made.</summary>
    public const string PairedPostFailedMessage = "The paired Social post could not be made; the item was published without it.";

    /// <summary>The warning when the side effects' ids could not be recorded on the item.</summary>
    public const string SideEffectIdsNotRecordedMessage = "The side effects ran, but their ids could not be recorded on the item.";

    private enum ObserverEvent
    {
        Published,
        Revised,
        Retracted,
    }

    private Task BroadcastPublishedAsync(ContentItem item) =>
        BroadcastAsync(item, async () =>
            await _broadcaster.BroadcastContentPublishedAsync(
                item.ExerciseId, await _projector.ToSummaryAsync(item, CancellationToken.None), CancellationToken.None));

    private Task BroadcastRevisedAsync(ContentItem item) =>
        BroadcastAsync(item, async () =>
            await _broadcaster.BroadcastContentRevisedAsync(
                item.ExerciseId, await _projector.ToRevisedAsync(item, CancellationToken.None), CancellationToken.None));

    private Task BroadcastRetractedAsync(ContentItem item, DateTimeOffset retractedScenarioTime) =>
        BroadcastAsync(item, async () =>
            await _broadcaster.BroadcastContentRetractedAsync(
                item.ExerciseId,
                await _projector.ToRetractedAsync(item, retractedScenarioTime, CancellationToken.None),
                CancellationToken.None));

    /// <summary>
    /// One participant-safe frame. Lifecycle routing (no live push to participants after EndEx, #640) is the
    /// broadcaster's, exactly as for posts. A failure is logged: connected clients converge on their next read.
    /// </summary>
    private async Task BroadcastAsync(ContentItem item, Func<Task> send)
    {
        try
        {
            await send();
        }
#pragma warning disable CA1031 // A broadcast fault must never turn a committed change into a failed call.
        catch (Exception ex)
        {
            LogBroadcastFailed(ex, item.Id, item.ExerciseId);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// Tells every observer, through the interface type (the revise/retract members are default no-ops). An observer
    /// that throws is logged and skipped; the rest still run.
    /// </summary>
    private async Task NotifyAsync(ContentItem item, ObserverEvent kind)
    {
        foreach (IContentPublishedObserver observer in _observers)
        {
            try
            {
                var task = kind switch
                {
                    ObserverEvent.Published => observer.OnPublishedAsync(item, CancellationToken.None),
                    ObserverEvent.Revised => observer.OnRevisedAsync(item, CancellationToken.None),
                    _ => observer.OnRetractedAsync(item, CancellationToken.None),
                };
                await task;
            }
#pragma warning disable CA1031 // An observer fault must never fail a change that has already committed.
            catch (Exception ex)
            {
                LogObserverFailed(ex, observer.GetType().Name, item.Id);
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>
    /// The optional side effects of a publish (FC-7): the alert through <see cref="IAlertRaiser"/> and the link card
    /// through <see cref="IPairedSocialPoster"/>, each only when the resolved options ask for it. An absent seam or a
    /// failure is a warning in the result, never a failed publish. The ids that come back are recorded on the item in
    /// a follow-up save that does not bump the version (they are not a state change).
    /// </summary>
    private async Task<IReadOnlyList<string>> RunSideEffectsAsync(ContentItem item, PublishOptions? options, ContentCaller caller)
    {
        var warnings = new List<string>();
        if (options is null)
        {
            return warnings;
        }

        var recorded = false;
        if (options.Alert is { } alert)
        {
            if (_alertRaiser is null)
            {
                warnings.Add(NoAlertSourceMessage);
            }
            else
            {
                try
                {
                    var raised = await _alertRaiser.RaiseAsync(
                        new AlertRaise
                        {
                            Severity = alert.Severity,
                            Headline = string.IsNullOrWhiteSpace(alert.Headline) ? item.Headline : alert.Headline,
                            Href = await _projector.PermalinkAsync(item, CancellationToken.None),
                            SourceChannel = item.ChannelId,
                            SourceContentId = item.Id,
                            ExpiresScenarioTime = alert.ExpiresScenarioTime,
                        },
                        caller,
                        CancellationToken.None);
                    if (Guid.TryParse(raised?.Id, out var alertId))
                    {
                        item.AlertId = alertId;
                        recorded = true;
                    }
                }
#pragma warning disable CA1031 // A side-effect fault must never fail a publish that has already committed.
                catch (Exception ex)
                {
                    LogSideEffectFailed(ex, "alert", item.Id);
                    warnings.Add(AlertFailedMessage);
                }
#pragma warning restore CA1031
            }
        }

        if (options.PairedPost is { } paired)
        {
            if (_pairedPoster is null)
            {
                warnings.Add(NoPairedPosterMessage);
            }
            else
            {
                try
                {
                    var postId = await _pairedPoster.PostLinkCardAsync(item, paired.Text, caller, CancellationToken.None);
                    if (postId is { } id)
                    {
                        item.PairedPostId = id;
                        recorded = true;
                    }
                    else
                    {
                        warnings.Add(NoPairedPersonaMessage);
                    }
                }
#pragma warning disable CA1031 // A side-effect fault must never fail a publish that has already committed.
                catch (Exception ex)
                {
                    LogSideEffectFailed(ex, "paired post", item.Id);
                    warnings.Add(PairedPostFailedMessage);
                }
#pragma warning restore CA1031
            }
        }

        if (recorded)
        {
            try
            {
                await _db.SaveChangesAsync(CancellationToken.None);
            }
#pragma warning disable CA1031 // Recording the ids is best effort; the publish and the side effects already happened.
            catch (Exception ex)
            {
                LogSideEffectFailed(ex, "id recording", item.Id);
                warnings.Add(SideEffectIdsNotRecordedMessage);
            }
#pragma warning restore CA1031
        }

        return warnings;
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Content broadcast failed for item {ItemId} in exercise {ExerciseId}. The change is committed; clients converge on their next read.")]
    private partial void LogBroadcastFailed(Exception exception, Guid itemId, Guid exerciseId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Content observer {Observer} failed for item {ItemId}; the change itself was committed.")]
    private partial void LogObserverFailed(Exception exception, string observer, Guid itemId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "Publish side effect ({SideEffect}) failed for item {ItemId}; the publish itself was committed.")]
    private partial void LogSideEffectFailed(Exception exception, string sideEffect, Guid itemId);

    [LoggerMessage(
        EventId = 4,
        Level = LogLevel.Warning,
        Message = "Staff projection failed for committed item {ItemId}; the result carries no item.")]
    private partial void LogProjectionFailed(Exception exception, Guid itemId);
}
