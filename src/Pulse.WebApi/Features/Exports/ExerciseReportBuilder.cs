namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.Linq;

/// <summary>
/// One post as the report's pure functions see it (demo-feedback story 29): enough to bin it, to test it against the
/// DF-42 response rule and to order it. Read once per report from the scoped <c>Posts</c> set.
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

/// <summary>A listed post as threading sees it (DF-47): its id and its direct parent.</summary>
/// <param name="Id">The post id.</param>
/// <param name="ParentPostId">The direct parent, for a reply (listed or not).</param>
public sealed record ReportThreadPost(Guid Id, Guid? ParentPostId);

/// <summary>One listed post's place in the threaded record (DF-47).</summary>
/// <param name="Index">The post's index in the listed input.</param>
/// <param name="ThreadRootId">The top-most ancestor reachable through listed parents, else the post's own id.</param>
/// <param name="Depth">0 for a thread root, 1 for any listed descendant (never more).</param>
public sealed record ReportThreadSlot(int Index, Guid ThreadRootId, int Depth);

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
/// The exercise report's pure logic (demo-feedback story 29): source mapping, 5-minute binning, the DF-42 inject
/// response rule, lookalike pairing, the median and the busiest window. No I/O and no clock, so every rule is
/// unit-testable on its own; <see cref="ExerciseReportService"/> reads the rows and formats the times.
/// </summary>
public static class ExerciseReportBuilder
{
    /// <summary>The finest activity bin, in minutes, and the width of the busiest window.</summary>
    public const int BinMinutes = 5;

    /// <summary>
    /// The most bins one chart emits. Scenario times are client-supplied this phase, so a long or wild span is drawn
    /// with wider bins (<see cref="ChartBinMinutes"/>) instead of allocating millions of empty ones; no post is dropped.
    /// </summary>
    public const int MaxChartBins = 300;

    private const int MinutesPerDay = 1440;

    /// <summary>The bin widths tried in order before falling back to whole multiples of a day.</summary>
    private static readonly int[] BinLadder = [5, 10, 15, 30, 60, 120, 180, 360, 720, MinutesPerDay];

    /// <summary>The DF-42 window: a response counts within this many scenario minutes of the inject's first post.</summary>
    public const int ResponseWindowMinutes = 30;

    /// <summary>The participant origin, the only origin that can respond to an inject (DF-42).</summary>
    public const string ParticipantOrigin = "participant";

    /// <summary>The controller-as-persona origin.</summary>
    public const string ControllerAsPersonaOrigin = "controller-as-persona";

    /// <summary>The scripted inject origin.</summary>
    public const string InjectOrigin = "inject";

    /// <summary>The report source of a scripted inject post.</summary>
    public const string ScriptedSource = "scripted";

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

    /// <summary>The chart series of a stored origin (controller-as-persona counts with participants, DF-41 chart).</summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns>The series.</returns>
    public static ReportSeries Series(string? origin) => origin switch
    {
        ParticipantOrigin or ControllerAsPersonaOrigin => ReportSeries.Participant,
        PostExportLabels.EngineOrigin => ReportSeries.Engine,
        PostExportLabels.NoiseOrigin => ReportSeries.Noise,
        _ => ReportSeries.Scripted,
    };

    /// <summary>Whether a post of this origin is white noise (left out of the list by default, DF-41).</summary>
    /// <param name="origin">The stored origin.</param>
    /// <returns><c>true</c> for <c>noise</c>.</returns>
    public static bool IsNoise(string? origin) => string.Equals(origin, PostExportLabels.NoiseOrigin, StringComparison.Ordinal);

    /// <summary>The 5-minute boundary at or before <paramref name="instant"/> (UTC).</summary>
    /// <param name="instant">Any instant.</param>
    /// <returns>The bin start.</returns>
    public static DateTimeOffset BinFloor(DateTimeOffset instant) => BinFloor(instant, BinMinutes);

    /// <summary>The start of the <paramref name="binMinutes"/>-wide bin holding <paramref name="instant"/>, in UTC.</summary>
    /// <param name="instant">Any instant.</param>
    /// <param name="binMinutes">The bin width in minutes.</param>
    /// <returns>The bin start.</returns>
    public static DateTimeOffset BinFloor(DateTimeOffset instant, int binMinutes)
    {
        var width = TimeSpan.FromMinutes(binMinutes).Ticks;
        var ticks = instant.UtcTicks;
        return new DateTimeOffset(ticks - (ticks % width), TimeSpan.Zero);
    }

