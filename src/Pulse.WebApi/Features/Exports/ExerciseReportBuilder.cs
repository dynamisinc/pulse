namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.Linq;

/// <summary>
/// One post as the report's pure functions see it (demo-feedback story 17): enough to bin it, to test it against the
/// DF-25 response rule and to order it. Read once per report from the scoped <c>Posts</c> set.
/// </summary>
/// <param name="Id">The post id.</param>
/// <param name="AuthorPersonaId">The authoring persona.</param>
/// <param name="Origin">The stored <c>Post.Origin</c>.</param>
/// <param name="ScenarioTime">The post's scenario instant.</param>
/// <param name="WallClock">The real ingest instant (a tie-breaker only; never printed).</param>
/// <param name="ParentPostId">The direct parent, for a reply.</param>
/// <param name="Body">The text; <c>null</c> when it was not read (an excluded noise post).</param>
public sealed record ReportPostFact(
    Guid Id,
    Guid AuthorPersonaId,
    string Origin,
    DateTimeOffset ScenarioTime,
    DateTimeOffset WallClock,
    Guid? ParentPostId,
    string? Body);

/// <summary>One 5-minute activity bin, split by source series.</summary>
/// <param name="Start">The bin's first instant (UTC, on a 5-minute boundary).</param>
/// <param name="Participant">Participant and controller-as-persona posts.</param>
/// <param name="Scripted">Scripted inject posts.</param>
/// <param name="Engine">Engine posts.</param>
/// <param name="Noise">White-noise posts.</param>
public sealed record ReportActivityBin(DateTimeOffset Start, int Participant, int Scripted, int Engine, int Noise)
{
    /// <summary>Every post in the bin.</summary>
    public int Total => Participant + Scripted + Engine + Noise;
}

/// <summary>A persona that authored at least one post, as lookalike pairing sees it.</summary>
/// <param name="Id">The persona id.</param>
/// <param name="Handle">The stored handle (with or without a leading <c>@</c>).</param>
/// <param name="Verified">Whether the persona carries the verified badge.</param>
public sealed record ReportLookalikeCandidate(Guid Id, string Handle, bool Verified);

/// <summary>The chart series a post counts in.</summary>
public enum ReportSeries
{
    /// <summary>Participant, and controller-as-persona.</summary>
    Participant,

    /// <summary>Scripted inject posts.</summary>
    Scripted,

    /// <summary>Engine posts.</summary>
    Engine,

    /// <summary>White-noise posts.</summary>
    Noise,
}

/// <summary>
/// The exercise report's pure logic (demo-feedback story 17): source mapping, 5-minute binning, the DF-25 inject
/// response rule, lookalike pairing, the median and the busiest window. No I/O and no clock, so every rule is
/// unit-testable on its own; <see cref="ExerciseReportService"/> reads the rows and formats the times.
/// </summary>
public static class ExerciseReportBuilder
{
    /// <summary>The width of one activity bin, in minutes (the contract's <c>binMinutes</c>).</summary>
    public const int BinMinutes = 5;

    /// <summary>
    /// The most bins one report emits (about 35 days of 5-minute bins). Scenario times are client-supplied this
    /// phase, so one malformed instant must not allocate millions of empty bins; posts past the cap are not binned.
    /// </summary>
    public const int MaxBins = 10_000;

    /// <summary>The DF-25 window: a response counts within this many scenario minutes of the inject's first post.</summary>
    public const int ResponseWindowMinutes = 30;

    /// <summary>The participant origin, the only origin that can respond to an inject (DF-25).</summary>
    public const string ParticipantOrigin = "participant";

    /// <summary>The controller-as-persona origin.</summary>
    public const string ControllerAsPersonaOrigin = "controller-as-persona";

    /// <summary>The scripted inject origin.</summary>
    public const string InjectOrigin = "inject";

    /// <summary>The report source of a scripted inject post.</summary>
    public const string ScriptedSource = "scripted";

    private static readonly TimeSpan BinWidth = TimeSpan.FromMinutes(BinMinutes);

    /// <summary>
    /// Maps a stored <c>Post.Origin</c> to the contract's <c>ReportSource</c>: <c>inject</c> becomes <c>scripted</c>;
    /// the other four pass through. An unknown origin (none exists today) reports as <c>scripted</c>, never throws.
    /// </summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns>The report source.</returns>
    public static string Source(string? origin) => origin switch
    {
        ParticipantOrigin => ParticipantOrigin,
        ControllerAsPersonaOrigin => ControllerAsPersonaOrigin,
        PostExportLabels.EngineOrigin => PostExportLabels.EngineOrigin,
        PostExportLabels.NoiseOrigin => PostExportLabels.NoiseOrigin,
        _ => ScriptedSource,
    };

    /// <summary>The chart series of a stored origin (controller-as-persona counts with participants, DF-24 chart).</summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns>The series.</returns>
    public static ReportSeries Series(string? origin) => origin switch
    {
        ParticipantOrigin or ControllerAsPersonaOrigin => ReportSeries.Participant,
        PostExportLabels.EngineOrigin => ReportSeries.Engine,
        PostExportLabels.NoiseOrigin => ReportSeries.Noise,
        _ => ReportSeries.Scripted,
    };

