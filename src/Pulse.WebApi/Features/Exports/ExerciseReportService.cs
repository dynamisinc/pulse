namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>The outcome kind of an <see cref="ExerciseReportService"/> call.</summary>
public enum ExerciseReportOutcome
{
    /// <summary>The report was built; the endpoint returns 200 with it.</summary>
    Ok,

    /// <summary>No exercise scope was resolved; the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no exercise row; the endpoint returns 404.</summary>
    NotFound,

    /// <summary>The exercise has more than <see cref="ExerciseReportService.MaxExercisePosts"/> posts; the endpoint returns 413.</summary>
    TooManyPosts,
}

/// <summary>The result of <see cref="ExerciseReportService.BuildAsync"/>.</summary>
public sealed class ExerciseReportResult
{
    private ExerciseReportResult(ExerciseReportOutcome outcome, ExerciseReportDto? report, string? reason)
    {
        Outcome = outcome;
        Report = report;
        Reason = reason;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseReportOutcome Outcome { get; }

    /// <summary>The report; non-null only for <see cref="ExerciseReportOutcome.Ok"/>.</summary>
    public ExerciseReportDto? Report { get; }

    /// <summary>The readable reason for <see cref="ExerciseReportOutcome.TooManyPosts"/>.</summary>
    public string? Reason { get; }

    /// <summary>A built report.</summary>
    /// <param name="report">The report.</param>
    /// <returns>An OK result.</returns>
    public static ExerciseReportResult Ok(ExerciseReportDto report) => new(ExerciseReportOutcome.Ok, report, null);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ExerciseReportResult ScopeUnresolved() => new(ExerciseReportOutcome.ScopeUnresolved, null, null);

    /// <summary>A resolved scope with no exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static ExerciseReportResult NotFound() => new(ExerciseReportOutcome.NotFound, null, null);

    /// <summary>Too many posts to list; nothing was built.</summary>
    /// <param name="reason">The readable reason.</param>
    /// <returns>A too-many-posts result.</returns>
    public static ExerciseReportResult TooManyPosts(string reason) => new(ExerciseReportOutcome.TooManyPosts, null, reason);
}

/// <summary>
/// Builds the printable exercise report (demo-feedback story 29, DF-40..DF-42): header, summary, 5-minute activity
/// bins, inject response times, verified-vs-lookalike pairs and the post record for the resolved exercise. Staff world
/// only; the endpoint's staff gate admits any role assigned to the exercise. Scoped lifetime, matching the request's
/// <see cref="PulseDbContext"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, XC-001).</b> Exactly as <see cref="PostExportService"/>: the exercise comes only from
/// <see cref="IExerciseContext"/>, an unresolved scope fails closed before any read, every content table (posts,
/// personas, accounts, media, reactions, inject items) is read through its scoped set, and the two unscoped tables are
/// bounded explicitly (<see cref="StaffAssignment"/> by the exercise id, <see cref="StaffUser"/> by the exercise's own
/// tenant). A parent, author, acting human or inject that does not resolve inside the exercise is left blank. The
/// signer refuses to mint a URL outside the scope (and that refusal is never absorbed).
/// </para>
/// <para>
/// <b>Noise (DF-41).</b> Noise posts are always read for the metrics and the chart; their text and media are read only
/// when noise is a selected source.
/// </para>
/// <para>
/// <b>Filters and limits (story 30, DF-43/DF-44).</b> The summary, activity, inject responses and lookalikes are built
/// over every post whatever the <see cref="ExerciseReportFilter"/> is; the filter narrows only the post record. When
/// more than <see cref="MaxListedPosts"/> posts match, the record is withheld (empty, never truncated) and the rest of
/// the report is still built. Only an exercise of more than <see cref="MaxExercisePosts"/> posts is refused (413),
/// by a count before any row is read.
/// </para>
/// <para>
/// <b>Media.</b> Images carry a signed URL; videos carry their poster (the item's override, else the asset's) as a
/// signed URL, or <c>null</c>. A signing failure (a storage fault) degrades the report to <c>null</c> URLs, logged
/// once, as <c>ParticipantPostProjector</c> degrades the feed; cancellation and
/// <see cref="ExerciseScopeViolationException"/> are not absorbed.
/// </para>
/// <para>
/// <b>Counts.</b> Shown counts (baseline + real), via the concrete <see cref="PostEngagementReader"/> (see
/// <see cref="PostExportService"/> on the interface's zero-count fallback).
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> One <c>export.report.viewed</c> event per built report, actor the staff human, payload
/// <c>{ posts }</c> (the listed post count, 0 when the record is withheld) only.
/// </para>
/// </remarks>
public sealed partial class ExerciseReportService
{
    /// <summary>The most posts one report's record lists; above it the record is withheld (DF-43).</summary>
    public const int MaxListedPosts = 5_000;

