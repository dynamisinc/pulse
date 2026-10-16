namespace Pulse.LoadTest;

using System.Collections.Concurrent;

/// <summary>Percentile maths (linear interpolation between closest ranks, as Excel's PERCENTILE.INC).</summary>
internal static class Percentiles
{
    /// <summary>
    /// The <paramref name="percentile"/> (0..100) of <paramref name="values"/>; <c>null</c> for no values. The input
    /// need not be sorted and is not modified.
    /// </summary>
    public static double? Of(IReadOnlyCollection<double> values, double percentile)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (percentile is < 0 or > 100 || double.IsNaN(percentile))
        {
            throw new ArgumentOutOfRangeException(nameof(percentile), "percentile must be between 0 and 100.");
        }

        if (values.Count == 0)
        {
            return null;
        }

        var sorted = values.ToArray();
        Array.Sort(sorted);
        return OfSorted(sorted, percentile);
    }

    /// <summary>As <see cref="Of"/>, for an already ascending-sorted array.</summary>
    public static double? OfSorted(double[] sorted, double percentile)
    {
        ArgumentNullException.ThrowIfNull(sorted);
        if (sorted.Length == 0)
        {
            return null;
        }

        var rank = percentile / 100.0 * (sorted.Length - 1);
        var lower = (int)Math.Floor(rank);
        var upper = (int)Math.Ceiling(rank);
        if (lower == upper)
        {
            return sorted[lower];
        }

        return sorted[lower] + ((rank - lower) * (sorted[upper] - sorted[lower]));
    }
}

/// <summary>A summary of one series: count, errors, error rate and latency percentiles in milliseconds.</summary>
internal sealed record SeriesSummary(
    string Name,
    int Count,
    int Errors,
    double ErrorRate,
    double? P50Ms,
    double? P95Ms,
    double? P99Ms,
    double? MaxMs)
{
    public static SeriesSummary From(string name, IReadOnlyCollection<RequestSample> samples)
    {
        var errors = samples.Count(s => !s.Success);
        var latencies = samples.Select(s => s.LatencyMs).ToArray();
        Array.Sort(latencies);
        return new SeriesSummary(
            name,
            samples.Count,
            errors,
            samples.Count == 0 ? 0 : (double)errors / samples.Count,
            Round(Percentiles.OfSorted(latencies, 50)),
            Round(Percentiles.OfSorted(latencies, 95)),
            Round(Percentiles.OfSorted(latencies, 99)),
            latencies.Length == 0 ? null : latencies[^1]);
    }

    public static SeriesSummary FromLatencies(string name, IReadOnlyCollection<double> latencies)
    {
        var sorted = latencies.ToArray();
        Array.Sort(sorted);
        return new SeriesSummary(
            name,
            sorted.Length,
            0,
            0,
            Round(Percentiles.OfSorted(sorted, 50)),
            Round(Percentiles.OfSorted(sorted, 95)),
            Round(Percentiles.OfSorted(sorted, 99)),
            sorted.Length == 0 ? null : sorted[^1]);
    }

    private static double? Round(double? value) => value is { } v ? Math.Round(v, 1) : null;
}

/// <summary>One timed request.</summary>
/// <param name="At">When the request started (UTC).</param>
/// <param name="Step">The step index (0-based) when the request STARTED, or -1 outside a step.</param>
/// <param name="Metric">The series: post, feed, reaction, join, controller-post, noise, inject-fire, ...</param>
/// <param name="LatencyMs">Wall time to the response (or the failure).</param>
/// <param name="Status">The HTTP status, or 0 when no response arrived.</param>
/// <param name="Success">2xx.</param>
internal sealed record RequestSample(DateTimeOffset At, int Step, string Metric, double LatencyMs, int Status, bool Success)
{
    /// <summary>
    /// When the request finished (start + latency). Samples are logged at completion, so time windows (the stop rules)
    /// select by this: a 30 s timeout that started 30 s ago is evidence NOW, not 30 s in the past.
    /// </summary>
    public DateTimeOffset CompletedAt => At + TimeSpan.FromMilliseconds(LatencyMs);
}

/// <summary>Thread-safe sink for every request sample of the run, in arrival order.</summary>
internal sealed class SampleLog
{
    private readonly ConcurrentQueue<RequestSample> _samples = new();

    public void Add(RequestSample sample) => _samples.Enqueue(sample);

    public IReadOnlyList<RequestSample> Snapshot() => _samples.ToArray();

    public IReadOnlyList<RequestSample> ForStep(int step) => _samples.Where(s => s.Step == step).ToArray();
}