    /// <summary>Whether a post of this origin is white noise (left out of the list by default, DF-24).</summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns><c>true</c> for <c>noise</c>.</returns>
    public static bool IsNoise(string? origin) => string.Equals(origin, PostExportLabels.NoiseOrigin, StringComparison.Ordinal);

    /// <summary>The 5-minute boundary at or before <paramref name="instant"/> (UTC).</summary>
    /// <param name="instant">Any instant.</param>
    /// <returns>The bin start.</returns>
    public static DateTimeOffset BinFloor(DateTimeOffset instant)
    {
        var ticks = instant.UtcTicks;
        return new DateTimeOffset(ticks - (ticks % BinWidth.Ticks), TimeSpan.Zero);
    }

    /// <summary>
    /// Bins every post (all sources, noise included, DF-24) into 5-minute bins from the bin holding the earliest
    /// post to the bin holding the latest, empty bins included, at most <see cref="MaxBins"/>.
    /// </summary>
    /// <param name="posts">Every post in the exercise.</param>
    /// <returns>The bins in time order; empty when there are no posts.</returns>
    public static IReadOnlyList<ReportActivityBin> BuildBins(IReadOnlyCollection<ReportPostFact> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        if (posts.Count == 0)
        {
            return [];
        }

        var start = BinFloor(posts.Min(post => post.ScenarioTime));
        var last = BinIndex(start, posts.Max(post => post.ScenarioTime));
        var count = (int)Math.Min(last + 1, MaxBins);

        var counts = new int[count, 4];
        foreach (var post in posts)
        {
            var index = BinIndex(start, post.ScenarioTime);
            if (index < count)
            {
                counts[index, (int)Series(post.Origin)]++;
            }
        }

        var bins = new ReportActivityBin[count];
        for (var i = 0; i < count; i++)
        {
            bins[i] = new ReportActivityBin(
                start + (BinWidth * i),
                counts[i, (int)ReportSeries.Participant],
                counts[i, (int)ReportSeries.Scripted],
                counts[i, (int)ReportSeries.Engine],
                counts[i, (int)ReportSeries.Noise]);
        }

        return bins;
    }

    /// <summary>The index of the bin holding <paramref name="instant"/>, counted from <paramref name="binsStart"/>.</summary>
    /// <param name="binsStart">The first bin's start.</param>
    /// <param name="instant">The instant to place.</param>
    /// <returns>The zero-based bin index (negative when the instant is before the first bin).</returns>
    public static long BinIndex(DateTimeOffset binsStart, DateTimeOffset instant)
    {
        var delta = instant.UtcTicks - binsStart.UtcTicks;
        return delta >= 0 ? delta / BinWidth.Ticks : -1 - ((-delta - 1) / BinWidth.Ticks);
    }

    /// <summary>The busiest bin (most posts, all sources; the earliest on a tie), or <c>null</c> when every bin is empty.</summary>
    /// <param name="bins">The activity bins.</param>
    /// <returns>The busiest bin, or <c>null</c>.</returns>
    public static ReportActivityBin? BusiestWindow(IEnumerable<ReportActivityBin> bins)
    {
        ArgumentNullException.ThrowIfNull(bins);
        ReportActivityBin? busiest = null;
        foreach (var bin in bins)
        {
            if (bin.Total > 0 && (busiest is null || bin.Total > busiest.Total))
            {
                busiest = bin;
            }
        }

        return busiest;
    }