    /// <summary>The most posts in the exercise one report reads; above it the request is refused with 413 (DF-43).</summary>
    public const int MaxExercisePosts = 50_000;

    /// <summary>The XC-004 event type.</summary>
    public const string ViewedEventType = "export.report.viewed";

    /// <summary>Ids per <c>Contains</c> read (EF Core 10 expands a parameter collection into scalar parameters).</summary>
    private const int IdChunk = 500;

    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string TimeOfDayFormat = "HH:mm";
    private const string DateFormat = "yyyy-MM-dd";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly PostEngagementReader _engagementReader;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly IMediaUrlSigner _mediaUrlSigner;
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClock? _exerciseClock;
    private readonly ILogger<ExerciseReportService> _logger;
    private readonly ExerciseReportLimits _limits;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request's persistence context.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the only source of "which exercise".</param>
    /// <param name="engagementReader">The real like/repost/reply counts.</param>
    /// <param name="exerciseFacts">The exercise's name, time zone, tenant and stored scenario time.</param>
    /// <param name="currentStaffSession">The acting staff human, for the telemetry actor.</param>
    /// <param name="mediaUrlSigner">Mints read URLs for in-scope media.</param>
    /// <param name="timeProvider">The server clock (prepared-at, shown in the exercise zone, and telemetry wall clock).</param>
    /// <param name="exerciseClock">The live scenario clock, when the host runs one (telemetry scenario time).</param>
    /// <param name="logger">Diagnostics for a failed signing batch; optional.</param>
    /// <param name="limits">The size limits; <see cref="ExerciseReportLimits.Default"/> unless a host registers others.</param>
    public ExerciseReportService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        PostEngagementReader engagementReader,
        ExerciseFactsReader exerciseFacts,
        ICurrentStaffSessionAccessor currentStaffSession,
        IMediaUrlSigner mediaUrlSigner,
        TimeProvider timeProvider,
        IExerciseClock? exerciseClock = null,
        ILogger<ExerciseReportService>? logger = null,
        ExerciseReportLimits? limits = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(engagementReader);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(mediaUrlSigner);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _engagementReader = engagementReader;
        _exerciseFacts = exerciseFacts;
        _currentStaffSession = currentStaffSession;
        _mediaUrlSigner = mediaUrlSigner;
        _timeProvider = timeProvider;
        _exerciseClock = exerciseClock;
        _logger = logger ?? NullLogger<ExerciseReportService>.Instance;
        _limits = limits ?? ExerciseReportLimits.Default;
    }

