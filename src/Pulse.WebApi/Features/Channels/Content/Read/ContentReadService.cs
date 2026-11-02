namespace Pulse.WebApi.Features.Channels.Content.Read;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The participant read path of published channel content (channels-foundation story 06, FC-4): the outlet homepage /
/// wire / portal-module list and the permalink read. Read-only: nothing is written and no telemetry is emitted on a GET
/// (views are client-reported by story 15, so a list scan is not a read).
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (XC-001/COR-001).</b> The exercise comes ONLY from the server-resolved <see cref="IExerciseContext"/>; every
/// query runs through the scoped <see cref="PulseDbContext"/> filter (exercise + soft delete). An unresolved scope fails
/// closed (<see cref="ContentReadOutcome.ScopeUnresolved"/>, a 401), never an empty 200.
/// </para>
/// <para>
/// <b>What a participant can see.</b> Lists carry PUBLISHED items only, so a draft or a scheduled/embargoed item can never
/// appear in any list (portal R-P1, press FU-6). The permalink also answers a RETRACTED item, as the XC-010 tombstone. A
/// draft, scheduled, soft-deleted, cross-exercise or unknown item, and any item of a disabled, soft-deleted or unknown
/// outlet, is one <see cref="ContentReadOutcome.NotFound"/>. The channel gate itself (<c>RequireChannelEnabled</c>) is
/// the endpoint's, so a staff preview of a not-yet-enabled channel still works.
/// </para>
/// </remarks>
public sealed class ContentReadService
{
    /// <summary>The page size when <c>limit</c> is omitted.</summary>
    public const int DefaultLimit = 20;

    /// <summary>The largest page; a larger <c>limit</c> is capped to it.</summary>
    public const int MaxLimit = 50;

    private readonly PulseDbContext _db;
    private readonly IExerciseContext _exerciseContext;
    private readonly ParticipantContentProjector _projector;

