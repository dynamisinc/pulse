namespace Pulse.LoadTest;

using System.Globalization;
using System.Text;
using System.Text.Json;

/// <summary>The JSON summary (summary.json). Holds no token, secret or join link.</summary>
internal sealed record RunSummary(
    string ApiHost,
    string ExerciseId,
    string? ExerciseName,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    bool Completed,
    string? StopReason,
    bool Interrupted,
    long UntrackedFrames,
    ConfigEcho Config,
    IReadOnlyList<StepSummary> Steps);

/// <summary>The settings the run used (no secrets, no file paths).</summary>
internal sealed record ConfigEcho(
    IReadOnlyList<int> Steps,
    double StepMinutes,
    int JoinsPerMinute,
    ActivityMix Activity,
    BurstSettings Burst,
    StopRuleSettings StopRules,
    FanOutSettings FanOut);

/// <summary>One step's numbers.</summary>
internal sealed record StepSummary(
    int Step,
    int TargetUsers,
    int Joined,
    int ConnectedAtStart,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    double? DurationSeconds,
    string? StopReason,
    bool NoiseHigh,
    bool BurstItemFired,
    int PacedPostsSent,
    IReadOnlyDictionary<string, SeriesSummary> Series,
    FanOutSummary FanOut,
    long Reconnects,
    long ConnectionsClosed,
    long ConnectFailures);

/// <summary>Writes summary.json, steps.csv (one row per step and series), samples.csv (every request) and fanout-drops.csv.</summary>
internal static class ResultWriter
{
    private static readonly JsonSerializerOptions SummaryJson = new(LoadTestConfig.JsonOptions)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never, // a null stopReason is an answer
    };

    public static void Write(string directory, RunSummary summary, IReadOnlyList<RequestSample> samples, IReadOnlyList<int> stepUsers, string dropsCsv)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "summary.json"), JsonSerializer.Serialize(summary, SummaryJson));
        File.WriteAllText(Path.Combine(directory, "steps.csv"), StepsCsv(summary));
        File.WriteAllText(Path.Combine(directory, "samples.csv"), SamplesCsv(samples, stepUsers));
        File.WriteAllText(Path.Combine(directory, "fanout-drops.csv"), dropsCsv);
    }

    internal static string StepsCsv(RunSummary summary)
    {
        var csv = new StringBuilder();
        csv.AppendLine("step,users,series,count,errors,errorRate,p50Ms,p95Ms,p99Ms,maxMs,stopReason");
        foreach (var step in summary.Steps)
        {
            foreach (var series in step.Series.Values.OrderBy(s => s.Name, StringComparer.Ordinal))
            {
                csv.AppendLine(Row(step.Step, step.TargetUsers, series.Name, series.Count, series.Errors, series.ErrorRate,
                    series.P50Ms, series.P95Ms, series.P99Ms, series.MaxMs, step.StopReason));
            }

            var fan = step.FanOut;
            csv.AppendLine(Row(step.Step, step.TargetUsers, "fan-out-lag", fan.FramesDelivered, fan.FramesDropped, fan.DropRate,
                fan.LagP50Ms, fan.LagP95Ms, null, fan.LagMaxMs, step.StopReason));
            csv.AppendLine(Row(step.Step, step.TargetUsers, "fan-out-end-to-end", fan.FramesDelivered, fan.FramesDropped, fan.DropRate,
                fan.EndToEndP50Ms, fan.EndToEndP95Ms, null, fan.EndToEndMaxMs, step.StopReason));
        }

        return csv.ToString();
    }

    internal static string SamplesCsv(IReadOnlyList<RequestSample> samples, IReadOnlyList<int> stepUsers)
    {
        var csv = new StringBuilder();
        csv.AppendLine("at,step,users,metric,latencyMs,status,success");
        foreach (var s in samples)
        {
            var users = s.Step >= 0 && s.Step < stepUsers.Count ? stepUsers[s.Step].ToString(CultureInfo.InvariantCulture) : string.Empty;
            csv.Append(s.At.ToString("O", CultureInfo.InvariantCulture)).Append(',')
                .Append(s.Step + 1).Append(',')
                .Append(users).Append(',')
                .Append(s.Metric).Append(',')
                .Append(s.LatencyMs.ToString("0.0", CultureInfo.InvariantCulture)).Append(',')
                .Append(s.Status).Append(',')
                .Append(s.Success ? "true" : "false").AppendLine();
        }

        return csv.ToString();
    }

    private static string Row(params object?[] cells) => string.Join(',', cells.Select(Cell));

    private static string Cell(object? value) => value switch
    {
        null => string.Empty,
        double d => d.ToString("0.####", CultureInfo.InvariantCulture),
        string s => '"' + s.Replace("\"", "\"\"", StringComparison.Ordinal) + '"',
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