    /// <summary>Builds the report for the resolved exercise and records one viewed event.</summary>
    /// <param name="filter">The post record's filters (noise is always counted in the metrics, DF-41).</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<ExerciseReportResult> BuildAsync(ExerciseReportFilter filter, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return ExerciseReportResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return ExerciseReportResult.NotFound();
        }

        // 1. Refuse an oversize exercise before reading any rows.
        var includeNoise = filter.IncludesNoise;
        var exerciseCount = await _dbContext.Posts.AsNoTracking().CountAsync(cancellationToken);
        if (exerciseCount > _limits.MaxExercisePosts)
        {
            return ExerciseReportResult.TooManyPosts(TooManyPostsReason(exerciseCount));
        }

        // 2. Every post (noise included, for the metrics); noise text only when noise is a selected source.
        var posts = await _dbContext.Posts
            .AsNoTracking()
            .OrderBy(post => post.CreatedScenarioTime)
            .ThenBy(post => post.CreatedWallClock)
            .ThenBy(post => post.Id)
            .Select(post => new PostRow(
                post.Id,
                post.AuthorPersonaId,
                includeNoise || post.Origin != PostExportLabels.NoiseOrigin ? post.Body : null,
                post.CreatedScenarioTime,
                post.CreatedWallClock,
                post.Origin,
                post.ActingHumanId,
                post.InjectId,
                post.ParentPostId,
                post.DeletedAt,
                post.BaselineLikeCount,
                post.BaselineRepostCount,
                post.BaselineReplyCount,
                post.PinnedForAllAt,
                post.EditCount,
                post.LastEditedScenarioTime))
            .ToListAsync(cancellationToken);

        // Posts keep arriving between the count and this read, so the ceiling is checked again on what was read.
        if (posts.Count > _limits.MaxExercisePosts)
        {
            return ExerciseReportResult.TooManyPosts(TooManyPostsReason(posts.Count));
        }

        // 3. The record: the filtered posts, withheld whole (never truncated) above the limit (DF-43).
        var zone = ExerciseDay.ResolveTimeZone(facts.TimeZone);
        var matching = posts.Where(post => filter.Matches(post.Origin, post.CreatedScenarioTime, zone)).ToList();
        var withheld = matching.Count > _limits.MaxListedPosts;
        List<PostRow> listed = withheld ? [] : matching;

        var postFacts = posts.ConvertAll(post => new ReportPostFact(
            post.Id, post.AuthorPersonaId, post.Origin, post.CreatedScenarioTime, post.CreatedWallClock, post.ParentPostId, post.Body));

        // 4. The small per-exercise lookups.
        var lookups = await ReadLookupsAsync(exerciseId, facts.OrganizationId, cancellationToken);

        // 5. Lookalikes: decided before engagement, so only the paired personas' posts need counts beyond the list.
        var authorIds = posts.Select(post => post.AuthorPersonaId).ToHashSet();
        var pairs = ExerciseReportBuilder.PairLookalikes(
            lookups.Personas.Values
                .Where(persona => authorIds.Contains(persona.Id))
                .Select(persona => new ReportLookalikeCandidate(persona.Id, persona.Handle, persona.Verified)));
        var pairedPersonas = pairs.SelectMany(pair => new[] { pair.Verified.Id, pair.Lookalike.Id }).ToHashSet();

        var engagementIds = listed.Select(post => post.Id)
            .Concat(posts.Where(post => pairedPersonas.Contains(post.AuthorPersonaId)).Select(post => post.Id))
            .Distinct()
            .ToArray();
        var engagement = await ReadEngagementAsync(engagementIds, cancellationToken);

        // 6. Media for the listed posts, avatars for their authors, signed in one batch.
        var media = await ReadMediaAsync(listed.Select(post => post.Id).ToHashSet(), includeNoise, cancellationToken);
        var listedAuthorIds = listed.Select(post => post.AuthorPersonaId).ToHashSet();
        var avatars = await ReadAvatarsAsync(listedAuthorIds, cancellationToken);
        var urls = await SignAsync(media, avatars.Values, cancellationToken);

        // 7. Assemble.
        var chartBinMinutes = ExerciseReportBuilder.ChartBinMinutes(postFacts);
        var bins = ExerciseReportBuilder.BuildBins(postFacts, chartBinMinutes);
        var (responses, markers, medianMinutes) = BuildInjects(posts, postFacts, lookups, bins, chartBinMinutes, zone);
        var busiest = ExerciseReportBuilder.BusiestFiveMinutes(postFacts);
        var now = _timeProvider.GetUtcNow();

        var report = new ExerciseReportDto
        {
            Exercise = new ReportExerciseDto
            {
                Name = facts.Name,
                TimeZone = string.IsNullOrWhiteSpace(facts.TimeZone) ? ExerciseDay.UtcZoneId : facts.TimeZone,
                ScenarioStart = posts.Count == 0 ? null : FormatAt(posts.Min(post => post.CreatedScenarioTime), zone),
                ScenarioEnd = posts.Count == 0 ? null : FormatAt(posts.Max(post => post.CreatedScenarioTime), zone),
                ConductedDate = posts.Count == 0
                    ? null
                    : TimeZoneInfo.ConvertTime(posts.Min(post => post.CreatedScenarioTime), zone).ToString(DateFormat, CultureInfo.InvariantCulture),
                PreparedAt = FormatAt(now, zone),
            },
            Summary = new ReportSummaryDto
            {
                Participants = lookups.SignedInParticipants,
                Posts = posts.Count,
                Replies = posts.Count(post => post.ParentPostId is not null),
                InjectsDelivered = responses.Count,
                MedianResponseMinutes = medianMinutes,
                BusiestWindow = busiest is null
                    ? null
                    : new ReportBusiestWindowDto { Start = FormatAt(busiest.Start, zone), Posts = busiest.Total },
                PostsEdited = posts.Count(post => post.EditCount > 0),
                PostsTakenDown = posts.Count(post => post.DeletedAt is not null),
                BySource = new ReportSourceCountsDto
                {
                    Participant = posts.Count(post => ExerciseReportBuilder.Series(post.Origin) == ReportSeries.Participant),
                    Scripted = posts.Count(post => ExerciseReportBuilder.Series(post.Origin) == ReportSeries.Scripted),
                    Engine = posts.Count(post => ExerciseReportBuilder.Series(post.Origin) == ReportSeries.Engine),
                    Noise = posts.Count(post => ExerciseReportBuilder.Series(post.Origin) == ReportSeries.Noise),
                },
            },
            Activity = new ReportActivityDto
            {
                BinMinutes = chartBinMinutes,
                Bins = bins.Select(bin => new ReportActivityBinDto
                {
                    Start = FormatAt(bin.Start, zone),
                    Participant = bin.Participant,
                    Scripted = bin.Scripted,
                    Engine = bin.Engine,
                    Noise = bin.Noise,
                }).ToArray(),
                InjectMarkers = markers,
            },
            InjectResponses = responses,
            Lookalikes = pairs.Select(pair => new ReportLookalikeDto
            {
                Verified = ToAccount(pair.Verified.Id, posts, lookups, engagement),
                Lookalike = ToAccount(pair.Lookalike.Id, posts, lookups, engagement),
            }).ToArray(),
            Posts = BuildPosts(posts, listed, lookups, engagement, media, avatars, urls, zone),
            OmittedNoiseCount = includeNoise ? 0 : posts.Count(post => ExerciseReportBuilder.IsNoise(post.Origin)),
            PostRecord = new ReportPostRecordDto
            {
                Matching = matching.Count,
                Limit = _limits.MaxListedPosts,
                Withheld = withheld,
                Sources = filter.Sources,
                From = ExerciseReportFilter.Format(filter.From),
                To = ExerciseReportFilter.Format(filter.To),
            },
        };

        // 8. One XC-004 event, stamped from the same clock read as preparedAt.
        var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        _dbContext.TelemetryEvents.Add(BuildViewedEvent(exerciseId, facts, staff, lookups, listed.Count, now));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ExerciseReportResult.Ok(report);
    }

    private string TooManyPostsReason(int count) =>
        $"This exercise has {count.ToString("N0", CultureInfo.InvariantCulture)} posts, more than one report can read "
        + $"({_limits.MaxExercisePosts.ToString("N0", CultureInfo.InvariantCulture)}). Nothing was built.";

    private static string FormatAt(DateTimeOffset instant, TimeZoneInfo zone) =>
        PostExportLabels.ScenarioTime(instant, zone);

    private static string FormatTime(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(instant, zone).ToString(TimeOfDayFormat, CultureInfo.InvariantCulture);

    private static (IReadOnlyList<ReportInjectResponseDto> Responses, IReadOnlyList<ReportInjectMarkerDto> Markers, double? Median) BuildInjects(
        List<PostRow> posts,
        List<ReportPostFact> facts,
        ReportLookups lookups,
        IReadOnlyList<ReportActivityBin> bins,
        int binMinutes,
        TimeZoneInfo zone)
    {
        // An inject's posts are those whose InjectId names the item (InjectPostRequestFactory writes item.Id) AND whose
        // origin is the server-stamped "inject": InjectId is accepted on ordinary posts too, so a participant or
        // controller post naming a fired item must not move its delivery time or add its author to the @mention rule.
        var postsByInject = new Dictionary<Guid, List<PostRow>>();
        foreach (var post in posts)
        {
            if (string.Equals(post.Origin, ExerciseReportBuilder.InjectOrigin, StringComparison.Ordinal)
                && Guid.TryParse(post.InjectId, out var itemId) && lookups.Injects.TryGetValue(itemId, out var item) && item.Delivered)
            {
                if (!postsByInject.TryGetValue(itemId, out var list))
                {
                    list = [];
                    postsByInject[itemId] = list;
                }

                list.Add(post);
            }
        }

        var binsStart = bins.Count == 0 ? (DateTimeOffset?)null : bins[0].Start;
        var delivered = postsByInject
            .Select(entry => new
            {
                Item = lookups.Injects[entry.Key],
                Posts = entry.Value,
                First = entry.Value.Min(post => post.CreatedScenarioTime),
            })
            .OrderBy(entry => entry.First)
            .ThenBy(entry => entry.Item.Ref, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var responses = new List<ReportInjectResponseDto>(delivered.Length);
        var markers = new List<ReportInjectMarkerDto>(delivered.Length);
        var minutes = new List<double>();

        foreach (var entry in delivered)
        {
            var postIds = entry.Posts.Select(post => post.Id).ToHashSet();
            var handles = entry.Posts
                .Select(post => lookups.Personas.GetValueOrDefault(post.AuthorPersonaId)?.Handle)
                .OfType<string>()
                .ToArray();

            var response = ExerciseReportBuilder.FirstResponse(entry.First, postIds, handles, facts);
            double? responseMinutes = null;
            string? respondedAs = null;
            if (response is not null)
            {
                responseMinutes = ExerciseReportBuilder.ResponseMinutes(entry.First, response.ScenarioTime);
                minutes.Add(responseMinutes.Value);
                var handle = PostExportLabels.Handle(lookups.Personas.GetValueOrDefault(response.AuthorPersonaId)?.Handle);
                respondedAs = handle.Length == 0 ? null : handle;
            }

            responses.Add(new ReportInjectResponseDto
            {
                Ref = entry.Item.Ref,
                Title = entry.Item.Title,
                DeliveredAt = FormatAt(entry.First, zone),
                FirstResponseAt = response is null ? null : FormatAt(response.ScenarioTime, zone),
                ResponseMinutes = responseMinutes,
                RespondedAsHandle = respondedAs,
            });

            if (binsStart is { } start)
            {
                var index = ExerciseReportBuilder.BinIndex(start, entry.First, binMinutes);
                if (index >= 0 && index < bins.Count)
                {
                    markers.Add(new ReportInjectMarkerDto
                    {
                        Ref = entry.Item.Ref,
                        Title = entry.Item.Title,
                        At = FormatAt(entry.First, zone),
                        BinIndex = (int)index,
                    });
                }
            }
        }

        return (responses, markers, ExerciseReportBuilder.Median(minutes));
    }

    private static ReportAccountDto ToAccount(
        Guid personaId,
        List<PostRow> posts,
        ReportLookups lookups,
        IReadOnlyDictionary<Guid, PostEngagement> engagement)
    {
        var persona = lookups.Personas[personaId];
        var authored = posts.Where(post => post.AuthorPersonaId == personaId).ToList();
        var likes = ExerciseReportBuilder.SumShown(authored.Select(post =>
            (post.BaselineLikeCount, engagement.GetValueOrDefault(post.Id)?.RealLike ?? 0)));
        var reposts = ExerciseReportBuilder.SumShown(authored.Select(post =>
            (post.BaselineRepostCount, engagement.GetValueOrDefault(post.Id)?.RealRepost ?? 0)));

        return new ReportAccountDto
        {
            Handle = PostExportLabels.Handle(persona.Handle),
            DisplayName = persona.DisplayName,
            Verified = persona.Verified,
            Likes = likes,
            Reposts = reposts,
        };
    }

    private static ReportPostDto[] BuildPosts(
        List<PostRow> allPosts,
        List<PostRow> listed,
        ReportLookups lookups,
        IReadOnlyDictionary<Guid, PostEngagement> engagement,
        ILookup<Guid, MediaRow> media,
        IReadOnlyDictionary<Guid, MediaAsset> avatars,
        IReadOnlyDictionary<Guid, string> urls,
        TimeZoneInfo zone)
    {
        // Parents resolve only when they are in this exercise: the full post list was read through the scoped set.
        var authorOf = allPosts.ToDictionary(post => post.Id, post => post.AuthorPersonaId);

        return listed.Select(post =>
        {
            var author = lookups.Personas.GetValueOrDefault(post.AuthorPersonaId);
            var real = engagement.GetValueOrDefault(post.Id);

            string? parentId = null;
            string? replyToHandle = null;
            if (post.ParentPostId is { } parent && authorOf.TryGetValue(parent, out var parentAuthorId))
            {
                parentId = parent.ToString();
                var handle = PostExportLabels.Handle(lookups.Personas.GetValueOrDefault(parentAuthorId)?.Handle);
                replyToHandle = handle.Length == 0 ? null : handle;
            }

            string? avatarUrl = null;
            if (author is not null && avatars.TryGetValue(author.Id, out var avatar))
            {
                avatarUrl = urls.GetValueOrDefault(avatar.Id);
            }

            return new ReportPostDto
            {
                Id = post.Id.ToString(),
                ScenarioAt = FormatAt(post.CreatedScenarioTime, zone),
                ScenarioTime = FormatTime(post.CreatedScenarioTime, zone),
                Author = new ReportAuthorDto
                {
                    Handle = PostExportLabels.Handle(author?.Handle),
                    DisplayName = author?.DisplayName ?? string.Empty,
                    Verified = author?.Verified ?? false,
                    AvatarUrl = avatarUrl,
                },
                Source = ExerciseReportBuilder.Source(post.Origin),
                PostedBy = ResolvePostedBy(post, lookups),
                InjectRef = ResolveInjectRef(post.InjectId, lookups),
                ReplyToHandle = replyToHandle,
                ParentPostId = parentId,
                Text = post.Body ?? string.Empty,
                Media = media[post.Id].OrderBy(row => row.Order).Select(row => ToMedia(row, urls)).ToArray(),
                Likes = post.BaselineLikeCount + (real?.RealLike ?? 0),
                Reposts = post.BaselineRepostCount + (real?.RealRepost ?? 0),
                Replies = post.BaselineReplyCount + (real?.RealReply ?? 0),
                PinnedForAll = post.PinnedForAllAt is not null,
                TakenDownAt = post.DeletedAt is { } deletedAt ? FormatAt(deletedAt, zone) : null,
                EditCount = post.EditCount,
                LastEditedAt = post.EditCount > 0 && post.LastEditedScenarioTime is { } editedAt ? FormatAt(editedAt, zone) : null,
            };
        }).ToArray();
    }

    private static ReportMediaDto ToMedia(MediaRow row, IReadOnlyDictionary<Guid, string> urls)
    {
        var isVideo = string.Equals(row.Asset.Kind, MediaKinds.Video, StringComparison.Ordinal);
        var url = isVideo
            ? row.Poster is { } poster ? urls.GetValueOrDefault(poster.Id) : null
            : urls.GetValueOrDefault(row.Asset.Id);

        return new ReportMediaDto
        {
            Kind = isVideo ? MediaKinds.Video : MediaKinds.Image,
            Url = url,
            Alt = row.Alt,
            DurationSec = isVideo ? row.Asset.DurationSec : null,
            Width = row.Asset.Width,
            Height = row.Asset.Height,
        };
    }

    private static string? ResolvePostedBy(PostRow post, ReportLookups lookups)
    {
        if (PostExportLabels.HasNoActingHuman(post.Origin) || string.IsNullOrWhiteSpace(post.ActingHumanId))
        {
            return null;
        }

        var name = lookups.Humans.GetValueOrDefault(post.ActingHumanId);
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    /// <summary>
    /// As <see cref="PostExportService"/>: a GUID names an inject item, resolved only inside this exercise (deleted
    /// items included); a non-GUID inject id is written raw.
    /// </summary>
    private static string? ResolveInjectRef(string? injectId, ReportLookups lookups)
    {
        if (string.IsNullOrWhiteSpace(injectId))
        {
            return null;
        }

        if (!Guid.TryParse(injectId, out var itemId))
        {
            return injectId;
        }

        return lookups.Injects.TryGetValue(itemId, out var item) ? item.Ref : null;
    }

    private async Task<ReportLookups> ReadLookupsAsync(Guid exerciseId, Guid organizationId, CancellationToken cancellationToken)
    {
        var personas = await _dbContext.Personas
            .AsNoTracking()
            .Select(persona => new PersonaLabel(persona.Id, persona.Handle, persona.DisplayName, persona.Verified, persona.AvatarMediaId))
            .ToDictionaryAsync(persona => persona.Id, cancellationToken);

        // StaffAssignment is deliberately unscoped (a staff human spans exercises), so the exercise predicate is
        // explicit; StaffUser is bounded by the exercise's own tenant. Same join as PostExportService.
        var staff = await (
            from assignment in _dbContext.StaffAssignments.AsNoTracking()
            where assignment.ExerciseId == exerciseId
            join staffUser in _dbContext.StaffUsers.AsNoTracking().InOrganization(organizationId)
                on assignment.StaffUserId equals staffUser.Id
            select new { staffUser.Id, staffUser.DisplayName, assignment.Role }).ToListAsync(cancellationToken);

        var accounts = await _dbContext.Accounts
            .AsNoTracking()
            .Select(account => new { account.Id, account.ActingHumanId, account.DisplayName, account.Role, account.LastLoginAt })
            .ToListAsync(cancellationToken);

        var humans = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var account in accounts)
        {
            humans.TryAdd(account.Id.ToString(), account.DisplayName);
            if (!string.IsNullOrWhiteSpace(account.ActingHumanId))
            {
                humans.TryAdd(account.ActingHumanId, account.DisplayName);
            }
        }

        var staffRoles = new Dictionary<Guid, string>();
        foreach (var member in staff)
        {
            humans[member.Id.ToString()] = member.DisplayName;
            staffRoles.TryAdd(member.Id, member.Role);
        }

        // Participant-world roles (participant, and pio: a participant bound to an org persona) that signed in.
        var signedIn = accounts.Count(account => RosterRoles.IsRosterRole(account.Role) && account.LastLoginAt is not null);

        var injects = await _dbContext.InjectItems
            .AsNoTracking()
            .Select(item => new { item.Id, item.Title, item.ExternalRef, item.FiredScenarioTime, item.DeletedAt })
            .ToDictionaryAsync(
                item => item.Id,
                item => new InjectLabel(
                    string.IsNullOrWhiteSpace(item.ExternalRef) ? item.Title : item.ExternalRef,
                    item.Title,
                    item.FiredScenarioTime is not null && item.DeletedAt is null),
                cancellationToken);

        return new ReportLookups(personas, humans, staffRoles, injects, signedIn);
    }

    private async Task<IReadOnlyDictionary<Guid, PostEngagement>> ReadEngagementAsync(Guid[] ids, CancellationToken cancellationToken)
    {
        var all = new Dictionary<Guid, PostEngagement>();
        foreach (var chunk in ids.Chunk(IdChunk))
        {
            var page = await _engagementReader.GetAsync(chunk, viewerPersonaId: null, cancellationToken);
            foreach (var (id, value) in page)
            {
                all[id] = value;
            }
        }

        return all;
    }

    /// <summary>
    /// ONE query: the media items with their assets and effective posters (the item's override wins, DP-3), joined
    /// through the scoped sets, so no item, asset or poster from another exercise can join; kept for the listed posts
    /// only. Nothing is read when nothing is listed (an empty or withheld record).
    /// </summary>
    private async Task<ILookup<Guid, MediaRow>> ReadMediaAsync(
        HashSet<Guid> listedIds, bool includeNoise, CancellationToken cancellationToken)
    {
        if (listedIds.Count == 0)
        {
            return Array.Empty<MediaRow>().ToLookup(row => row.PostId);
        }

        var rows = await (
                from item in _dbContext.PostMediaItems.AsNoTracking()
                join post in _dbContext.Posts.AsNoTracking() on item.PostId equals post.Id
                where includeNoise || post.Origin != PostExportLabels.NoiseOrigin
                join asset in _dbContext.MediaAssets.AsNoTracking() on item.MediaAssetId equals asset.Id
                join poster in _dbContext.MediaAssets.AsNoTracking()
                    on item.PosterMediaAssetId ?? asset.PosterMediaAssetId equals (Guid?)poster.Id into posters
                from poster in posters.DefaultIfEmpty()
                select new { item.PostId, item.Order, item.Alt, Asset = asset, Poster = poster })
            .ToListAsync(cancellationToken);

        return rows
            .Where(row => listedIds.Contains(row.PostId))
            .Select(row => new MediaRow(row.PostId, row.Order, row.Alt, row.Asset, row.Poster))
            .ToLookup(row => row.PostId);
    }

    /// <summary>The avatar asset per listed author, read through the scoped sets.</summary>
    private async Task<IReadOnlyDictionary<Guid, MediaAsset>> ReadAvatarsAsync(
        HashSet<Guid> authorIds, CancellationToken cancellationToken)
    {
        if (authorIds.Count == 0)
        {
            return new Dictionary<Guid, MediaAsset>();
        }

        var rows = await (
                from persona in _dbContext.Personas.AsNoTracking()
                where persona.AvatarMediaId != null
                join asset in _dbContext.MediaAssets.AsNoTracking() on persona.AvatarMediaId equals (Guid?)asset.Id
                select new { PersonaId = persona.Id, Asset = asset })
            .ToListAsync(cancellationToken);

        return rows
            .Where(row => authorIds.Contains(row.PersonaId))
            .ToDictionary(row => row.PersonaId, row => row.Asset);
    }

    /// <summary>
    /// One signer call for every image, poster and avatar. A storage fault degrades the report to <c>null</c> URLs
    /// (logged once); cancellation and a scope violation are not absorbed, as in <c>ParticipantPostProjector</c>.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, string>> SignAsync(
        ILookup<Guid, MediaRow> media, IEnumerable<MediaAsset> avatars, CancellationToken cancellationToken)
    {
        var assets = media
            .SelectMany(group => group)
            .SelectMany(row => string.Equals(row.Asset.Kind, MediaKinds.Video, StringComparison.Ordinal)
                ? row.Poster is null ? [] : new[] { row.Poster }
                : new[] { row.Asset })
            .Concat(avatars)
            .DistinctBy(asset => asset.Id)
            .ToArray();

        if (assets.Length == 0)
        {
            return new Dictionary<Guid, string>();
        }

        try
        {
            return await _mediaUrlSigner.GetReadUrlsAsync(assets, cancellationToken);
        }
#pragma warning disable CA1031 // A storage fault must degrade the report to null URLs, never fail it.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
        {
            LogSigningFailed(ex, assets.Length);
            return new Dictionary<Guid, string>();
        }
#pragma warning restore CA1031
    }

    private TelemetryEvent BuildViewedEvent(
        Guid exerciseId,
        ExerciseFacts facts,
        CurrentStaffSession? staff,
        ReportLookups lookups,
        int listedPosts,
        DateTimeOffset now)
    {
        string? role = null;
        if (staff is not null)
        {
            lookups.StaffRoles.TryGetValue(staff.StaffUserId, out role);
        }

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = ViewedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,

                // Off-envelope empty strings are null-omitted (the v0 schema types these as optional non-empty).
                ActingHumanId = staff?.StaffUserId.ToString(),
                SessionId = staff?.SessionId.ToString(),
                Role = string.IsNullOrWhiteSpace(role) ? null : role,
            },
            WallClockTime = now,
            ScenarioTime = _exerciseClock?.CurrentScenarioTime(exerciseId) ?? facts.StoredScenarioTime ?? now,
            TimeZone = string.IsNullOrWhiteSpace(facts.TimeZone) ? ExerciseDay.UtcZoneId : facts.TimeZone,
            Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
            Payload = JsonSerializer.Serialize(new ViewedPayload { Posts = listedPosts }),
            EmittedAt = now,
        };
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Signing {AssetCount} media asset(s) for the exercise report failed; the report is served without media URLs.")]
    private partial void LogSigningFailed(Exception exception, int assetCount);

    /// <summary>A persona as the report needs it.</summary>
    private sealed record PersonaLabel(Guid Id, string Handle, string DisplayName, bool Verified, Guid? AvatarMediaId);

    /// <summary>An inject item's reference, title and whether it counts as delivered (fired, not deleted).</summary>
    private sealed record InjectLabel(string Ref, string Title, bool Delivered);

    /// <summary>The per-exercise lookups read once per report.</summary>
    private sealed record ReportLookups(
        IReadOnlyDictionary<Guid, PersonaLabel> Personas,
        IReadOnlyDictionary<string, string> Humans,
        IReadOnlyDictionary<Guid, string> StaffRoles,
        IReadOnlyDictionary<Guid, InjectLabel> Injects,
        int SignedInParticipants);

    /// <summary>The post columns the report reads.</summary>
    private sealed record PostRow(
        Guid Id,
        Guid AuthorPersonaId,
        string? Body,
        DateTimeOffset CreatedScenarioTime,
        DateTimeOffset CreatedWallClock,
        string Origin,
        string ActingHumanId,
        string? InjectId,
        Guid? ParentPostId,
        DateTimeOffset? DeletedAt,
        int BaselineLikeCount,
        int BaselineRepostCount,
        int BaselineReplyCount,
        DateTimeOffset? PinnedForAllAt,
        int EditCount,
        DateTimeOffset? LastEditedScenarioTime);

    /// <summary>One media item with its asset and effective poster.</summary>
    private sealed record MediaRow(Guid PostId, int Order, string Alt, MediaAsset Asset, MediaAsset? Poster);

    /// <summary>The opaque XC-004 payload: the listed post count only.</summary>
    private sealed class ViewedPayload
    {
        [JsonPropertyName("posts")]
        public required int Posts { get; init; }
    }
}