    /// <summary>Creates the service.</summary>
    /// <param name="db">The scoped context.</param>
    /// <param name="exerciseContext">The request's resolved exercise.</param>
    /// <param name="projector">The participant projector.</param>
    public ContentReadService(PulseDbContext db, IExerciseContext exerciseContext, ParticipantContentProjector projector)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(projector);
        _db = db;
        _exerciseContext = exerciseContext;
        _projector = projector;
    }

    /// <summary><c>GET /api/channels/{channelId}/content</c>: one page of published items.</summary>
    /// <param name="channelId">The content channel (a literal route segment).</param>
    /// <param name="outletSlug">Filter to one outlet and its child outlets (the wire and its org newsrooms), or null.</param>
    /// <param name="category">Filter to one category (an equality match under the database collation), or null.</param>
    /// <param name="featured">Featured items first by rank, then the rest by recency (PRT-004).</param>
    /// <param name="limit">The page size, or null for <see cref="DefaultLimit"/>; capped at <see cref="MaxLimit"/>.</param>
    /// <param name="cursor">The previous page's <c>nextCursor</c>, or null for the first page.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The page, or the fail-closed outcome.</returns>
    public async Task<ContentReadResult<ChannelContentListDto>> ListAsync(
        string channelId,
        string? outletSlug,
        string? category,
        bool featured,
        int? limit,
        string? cursor,
        CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope())
        {
            return ContentReadResult.ScopeUnresolved<ChannelContentListDto>();
        }

        if (!IsContentChannel(channelId))
        {
            return ContentReadResult.NotFound<ChannelContentListDto>();
        }

        var take = limit ?? DefaultLimit;
        if (take < 1)
        {
            return ContentReadResult.Invalid<ChannelContentListDto>("limit must be at least 1.");
        }

        take = Math.Min(take, MaxLimit);

        ContentListCursor? position = null;
        if (!string.IsNullOrEmpty(cursor))
        {
            if (!ContentListCursor.TryDecode(cursor, out var decoded)
                || (decoded.Stage == ContentListStage.Recency) == featured)
            {
                return ContentReadResult.Invalid<ChannelContentListDto>("cursor is not a cursor this list issued.");
            }

            position = decoded;
        }

        var outlets = await ListOutletsAsync(channelId, outletSlug, cancellationToken);
        if (outlets is null)
        {
            return ContentReadResult.NotFound<ChannelContentListDto>();
        }

        var outletIds = outlets.Keys.ToList();
        var query = _db.ContentItems
            .AsNoTracking()
            .Where(item => item.ChannelId == channelId
                && item.Status == ChannelVocabulary.StatusPublished
                && item.PublishedScenarioTime != null
                && outletIds.Contains(item.OutletId));

        var categoryFilter = category?.Trim();
        if (!string.IsNullOrEmpty(categoryFilter))
        {
            query = query.Where(item => item.Category == categoryFilter);
        }

        var (rows, stage) = await ReadPageAsync(query, featured, position, take, cancellationToken);

        var page = rows.Take(take).ToList();
        string? next = rows.Count > take ? NextCursor(page, stage, position) : null;

        return ContentReadResult.Ok<ChannelContentListDto>(new ChannelContentListDto
        {
            Items = await _projector.ToSummariesAsync(page, outlets, cancellationToken),
            NextCursor = next,
        });
    }

    /// <summary>
    /// <c>GET /api/channels/{channelId}/content/{outletSlug}/{contentSlug}</c>: a published item
    /// (<see cref="ChannelContentDto"/>) or a retracted one's tombstone (<see cref="ChannelContentTombstoneDto"/>).
    /// </summary>
    /// <param name="channelId">The content channel (a literal route segment).</param>
    /// <param name="outletSlug">The outlet slug.</param>
    /// <param name="contentSlug">The content slug.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The DTO (as <see cref="object"/>, so it serializes as its runtime shape), or the fail-closed outcome.</returns>
    public async Task<ContentReadResult<object>> GetPermalinkAsync(
        string channelId, string? outletSlug, string? contentSlug, CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope())
        {
            return ContentReadResult.ScopeUnresolved<object>();
        }

        var found = await FindAsync(channelId, outletSlug, contentSlug, cancellationToken);
        if (found is not { } hit)
        {
            return ContentReadResult.NotFound<object>();
        }

        return hit.Item.Status == ChannelVocabulary.StatusRetracted
            ? ContentReadResult.Ok<object>(ParticipantContentProjector.ToTombstone(hit.Item, hit.Outlet))
            : ContentReadResult.Ok<object>(await _projector.ToContentAsync(hit.Item, hit.Outlet, cancellationToken));
    }

    /// <summary>
    /// Finds a participant-visible (published or retracted) item by its permalink segments, with its enabled outlet; null
    /// for anything else. Shared with <see cref="InSimLinkResolver"/>.
    /// </summary>
    /// <param name="channelId">The content channel.</param>
    /// <param name="outletSlug">The outlet slug.</param>
    /// <param name="contentSlug">The content slug.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item and its outlet, or null.</returns>
    internal async Task<(ContentItem Item, Outlet Outlet)?> FindAsync(
        string channelId, string? outletSlug, string? contentSlug, CancellationToken cancellationToken)
    {
        if (!HasResolvedScope()
            || !IsContentChannel(channelId)
            || !ChannelVocabulary.IsSlug(outletSlug)
            || !ChannelVocabulary.IsSlug(contentSlug))
        {
            return null;
        }

        var outlet = await _db.Outlets
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.ChannelId == channelId && o.Slug == outletSlug && o.Enabled, cancellationToken);
        if (outlet is null)
        {
            return null;
        }

        var item = await _db.ContentItems
            .AsNoTracking()
            .FirstOrDefaultAsync(
                i => i.OutletId == outlet.Id
                    && i.ChannelId == channelId
                    && i.Slug == contentSlug
                    && ((i.Status == ChannelVocabulary.StatusPublished && i.PublishedScenarioTime != null)
                        || i.Status == ChannelVocabulary.StatusRetracted),
                cancellationToken);

        return item is null ? null : (item, outlet);
    }

    private static bool IsContentChannel(string? channelId) =>
        channelId is not null && ChannelVocabulary.ContentChannelIds.Contains(channelId, StringComparer.Ordinal);

    private static string NextCursor(List<ContentItem> page, ContentListStage stage, ContentListCursor? previous)
    {
        if (stage == ContentListStage.Featured && page[^1].FeaturedRank is not null)
        {
            var offset = page.Count + (previous is { Stage: ContentListStage.Featured } p ? p.Served : 0);
            return new ContentListCursor(ContentListStage.Featured, 0, offset).Encode();
        }

        var keysetStage = stage == ContentListStage.Recency ? ContentListStage.Recency : ContentListStage.FeaturedRest;
        var last = page[^1].PublishedScenarioTime!.Value;
        // Leaving the featured block: only the non-featured rows at the last instant count toward the keyset's tie offset.
        var servedAtLast = page.Count(item => item.PublishedScenarioTime == last
            && (keysetStage == ContentListStage.Recency || item.FeaturedRank is null));
        if (previous is { } before && before.Stage == keysetStage && before.UtcTicks == last.UtcTicks)
        {
            servedAtLast += before.Served;
        }

        return new ContentListCursor(keysetStage, last.UtcTicks, servedAtLast).Encode();
    }

    private static async Task<(List<ContentItem> Rows, ContentListStage Stage)> ReadPageAsync(
        IQueryable<ContentItem> query,
        bool featured,
        ContentListCursor? position,
        int take,
        CancellationToken cancellationToken)
    {
        // featured=true, first page or still inside the featured block: ONE query over the combined ordering (featured by
        // rank, then everything else newest first, the automatic fallback). The featured block is a short curated list,
        // so the offset stays small.
        if (featured && position is null or { Stage: ContentListStage.Featured })
        {
            var rows = await query
                .OrderBy(item => item.FeaturedRank == null ? 1 : 0)
                .ThenBy(item => item.FeaturedRank)
                .ThenByDescending(item => item.PublishedScenarioTime)
                .ThenBy(item => item.Id)
                .Skip(position?.Served ?? 0)
                .Take(take + 1)
                .ToListAsync(cancellationToken);
            return (rows, ContentListStage.Featured);
        }

        // Keyset on PublishedScenarioTime, newest first; within one instant the database's Id order with the cursor's
        // served-at-instant offset (the AlertReader pattern; Guid comparisons are not translatable). Past the featured
        // block only the non-featured rows remain.
        var stage = featured ? ContentListStage.FeaturedRest : ContentListStage.Recency;
        if (featured)
        {
            query = query.Where(item => item.FeaturedRank == null);
        }

        if (position is { } at)
        {
            var anchor = new DateTimeOffset(at.UtcTicks, TimeSpan.Zero);
            query = query.Where(item => item.PublishedScenarioTime <= anchor);
        }

        var page = await query
            .OrderByDescending(item => item.PublishedScenarioTime)
            .ThenBy(item => item.Id)
            .Skip(position?.Served ?? 0)
            .Take(take + 1)
            .ToListAsync(cancellationToken);
        return (page, stage);
    }

    private bool HasResolvedScope() => _exerciseContext.CurrentExerciseId is { } id && id != Guid.Empty;

    /// <summary>
    /// The enabled outlets a list draws from, by id: the whole channel, or one outlet plus its enabled children (the wire
    /// room and its org newsrooms, PRS-010/012). Null when <paramref name="outletSlug"/> names no enabled outlet.
    /// </summary>
    private async Task<Dictionary<Guid, Outlet>?> ListOutletsAsync(
        string channelId, string? outletSlug, CancellationToken cancellationToken)
    {
        var enabled = await _db.Outlets
            .AsNoTracking()
            .Where(outlet => outlet.ChannelId == channelId && outlet.Enabled)
            .ToListAsync(cancellationToken);

        var slug = outletSlug?.Trim();
        if (string.IsNullOrEmpty(slug))
        {
            return enabled.ToDictionary(outlet => outlet.Id);
        }

        var root = enabled.FirstOrDefault(outlet => string.Equals(outlet.Slug, slug, StringComparison.Ordinal));
        if (root is null)
        {
            return null;
        }

        return enabled
            .Where(outlet => outlet.Id == root.Id || outlet.ParentOutletId == root.Id)
            .ToDictionary(outlet => outlet.Id);
    }
}

