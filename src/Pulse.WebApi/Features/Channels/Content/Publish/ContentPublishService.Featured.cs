namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The featured slot (PRT-004) through the funnel (channels-foundation story 07): feature or unfeature one published item,
/// and the atomic featured reorder (portal FU-8). Separate from the frozen <see cref="IContentPublishService"/> so FC-7
/// stays as F02 shipped it; <see cref="ContentPublishService"/> implements both, so the funnel is still the only writer.
/// </summary>
/// <remarks>
/// Featuring is a staff lever: only a <c>controller</c> or <c>inject</c> caller may use it. It changes no participant
/// field but <c>featured</c>, so it writes no revision and moves no Updated stamp; it bumps <c>version</c> and emits one
/// <c>content_revised</c> event per changed item with <c>payload.action: "feature"</c>, in the same save. There is no
/// FC-5 frame for a featured change, so nothing is broadcast; participant reads pick the order up on their next read.
/// </remarks>
public interface IContentFeaturing
{
    /// <summary>Sets (<paramref name="rank"/> ≥ 1) or clears (null) a published item's featured rank.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="rank">The featured rank, or null to unfeature.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item; a non-published item is a conflict carrying its current state.</returns>
    Task<ContentPublishResult> FeatureAsync(
        Guid id, int? rank, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets one channel's featured order atomically: <paramref name="ids"/> get ranks 1..n in order and every other
    /// featured published item of that channel is unfeatured, in one save. Nothing is applied unless every id is a
    /// published item of the channel in the exercise (unknown → not found, not published → conflict).
    /// </summary>
    /// <param name="ids">The new featured order (empty clears the channel's featured slot).</param>
    /// <param name="channelId">The channel; required when <paramref name="ids"/> is empty, otherwise it must match.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the listed items in their new order.</returns>
    Task<ContentFeatureReorderResult> ReorderFeaturedAsync(
        IReadOnlyList<Guid> ids, string? channelId, ContentCaller caller, CancellationToken cancellationToken = default);
}

/// <summary>The result of <see cref="IContentFeaturing.ReorderFeaturedAsync"/>.</summary>
public sealed record ContentFeatureReorderResult
{
    /// <summary>The outcome (<see cref="ContentPublishOutcome.Held"/> never occurs).</summary>
    public required ContentPublishOutcome Outcome { get; init; }

    /// <summary>The listed items in their new order, on success.</summary>
    public IReadOnlyList<ChannelContentStaffDto> Items { get; init; } = [];

    /// <summary>On a conflict, the current state of the item that blocked the reorder, when it exists.</summary>
    public ChannelContentStaffDto? ConflictItem { get; init; }

    /// <summary>Readable refusal messages.</summary>
    public IReadOnlyList<string> Errors { get; init; } = [];
}

/// <summary>The featured slot half of the funnel (see <see cref="IContentFeaturing"/>).</summary>
public sealed partial class ContentPublishService : IContentFeaturing
{
    /// <summary>The feature action literal (telemetry <c>payload.action</c>); outside the FC-1 table, like delete.</summary>
    public const string FeatureAction = "feature";

    /// <summary>The most ids one reorder may list.</summary>
    public const int MaxFeaturedReorder = 50;

    /// <summary>The refusal for a non-staff caller.</summary>
    public const string FeatureNeedsStaffMessage = "Only staff can change the featured slot.";

    /// <summary>The 404 when a reorder names an id that is not an item in this exercise.</summary>
    public const string ReorderNotFoundMessage = "One or more content items were not found.";