    /// <summary>
    /// The DF-25 rule: the earliest <b>participant</b> post (origin <c>participant</c>) within
    /// <see cref="ResponseWindowMinutes"/> scenario minutes of the inject's first post (both ends inclusive) that either
    /// replies directly to one of the inject's posts or mentions the <c>@handle</c> of one of their authors. A shared
    /// hashtag is not a match. Ties go to the earlier wall clock, then the lower id.
    /// </summary>
    /// <param name="deliveredAt">The scenario instant of the inject's first post.</param>
    /// <param name="injectPostIds">The inject's posts.</param>
    /// <param name="authorHandles">The handles of the inject posts' authors (with or without <c>@</c>).</param>
    /// <param name="posts">Every post in the exercise (non-participant posts are ignored).</param>
    /// <returns>The first response, or <c>null</c> when nobody responded.</returns>
    public static ReportPostFact? FirstResponse(
        DateTimeOffset deliveredAt,
        IReadOnlySet<Guid> injectPostIds,
        IReadOnlyCollection<string> authorHandles,
        IEnumerable<ReportPostFact> posts)
    {
        ArgumentNullException.ThrowIfNull(injectPostIds);
        ArgumentNullException.ThrowIfNull(authorHandles);
        ArgumentNullException.ThrowIfNull(posts);

        var cutoff = deliveredAt.AddMinutes(ResponseWindowMinutes);
        var handles = authorHandles
            .Select(NormalizeHandle)
            .Where(handle => handle.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return posts
            .Where(post => string.Equals(post.Origin, ParticipantOrigin, StringComparison.Ordinal)
                && post.ScenarioTime >= deliveredAt
                && post.ScenarioTime <= cutoff
                && ((post.ParentPostId is { } parent && injectPostIds.Contains(parent))
                    || handles.Any(handle => MentionsHandle(post.Body, handle))))
            .OrderBy(post => post.ScenarioTime)
            .ThenBy(post => post.WallClock)
            .ThenBy(post => post.Id)
            .FirstOrDefault();
    }

    /// <summary>
    /// Whether <paramref name="body"/> mentions <c>@handle</c> as a whole handle: case-insensitive, and neither preceded
    /// nor followed by a handle character (letter, digit or <c>_</c>), so <c>@cityfire</c> does not match
    /// <c>@cityfire_official</c> or <c>me@cityfire</c>.
    /// </summary>
    /// <param name="body">The post text, or <c>null</c>.</param>
    /// <param name="handle">The handle, with or without <c>@</c>.</param>
    /// <returns><c>true</c> when the handle is mentioned.</returns>
    public static bool MentionsHandle(string? body, string? handle)
    {
        var bare = NormalizeHandle(handle);
        if (string.IsNullOrEmpty(body) || bare.Length == 0)
        {
            return false;
        }

        var needle = "@" + bare;
        var from = 0;
        while (from <= body.Length - needle.Length)
        {
            var at = body.IndexOf(needle, from, StringComparison.OrdinalIgnoreCase);
            if (at < 0)
            {
                return false;
            }

            var end = at + needle.Length;
            var before = at == 0 || !IsHandleChar(body[at - 1]);
            var after = end == body.Length || !IsHandleChar(body[end]);
            if (before && after)
            {
                return true;
            }

            from = at + 1;
        }

        return false;
    }

    /// <summary>The response time in minutes, rounded to one decimal.</summary>
    /// <param name="deliveredAt">The inject's first post.</param>
    /// <param name="respondedAt">The first response.</param>
    /// <returns>The minutes.</returns>
    public static double ResponseMinutes(DateTimeOffset deliveredAt, DateTimeOffset respondedAt) =>
        Math.Round((respondedAt - deliveredAt).TotalMinutes, 1, MidpointRounding.AwayFromZero);

    /// <summary>The median (the mean of the middle two for an even count), or <c>null</c> when there are no values.</summary>
    /// <param name="values">The values (responded injects only).</param>
    /// <returns>The median, rounded to one decimal, or <c>null</c>.</returns>
    public static double? Median(IEnumerable<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        var sorted = values.Order().ToArray();
        if (sorted.Length == 0)
        {
            return null;
        }

        var middle = sorted.Length / 2;
        var median = sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        return Math.Round(median, 1, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Pairs each unverified persona with the verified persona whose handle its own starts with (case-insensitive,
    /// strictly longer). When several verified handles qualify, the longest (most specific) wins. Callers pass only
    /// personas that authored posts in the exercise. Ordered by verified handle, then lookalike handle.
    /// </summary>
    /// <param name="authors">The personas that authored posts.</param>
    /// <returns>The (verified, lookalike) pairs.</returns>
    public static IReadOnlyList<(ReportLookalikeCandidate Verified, ReportLookalikeCandidate Lookalike)> PairLookalikes(
        IEnumerable<ReportLookalikeCandidate> authors)
    {
        ArgumentNullException.ThrowIfNull(authors);
        var all = authors.DistinctBy(author => author.Id).ToArray();
        var verified = all.Where(author => author.Verified && NormalizeHandle(author.Handle).Length > 0).ToArray();

        var pairs = new List<(ReportLookalikeCandidate Verified, ReportLookalikeCandidate Lookalike)>();
        foreach (var candidate in all.Where(author => !author.Verified))
        {
            var handle = NormalizeHandle(candidate.Handle);
            var match = verified
                .Where(v =>
                {
                    var verifiedHandle = NormalizeHandle(v.Handle);
                    return handle.Length > verifiedHandle.Length
                        && handle.StartsWith(verifiedHandle, StringComparison.OrdinalIgnoreCase);
                })
                .OrderByDescending(v => NormalizeHandle(v.Handle).Length)
                .ThenBy(v => NormalizeHandle(v.Handle), StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();

            if (match is not null)
            {
                pairs.Add((match, candidate));
            }
        }

        return pairs
            .OrderBy(pair => NormalizeHandle(pair.Verified.Handle), StringComparer.OrdinalIgnoreCase)
            .ThenBy(pair => NormalizeHandle(pair.Lookalike.Handle), StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>A handle without its leading <c>@</c> and surrounding whitespace.</summary>
    /// <param name="handle">The stored handle.</param>
    /// <returns>The bare handle, or empty.</returns>
    public static string NormalizeHandle(string? handle) => (handle ?? string.Empty).Trim().TrimStart('@');

    private static bool IsHandleChar(char character) => char.IsLetterOrDigit(character) || character == '_';
}