/// <summary>What a <see cref="ContentReadService"/> read produced.</summary>
public enum ContentReadOutcome
{
    /// <summary>The value is the answer (200).</summary>
    Ok,

    /// <summary>Unknown or not participant-visible: the ONE indistinguishable 404.</summary>
    NotFound,

    /// <summary>A malformed <c>limit</c> or <c>cursor</c> (400).</summary>
    Invalid,

    /// <summary>No resolved exercise scope (fail closed, 401).</summary>
    ScopeUnresolved,
}

/// <summary>A read outcome and its value or error.</summary>
/// <typeparam name="T">The value type.</typeparam>
/// <param name="Outcome">The outcome.</param>
/// <param name="Value">The value when <see cref="ContentReadOutcome.Ok"/>.</param>
/// <param name="Error">The readable error when <see cref="ContentReadOutcome.Invalid"/>.</param>
public sealed record ContentReadResult<T>(ContentReadOutcome Outcome, T? Value, string? Error)
    where T : class;

/// <summary>Factories for <see cref="ContentReadResult{T}"/> (the <c>OutletResult</c> pattern).</summary>
public static class ContentReadResult
{
    /// <summary>A 200 with <paramref name="value"/>.</summary>
    /// <typeparam name="T">The value type.</typeparam>
    /// <param name="value">The value.</param>
    /// <returns>The result.</returns>
    public static ContentReadResult<T> Ok<T>(T value)
        where T : class => new(ContentReadOutcome.Ok, value, null);

    /// <summary>The one indistinguishable 404.</summary>
    /// <typeparam name="T">The value type.</typeparam>
    /// <returns>The result.</returns>
    public static ContentReadResult<T> NotFound<T>()
        where T : class => new(ContentReadOutcome.NotFound, null, null);

    /// <summary>A 400 with <paramref name="error"/>.</summary>
    /// <typeparam name="T">The value type.</typeparam>
    /// <param name="error">The readable error.</param>
    /// <returns>The result.</returns>
    public static ContentReadResult<T> Invalid<T>(string error)
        where T : class => new(ContentReadOutcome.Invalid, null, error);

    /// <summary>The fail-closed outcome (no resolved scope).</summary>
    /// <typeparam name="T">The value type.</typeparam>
    /// <returns>The result.</returns>
    public static ContentReadResult<T> ScopeUnresolved<T>()
        where T : class => new(ContentReadOutcome.ScopeUnresolved, null, null);
}