    /// <summary>
    /// The chart's bin width: the narrowest of 5, 10, 15, 30 minutes, 1, 2, 3, 6, 12 hours or 1 day that fits the span
    /// from the earliest to the latest post in <see cref="MaxChartBins"/> bins, else the fewest whole days that do.
    /// A normal exercise (under a day) stays at 5 minutes.
    /// </summary>
    /// <param name="posts">Every post in the exercise.</param>
    /// <returns>The width in minutes (<see cref="BinMinutes"/> when there are no posts).</returns>
    public static int ChartBinMinutes(IReadOnlyCollection<ReportPostFact> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        if (posts.Count == 0)
        {
            return BinMinutes;
        }

        var first = posts.Min(post => post.ScenarioTime);
        var last = posts.Max(post => post.ScenarioTime);
        foreach (var width in BinLadder)
        {
            if (BinCount(first, last, width) <= MaxChartBins)
            {
                return width;
            }
        }

        const int maxDays = int.MaxValue / MinutesPerDay;
        var spanDays = (last.UtcTicks - first.UtcTicks) / TimeSpan.TicksPerDay;
        var days = (int)Math.Min(maxDays, (spanDays / (MaxChartBins - 1)) + 1);
        while (days < maxDays && BinCount(first, last, days * MinutesPerDay) > MaxChartBins)
        {
            days++;
        }

        return days * MinutesPerDay;
    }

