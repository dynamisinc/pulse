namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;

/// <summary>
/// The post record's filters (demo-feedback story 30, DF-44): which sources are listed and an inclusive scenario-time
/// window in the exercise zone. They narrow only the post record; the summary, activity, inject responses and
/// lookalikes are always built over every post (DF-43).
/// </summary>
/// <remarks>
/// The window is compared against each post's scenario time as the report prints it: converted to the exercise zone
/// and truncated to the minute. So <c>to = 10:00</c> keeps a post at 10:00:59, and a daylight-saving gap or fold never
/// moves a boundary.
/// </remarks>
public sealed class ExerciseReportFilter
{
    /// <summary>The query and wire format of <see cref="From"/> and <see cref="To"/>.</summary>
    public const string TimeFormat = "yyyy-MM-dd HH:mm";

    /// <summary>The wire name of the participant source (participant and controller-as-persona posts).</summary>
    public const string ParticipantSource = "participant";

    /// <summary>The wire name of the scripted source (inject posts).</summary>
    public const string ScriptedSource = "scripted";

    /// <summary>The wire name of the engine source.</summary>
    public const string EngineSource = "engine";

    /// <summary>The wire name of the background-noise source.</summary>
    public const string NoiseSource = "noise";

    /// <summary>The sources in canonical order, each with the chart series it selects.</summary>
    private static readonly (string Name, ReportSeries Series)[] Canonical =
    [
        (ParticipantSource, ReportSeries.Participant),
        (ScriptedSource, ReportSeries.Scripted),
        (EngineSource, ReportSeries.Engine),
        (NoiseSource, ReportSeries.Noise),
    ];

    private readonly HashSet<ReportSeries> _series;

    private ExerciseReportFilter(HashSet<ReportSeries> series, DateTime? from, DateTime? to)
    {
        _series = series;
        From = from;
        To = to;
        Sources = Canonical.Where(entry => series.Contains(entry.Series)).Select(entry => entry.Name).ToArray();
    }

    /// <summary>The default filter: every source but noise (DF-41), no window.</summary>
    public static ExerciseReportFilter Default { get; } =
        new([ReportSeries.Participant, ReportSeries.Scripted, ReportSeries.Engine], null, null);

    /// <summary>The applied sources, in canonical order (<c>participant, scripted, engine, noise</c>).</summary>
    public IReadOnlyList<string> Sources { get; }

    /// <summary>The inclusive window start, an exercise-zone wall time to the minute; <c>null</c> when open.</summary>
    public DateTime? From { get; }

    /// <summary>The inclusive window end, an exercise-zone wall time to the minute; <c>null</c> when open.</summary>
    public DateTime? To { get; }

    /// <summary>Whether noise posts are listed.</summary>
    public bool IncludesNoise => _series.Contains(ReportSeries.Noise);

    /// <summary>
    /// Parses the query parameters. A missing <paramref name="sources"/> means the default sources;
    /// <paramref name="includeNoise"/> <c>true</c> adds <c>noise</c> to whatever the sources are (the story 29 alias).
    /// </summary>
    /// <param name="sources">The comma list of sources, or <c>null</c> when absent.</param>
    /// <param name="includeNoise">The story 29 noise toggle.</param>
    /// <param name="from">The window start, <see cref="TimeFormat"/>; <c>null</c> or empty when open.</param>
    /// <param name="to">The window end, <see cref="TimeFormat"/>; <c>null</c> or empty when open.</param>
    /// <param name="filter">The parsed filter, when valid.</param>
    /// <param name="error">A readable reason, when invalid.</param>
    /// <returns><c>true</c> when the parameters are valid.</returns>
    public static bool TryParse(
        string? sources,
        bool? includeNoise,
        string? from,
        string? to,
        out ExerciseReportFilter filter,
        out string? error)
    {
        filter = Default;
        error = null;

        HashSet<ReportSeries> series;
        if (sources is null)
        {
            series = [ReportSeries.Participant, ReportSeries.Scripted, ReportSeries.Engine];
        }
        else
        {
            series = [];
            var names = sources.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            foreach (var name in names)
            {
                var match = Canonical.FirstOrDefault(entry => string.Equals(entry.Name, name, StringComparison.OrdinalIgnoreCase));
                if (match.Name is null)
                {
                    error = $"\"{name}\" is not a report source. Use participant, scripted, engine or noise.";
                    return false;
                }

                series.Add(match.Series);
            }

            if (series.Count == 0)
            {
                error = "Choose at least one source: participant, scripted, engine or noise.";
                return false;
            }
        }

        if (includeNoise == true)
        {
            series.Add(ReportSeries.Noise);
        }

        if (!TryParseTime(from, "from", out var fromTime, out error) || !TryParseTime(to, "to", out var toTime, out error))
        {
            return false;
        }

        if (fromTime is { } start && toTime is { } end && start > end)
        {
            error = $"The window starts at {Format(start)}, after it ends at {Format(end)}. Swap the two times.";
            return false;
        }

        filter = new ExerciseReportFilter(series, fromTime, toTime);
        return true;
    }

    /// <summary>Formats a window bound as <see cref="TimeFormat"/>.</summary>
    /// <param name="value">The bound, or <c>null</c>.</param>
    /// <returns>The formatted bound, or <c>null</c>.</returns>
    public static string? Format(DateTime? value) =>
        value?.ToString(TimeFormat, CultureInfo.InvariantCulture);

    /// <summary>Whether a post is in the record: its source is selected and its printed minute is inside the window.</summary>
    /// <param name="origin">The stored <c>Post.Origin</c>.</param>
    /// <param name="scenarioTime">The post's scenario instant.</param>
    /// <param name="zone">The exercise zone.</param>
    /// <returns><c>true</c> when the post is listed.</returns>
    public bool Matches(string? origin, DateTimeOffset scenarioTime, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        if (!_series.Contains(ExerciseReportBuilder.Series(origin)))
        {
            return false;
        }

        if (From is null && To is null)
        {
            return true;
        }

        var local = TimeZoneInfo.ConvertTime(scenarioTime, zone).DateTime;
        var minute = new DateTime(local.Ticks - (local.Ticks % TimeSpan.TicksPerMinute), DateTimeKind.Unspecified);
        return (From is not { } start || minute >= start) && (To is not { } end || minute <= end);
    }

    private static bool TryParseTime(string? value, string name, out DateTime? time, out string? error)
    {
        time = null;
        error = null;
        if (string.IsNullOrEmpty(value))
        {
            return true;
        }

        if (!DateTime.TryParseExact(value, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            error = $"\"{value}\" is not a valid {name} time. Use yyyy-MM-dd HH:mm, in the exercise's time zone.";
            return false;
        }

        time = DateTime.SpecifyKind(parsed, DateTimeKind.Unspecified);
        return true;
    }
}

/// <summary>
/// The report's size limits. Not registered by default (the service uses <see cref="Default"/>); a test host registers
/// lower values so the limits are exercised without inserting thousands of rows.
/// </summary>
public sealed class ExerciseReportLimits
{
    /// <summary>The production limits: 5,000 listed posts, 50,000 posts in the exercise.</summary>
    public static ExerciseReportLimits Default { get; } = new();

    /// <summary>The most posts the record lists; above it the record is withheld.</summary>
    public int MaxListedPosts { get; init; } = ExerciseReportService.MaxListedPosts;

    /// <summary>The most posts in the exercise the report reads; above it the request is refused with 413.</summary>
    public int MaxExercisePosts { get; init; } = ExerciseReportService.MaxExercisePosts;
}