    /// <inheritdoc />
    public async Task<ContentPublishResult> FeatureAsync(
        Guid id, int? rank, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        if (Scope() is not { } exerciseId)
        {
            return NotFound();
        }

        if (WhyFeatureCallerInvalid(caller) is { } callerError)
        {
            return Invalid(callerError);
        }

        if (rank is < 1)
        {
            return Invalid("rank must be 1 or more, or null to unfeature.");
        }

        var item = await _db.ContentItems
            .FirstOrDefaultAsync(candidate => candidate.Id == id && candidate.ExerciseId == exerciseId, cancellationToken);
        if (item is null)
        {
            return NotFound();
        }

        if (item.Status != ChannelVocabulary.StatusPublished)
        {
            return await ConflictAsync(item, ContentTransitions.IllegalMessage(FeatureAction, item.Status));
        }

        if (item.FeaturedRank == rank)
        {
            return await OkAsync(item, warnings: null); // already so: no version bump, no event
        }

        var time = await ClockAsync(exerciseId, cancellationToken);
        item.FeaturedRank = rank;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(FeatureAction, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentFeatureReorderResult> ReorderFeaturedAsync(
        IReadOnlyList<Guid> ids, string? channelId, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ids);
        caller = NormalizeCaller(caller);

        if (Scope() is not { } exerciseId)
        {
            return ReorderRefused(ContentPublishOutcome.NotFound, NotFoundMessage);
        }

        if (WhyFeatureCallerInvalid(caller) is { } callerError)
        {
            return ReorderRefused(ContentPublishOutcome.Invalid, callerError);
        }

        if (ids.Count > MaxFeaturedReorder)
        {
            return ReorderRefused(ContentPublishOutcome.Invalid, $"ids may list at most {MaxFeaturedReorder} items.");
        }

        if (ids.Distinct().Count() != ids.Count)
        {
            return ReorderRefused(ContentPublishOutcome.Invalid, "ids must not repeat an item.");
        }

        var channel = string.IsNullOrWhiteSpace(channelId) ? null : channelId.Trim();
        if (ids.Count == 0 && channel is null)
        {
            return ReorderRefused(ContentPublishOutcome.Invalid, "channel is required to clear the featured slot.");
        }

        var idSet = ids.ToList();
        var listed = await _db.ContentItems
            .Where(candidate => idSet.Contains(candidate.Id) && candidate.ExerciseId == exerciseId)
            .ToListAsync(cancellationToken);
        if (listed.Count != ids.Count)
        {
            return ReorderRefused(ContentPublishOutcome.NotFound, ReorderNotFoundMessage);
        }

        channel ??= listed[0].ChannelId;
        if (listed.Any(item => !string.Equals(item.ChannelId, channel, StringComparison.Ordinal)))
        {
            return ReorderRefused(ContentPublishOutcome.Invalid, $"ids must all be items of the {channel} channel.");
        }

        var byId = listed.ToDictionary(item => item.Id);
        if (ids.Select(id => byId[id]).FirstOrDefault(item => item.Status != ChannelVocabulary.StatusPublished) is { } stale)
        {
            return new ContentFeatureReorderResult
            {
                Outcome = ContentPublishOutcome.Conflict,
                ConflictItem = await _projector.ToStaffAsync(stale, cancellationToken),
                Errors = [ContentTransitions.IllegalMessage(FeatureAction, stale.Status)],
            };
        }

        // Every OTHER featured, published item of the channel leaves the slot: the list is the whole featured order.
        var unlisted = await _db.ContentItems
            .Where(candidate => candidate.ExerciseId == exerciseId
                && candidate.ChannelId == channel
                && candidate.Status == ChannelVocabulary.StatusPublished
                && candidate.FeaturedRank != null
                && !idSet.Contains(candidate.Id))
            .ToListAsync(cancellationToken);

        var changed = new List<ContentItem>();
        for (var index = 0; index < ids.Count; index++)
        {
            var item = byId[ids[index]];
            if (item.FeaturedRank != index + 1)
            {
                item.FeaturedRank = index + 1;
                changed.Add(item);
            }
        }

        foreach (var item in unlisted)
        {
            item.FeaturedRank = null;
            changed.Add(item);
        }

        if (changed.Count > 0)
        {
            var time = await ClockAsync(exerciseId, cancellationToken);
            foreach (var item in changed)
            {
                item.Version++;
                _db.TelemetryEvents.Add(ContentTelemetry.Build(FeatureAction, item, caller, time));
            }

            // One SaveChanges: every rank, version and event commits together or not at all.
            if (await TrySaveAsync(changed[0].Id, cancellationToken) is { } conflict)
            {
                return new ContentFeatureReorderResult
                {
                    Outcome = conflict.Outcome,
                    ConflictItem = conflict.Item,
                    Errors = conflict.Errors,
                };
            }
        }

        var items = new List<ChannelContentStaffDto>(ids.Count);
        foreach (var id in ids)
        {
            items.Add(await _projector.ToStaffAsync(byId[id], CancellationToken.None));
        }

        return new ContentFeatureReorderResult { Outcome = ContentPublishOutcome.Ok, Items = items };
    }

    /// <summary>A valid caller that is staff-attributed (the featured slot is a staff lever).</summary>
    private static string? WhyFeatureCallerInvalid(ContentCaller caller) =>
        WhyCallerInvalid(caller)
        ?? (caller.Origin is ChannelVocabulary.OriginController or ChannelVocabulary.OriginInject
            ? null
            : FeatureNeedsStaffMessage);

    private static ContentFeatureReorderResult ReorderRefused(ContentPublishOutcome outcome, string message) =>
        new() { Outcome = outcome, Errors = [message] };
}