    /// <summary>
    /// Bins every post (all sources, noise included, DF-41) from the bin holding the earliest post to the bin holding the
    /// latest, empty bins included. The width is <see cref="ChartBinMinutes"/> unless given, so every post is counted.
    /// </summary>
    /// <param name="posts">Every post in the exercise.</param>
    /// <param name="binMinutes">The bin width; defaults to <see cref="ChartBinMinutes"/> for these posts.</param>
    /// <returns>The bins in time order; empty when there are no posts.</returns>
    public static IReadOnlyList<ReportActivityBin> BuildBins(IReadOnlyCollection<ReportPostFact> posts, int? binMinutes = null)
    {
        ArgumentNullException.ThrowIfNull(posts);
        if (posts.Count == 0)
        {
            return [];
        }

        var minutes = binMinutes ?? ChartBinMinutes(posts);
        var width = TimeSpan.FromMinutes(minutes);
        var start = BinFloor(posts.Min(post => post.ScenarioTime), minutes);
        var count = (int)(BinIndex(start, posts.Max(post => post.ScenarioTime), minutes) + 1);

        var counts = new int[count, 4];
        foreach (var post in posts)
        {
            counts[BinIndex(start, post.ScenarioTime, minutes), (int)Series(post.Origin)]++;
        }

        var bins = new ReportActivityBin[count];
        for (var i = 0; i < count; i++)
        {
            bins[i] = new ReportActivityBin(
                start + (width * i),
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
    public static long BinIndex(DateTimeOffset binsStart, DateTimeOffset instant) =>
        BinIndex(binsStart, instant, BinMinutes);

    /// <summary>The index of the <paramref name="binMinutes"/>-wide bin holding <paramref name="instant"/>.</summary>
    /// <param name="binsStart">The first bin's start.</param>
    /// <param name="instant">The instant to place.</param>
    /// <param name="binMinutes">The bin width in minutes.</param>
    /// <returns>The zero-based bin index (negative when the instant is before the first bin).</returns>
    public static long BinIndex(DateTimeOffset binsStart, DateTimeOffset instant, int binMinutes)
    {
        var width = TimeSpan.FromMinutes(binMinutes).Ticks;
        var delta = instant.UtcTicks - binsStart.UtcTicks;
        return delta >= 0 ? delta / width : -1 - ((-delta - 1) / width);
    }

    /// <summary>
    /// The busiest 5-minute window over every post (noise included), counted sparsely so a long span allocates nothing
    /// per empty window; the earliest on a tie. Independent of the chart's bin width.
    /// </summary>
    /// <param name="posts">Every post in the exercise.</param>
    /// <returns>The busiest window, or <c>null</c> when there are no posts.</returns>
    public static ReportActivityBin? BusiestFiveMinutes(IEnumerable<ReportPostFact> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        return BusiestWindow(posts
            .GroupBy(post => BinFloor(post.ScenarioTime))
            .OrderBy(group => group.Key)
            .Select(group => new ReportActivityBin(
                group.Key,
                group.Count(post => Series(post.Origin) == ReportSeries.Participant),
                group.Count(post => Series(post.Origin) == ReportSeries.Scripted),
                group.Count(post => Series(post.Origin) == ReportSeries.Engine),
                group.Count(post => Series(post.Origin) == ReportSeries.Noise))));
    }

    private static long BinCount(DateTimeOffset first, DateTimeOffset last, int binMinutes) =>
        BinIndex(BinFloor(first, binMinutes), last, binMinutes) + 1;

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
    /// The DF-42 rule: the earliest <b>participant</b> post (origin <c>participant</c>) within
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

        // Scenario times are client-supplied: an inject near DateTimeOffset.MaxValue must not overflow the cutoff.
        var window = TimeSpan.FromMinutes(ResponseWindowMinutes);
        var cutoff = deliveredAt <= DateTimeOffset.MaxValue - window ? deliveredAt + window : DateTimeOffset.MaxValue;
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

    /// <summary>
    /// Threads the listed record (DF-47). Each post's root is found by walking parents only while the parent is itself
    /// listed, so a reply whose parent is not listed (outside the window, another source, excluded noise or another
    /// exercise) is a root. The result keeps the roots in their input order, each immediately followed by its listed
    /// descendants in their input order (depth 1 at any nesting). A parent cycle (impossible in practice) is broken at
    /// its earliest-listed member, so every post appears exactly once.
    /// </summary>
    /// <param name="listed">The listed posts, in record order (scenario time, wall clock, id).</param>
    /// <returns>One slot per listed post, in threaded order.</returns>
    public static IReadOnlyList<ReportThreadSlot> Thread(IReadOnlyList<ReportThreadPost> listed)
    {
        ArgumentNullException.ThrowIfNull(listed);

        var indexOf = new Dictionary<Guid, int>(listed.Count);
        for (var i = 0; i < listed.Count; i++)
        {
            indexOf.TryAdd(listed[i].Id, i);
        }

        var roots = new int[listed.Count];
        for (var i = 0; i < listed.Count; i++)
        {
            roots[i] = RootOf(i, listed, indexOf);
        }

        var descendants = new Dictionary<int, List<int>>();
        for (var i = 0; i < listed.Count; i++)
        {
            if (roots[i] != i)
            {
                if (!descendants.TryGetValue(roots[i], out var list))
                {
                    list = [];
                    descendants[roots[i]] = list;
                }

                list.Add(i);
            }
        }

        var slots = new List<ReportThreadSlot>(listed.Count);
        for (var i = 0; i < listed.Count; i++)
        {
            if (roots[i] != i)
            {
                continue;
            }

            slots.Add(new ReportThreadSlot(i, listed[i].Id, 0));
            if (descendants.TryGetValue(i, out var children))
            {
                slots.AddRange(children.Select(child => new ReportThreadSlot(child, listed[i].Id, 1)));
            }
        }

        return slots;
    }

    /// <summary>The index of a listed post's thread root: up through listed parents, a cycle broken at its earliest member.</summary>
    private static int RootOf(int start, IReadOnlyList<ReportThreadPost> listed, Dictionary<Guid, int> indexOf)
    {
        var chain = new List<int> { start };
        var seen = new HashSet<int> { start };
        var current = start;
        while (listed[current].ParentPostId is { } parent && indexOf.TryGetValue(parent, out var parentIndex))
        {
            if (!seen.Add(parentIndex))
            {
                // A cycle: its members are the chain from the repeated post on; the earliest-listed one is the root.
                return chain.Skip(chain.IndexOf(parentIndex)).Min();
            }

            chain.Add(parentIndex);
            current = parentIndex;
        }

        return current;
    }

    private static bool IsHandleChar(char character) => char.IsLetterOrDigit(character) || character == '_';

    /// <summary>
    /// Sums shown engagement (baseline + real) over many posts in 64-bit: a 1,000,000 baseline on a few thousand posts
    /// passes <see cref="int.MaxValue"/> well below the 5,000-post limit.
    /// </summary>
    /// <param name="counts">Each post's baseline and real count.</param>
    /// <returns>The total.</returns>
    public static long SumShown(IEnumerable<(int Baseline, int Real)> counts)
    {
        ArgumentNullException.ThrowIfNull(counts);
        long total = 0;
        foreach (var (baseline, real) in counts)
        {
            total += (long)baseline + real;
        }

        return total;
    }
}
