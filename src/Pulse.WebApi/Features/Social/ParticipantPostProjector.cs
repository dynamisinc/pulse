namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>
/// The participant read projection (demo-polish BP; implements the frozen <see cref="IParticipantPostProjector"/>).
/// It turns persisted <see cref="Post"/> rows into the participant-safe <see cref="ParticipantPostDto"/> the feed,
/// the thread and the SignalR <c>PostReceived</c> push all serve: counts are the stored baseline plus real
/// engagement, media carries signed read URLs, a reply carries <c>inReplyTo</c>, and <c>viewer</c> is set only
/// when the caller asks for it with a viewer persona.
/// </summary>
/// <remarks>
/// <para>
/// <b>XC-002.</b> Only participant-safe fields are read into the DTO. The post's provenance
/// (<c>Origin</c>/<c>ActingHumanId</c>/<c>CreatedWallClock</c>/<c>InjectId</c>), its baseline columns (added into
/// <c>counts</c>, never exposed on their own), and the asset's storage and uploader columns (<c>BlobName</c>,
/// <c>ContentType</c>, <c>Bytes</c>, <c>OriginalFileName</c>, <c>UploadedByHumanId</c>) never reach the output.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> Every lookup runs through the central exercise filter, so a media item, asset,
/// poster, parent or author from another exercise cannot join. On top of that, the projector refuses to project
/// a post outside the resolved scope at all, and the signer refuses to mint outside it.
/// </para>
/// <para>
/// <b>Batched (no N+1).</b> One query for media items with their assets and posters, one signer call, one
/// query for reply parents with their authors (skipped when no post is a reply), and one engagement read.
/// </para>
/// </remarks>
public sealed partial class ParticipantPostProjector : IParticipantPostProjector
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IPostEngagementReader _engagementReader;
    private readonly IMediaUrlSigner _mediaUrlSigner;
    private readonly ILogger<ParticipantPostProjector> _logger;

    /// <summary>Creates the projector over the scoped persistence context and its read seams.</summary>
    /// <param name="dbContext">The request-scoped context whose global filter confines every lookup (COR-001).</param>
    /// <param name="exerciseContext">The resolved exercise scope; posts outside it are refused.</param>
    /// <param name="engagementReader">Real engagement counts and viewer state (B3, or the zero fallback).</param>
    /// <param name="mediaUrlSigner">Mints read URLs for in-scope media (BM, or the unconfigured fallback).</param>
    /// <param name="logger">Diagnostics for media the signer returned no URL for; optional.</param>
    public ParticipantPostProjector(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IPostEngagementReader engagementReader,
        IMediaUrlSigner mediaUrlSigner,
        ILogger<ParticipantPostProjector>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(engagementReader);
        ArgumentNullException.ThrowIfNull(mediaUrlSigner);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _engagementReader = engagementReader;
        _mediaUrlSigner = mediaUrlSigner;
        _logger = logger ?? NullLogger<ParticipantPostProjector>.Instance;
    }

    /// <inheritdoc />
    /// <exception cref="ExerciseScopeViolationException">
    /// The scope is unresolved, or a post belongs to another exercise. Projecting it would put out-of-scope
    /// content on a participant payload, so the projector fails closed instead.
    /// </exception>
    public async Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(posts);
        ArgumentNullException.ThrowIfNull(options);

        if (posts.Count == 0)
        {
            return [];
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty || posts.Any(post => post.ExerciseId != scope.Value))
        {
            throw new ExerciseScopeViolationException(
                "A post outside the resolved exercise scope cannot be projected to a participant payload (COR-001).");
        }

        var postIds = posts.Select(post => post.Id).Distinct().ToArray();

        var media = await LoadMediaAsync(postIds, cancellationToken);
        var (urls, signingFailed) = await SignAsync(media, cancellationToken);
        var replyParents = await LoadReplyParentsAsync(posts, cancellationToken);

        // Viewer state is read only when it will be shown, so a broadcast or staff read never asks for it.
        var viewerPersonaId = options.IncludeViewerState ? options.ViewerPersonaId : null;
        var engagement = await _engagementReader.GetAsync(postIds, viewerPersonaId, cancellationToken);

        var mediaByPost = media.ToLookup(row => row.PostId);

        return posts
            .Select(post => Project(post, mediaByPost[post.Id], urls, signingFailed, replyParents, engagement, viewerPersonaId))
            .ToArray();
    }

    /// <summary>
    /// The single participant-safe mapping. Reads only the post's id, author, body, scenario time, baseline
    /// counts (summed into <c>counts</c>) and parent id — never its provenance (XC-002).
    /// </summary>
    private ParticipantPostDto Project(
        Post post,
        IEnumerable<MediaRow> mediaRows,
        IReadOnlyDictionary<Guid, string> urls,
        bool signingFailed,
        IReadOnlyDictionary<Guid, string> replyParentHandles,
        IReadOnlyDictionary<Guid, PostEngagement> engagement,
        Guid? viewerPersonaId)
    {
        var real = engagement.GetValueOrDefault(post.Id);

        var media = mediaRows
            .OrderBy(row => row.Order)
            .Select(row => ToMediaDto(row, urls, logOmissions: !signingFailed))
            .OfType<PostMediaDto>()
            .ToArray();

        PostInReplyToDto? inReplyTo = null;
        if (post.ParentPostId is { } parentId && replyParentHandles.TryGetValue(parentId, out var handle))
        {
            inReplyTo = new PostInReplyToDto(parentId.ToString(), handle);
        }

        return new ParticipantPostDto
        {
            Id = post.Id.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            Text = post.Body,

            // COR-053: the persisted scenario instant, round-trip — never the server clock.
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Counts = new ParticipantPostCounts(
                Reply: post.BaselineReplyCount + (real?.RealReply ?? 0),
                Repost: post.BaselineRepostCount + (real?.RealRepost ?? 0),
                Like: post.BaselineLikeCount + (real?.RealLike ?? 0)),
            Media = media.Length == 0 ? null : media,
            InReplyTo = inReplyTo,
            Viewer = viewerPersonaId is null
                ? null
                : new PostViewerStateDto(real?.ViewerLiked ?? false, real?.ViewerReposted ?? false),
        };
    }

    /// <summary>
    /// Maps one media row to the participant shape: the asset id, kind, URL, alt and display hints only — no
    /// storage or uploader detail. A row whose URL was not minted is dropped rather than served without one, and
    /// a poster with no URL is omitted; both are logged with the asset id (Gate-1 L-4) — unless the whole signing
    /// batch failed, which <see cref="SignAsync"/> already logged ONCE, so one read never writes 1 + N warnings
    /// (Wave 1b Gate-2 L-3).
    /// </summary>
    private PostMediaDto? ToMediaDto(MediaRow row, IReadOnlyDictionary<Guid, string> urls, bool logOmissions)
    {
        if (!urls.TryGetValue(row.Asset.Id, out var url))
        {
            if (logOmissions)
            {
                LogMediaDropped(row.Asset.Id, row.PostId);
            }

            return null;
        }

        string? posterUrl = null;
        if (row.Poster is { } poster && !urls.TryGetValue(poster.Id, out posterUrl) && logOmissions)
        {
            LogPosterOmitted(poster.Id, row.PostId);
        }

        return new PostMediaDto(
            Id: row.Asset.Id.ToString(),
            Kind: row.Asset.Kind,
            Url: url,
            Alt: row.Alt,
            PosterUrl: posterUrl,
            Width: row.Asset.Width,
            Height: row.Asset.Height,
            DurationSec: row.Asset.DurationSec);
    }

    /// <summary>
    /// ONE query: the posts' media items joined to their assets and (left-joined) posters. The item's own poster
    /// override wins over the asset's poster (DP-3). Every table is behind the central exercise filter.
    /// </summary>
    private async Task<List<MediaRow>> LoadMediaAsync(Guid[] postIds, CancellationToken cancellationToken)
    {
        var rows = await (
                from item in _dbContext.PostMediaItems.AsNoTracking()
                where postIds.Contains(item.PostId)
                join asset in _dbContext.MediaAssets.AsNoTracking() on item.MediaAssetId equals asset.Id
                join poster in _dbContext.MediaAssets.AsNoTracking()
                    on item.PosterMediaAssetId ?? asset.PosterMediaAssetId equals (Guid?)poster.Id into posters
                from poster in posters.DefaultIfEmpty()
                select new { item.PostId, item.Order, item.Alt, Asset = asset, Poster = poster })
            .ToListAsync(cancellationToken);

        return rows.ConvertAll(row => new MediaRow(row.PostId, row.Order, row.Alt, row.Asset, row.Poster));
    }

    /// <summary>
    /// One signer call for every asset and poster on the page. The signer is reached ONLY when there is
    /// something to sign, so a host with no media storage and no media never touches it.
    /// </summary>
    /// <remarks>
    /// <b>A signing failure degrades the page, never fails it.</b> A storage hiccup (a delegation-key fetch
    /// that fails or times out, RBAC not yet propagated, an unconfigured provider while media rows exist) must not
    /// blank the whole feed. Such a failure is logged ONCE and answered with an empty URL map, so every item is
    /// dropped by the existing no-URL path (without a per-item log) while the posts themselves are still served. Two
    /// exceptions are NOT absorbed: cancellation, and <see cref="ExerciseScopeViolationException"/> — a scope
    /// mismatch is an isolation signal and must fail closed.
    /// </remarks>
    /// <returns>The minted URLs, and whether the whole batch failed (its per-item omissions are then not re-logged).</returns>
    private async Task<(IReadOnlyDictionary<Guid, string> Urls, bool Failed)> SignAsync(
        List<MediaRow> media, CancellationToken cancellationToken)
    {
        if (media.Count == 0)
        {
            return (new Dictionary<Guid, string>(), false);
        }

        var assets = media
            .Select(row => row.Asset)
            .Concat(media.Where(row => row.Poster is not null).Select(row => row.Poster!))
            .DistinctBy(asset => asset.Id)
            .ToArray();

        try
        {
            return (await _mediaUrlSigner.GetReadUrlsAsync(assets, cancellationToken), false);
        }
#pragma warning disable CA1031 // A storage fault must degrade the page to media-less posts, never fail it.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
        {
            LogSigningFailed(ex, assets.Length);
            return (new Dictionary<Guid, string>(), true);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// ONE query (skipped when no post is a reply): each in-scope parent's author handle, without a leading
    /// <c>@</c>. A parent soft-deleted after the reply was written still resolves, so the reply keeps its
    /// <c>inReplyTo</c>. A parent that is not in scope does not resolve, so no out-of-scope id is ever emitted.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, string>> LoadReplyParentsAsync(
        IReadOnlyCollection<Post> posts, CancellationToken cancellationToken)
    {
        var parentIds = posts
            .Where(post => post.ParentPostId is not null)
            .Select(post => post.ParentPostId!.Value)
            .Distinct()
            .ToArray();

        if (parentIds.Length == 0)
        {
            return new Dictionary<Guid, string>();
        }

        var parents = await (
                from parent in _dbContext.Posts.AsNoTracking()
                where parentIds.Contains(parent.Id)
                join persona in _dbContext.Personas.AsNoTracking() on parent.AuthorPersonaId equals persona.Id into authors
                from author in authors.DefaultIfEmpty()
                select new { parent.Id, Handle = author == null ? null : author.Handle })
            .ToListAsync(cancellationToken);

        return parents.ToDictionary(
            parent => parent.Id,
            parent => (parent.Handle ?? string.Empty).TrimStart('@'));
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "The signer returned no URL for media asset {AssetId} on post {PostId}; the item is dropped from the projection.")]
    private partial void LogMediaDropped(Guid assetId, Guid postId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "The signer returned no URL for poster asset {AssetId} on post {PostId}; posterUrl is omitted.")]
    private partial void LogPosterOmitted(Guid assetId, Guid postId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "Signing {AssetCount} media asset(s) failed; the posts are served without their media.")]
    private partial void LogSigningFailed(Exception exception, int assetCount);

    /// <summary>One media item with its asset and effective poster.</summary>
    private sealed record MediaRow(Guid PostId, int Order, string Alt, MediaAsset Asset, MediaAsset? Poster);
}
