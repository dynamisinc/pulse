namespace Pulse.LoadTest;

/// <summary>
/// PDF-D4 stop rules, evaluated on a tick (every few seconds) over a SHORT trailing window (15 s) of the step's
/// requests — during the ramp as well as the timed step:
/// <list type="bullet">
///   <item><description>error rate above <see cref="StopRuleSettings.MaxErrorRate"/> (5%), or</description></item>
///   <item><description>POST /api/posts p95 above <see cref="StopRuleSettings.MaxPostP95Ms"/> (5 s),</description></item>
/// </list>
/// each SUSTAINED for <see cref="StopRuleSettings.SustainSeconds"/> (60 s): a rule trips only when every tick across
/// that span saw it breached. The window is short on purpose: a 60 s lookback on top of a 60 s sustain would keep a
/// few seconds of errors "in breach" for a whole minute and trip on them. A window with fewer than <see cref="StopRuleSettings.MinSamples"/> requests (or POSTs,
/// for the p95 rule) never counts as a breach and resets nothing either way — it is simply not evidence.
/// </summary>
internal sealed class StopRuleEvaluator
{
    /// <summary>Metrics that are POST /api/posts (participant posts and replies, and controller-as-persona).</summary>
    public static readonly IReadOnlySet<string> PostMetrics = new HashSet<string>(StringComparer.Ordinal)
    {
        Metrics.Post,
        Metrics.Reply,
        Metrics.ControllerPost,
    };

    private readonly StopRuleSettings _settings;
    private DateTimeOffset? _errorBreachSince;
    private DateTimeOffset? _p95BreachSince;

    public StopRuleEvaluator(StopRuleSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
    }

    /// <summary>The last window's error rate (for progress lines).</summary>
    public double? LastErrorRate { get; private set; }

    /// <summary>The last window's POST p95 in ms (for progress lines).</summary>
    public double? LastPostP95Ms { get; private set; }

    /// <summary>
    /// Evaluates one tick at <paramref name="now"/> over <paramref name="stepSamples"/> (the current step's samples;
    /// only those that COMPLETED inside the trailing window are used). Returns the stop reason, or <c>null</c> to carry on.
    /// </summary>
    public string? Evaluate(DateTimeOffset now, IReadOnlyCollection<RequestSample> stepSamples)
    {
        ArgumentNullException.ThrowIfNull(stepSamples);
        var from = now - TimeSpan.FromSeconds(_settings.WindowSeconds);
        // Select by COMPLETION time: samples are logged when they finish, so a slow request or a timeout lands in the
        // window that sees it end (its start time is kept for reporting).
        var window = stepSamples.Where(s => s.CompletedAt > from && s.CompletedAt <= now).ToArray();

        // Error rate.
        if (window.Length >= _settings.MinSamples)
        {
            var rate = (double)window.Count(s => !s.Success) / window.Length;
            LastErrorRate = rate;
            if (rate > _settings.MaxErrorRate)
            {
                _errorBreachSince ??= now;
                if (now - _errorBreachSince.Value >= TimeSpan.FromSeconds(_settings.SustainSeconds))
                {
                    return string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "error rate {0:P1} above {1:P0} for {2:0} s (last {3:0} s window: {4} of {5} requests failed)",
                        rate, _settings.MaxErrorRate, (now - _errorBreachSince.Value).TotalSeconds, _settings.WindowSeconds,
                        window.Count(s => !s.Success), window.Length);
                }
            }
            else
            {
                _errorBreachSince = null;
            }
        }

        // POST p95.
        var posts = window.Where(s => PostMetrics.Contains(s.Metric)).Select(s => s.LatencyMs).ToArray();
        if (posts.Length >= _settings.MinSamples)
        {
            Array.Sort(posts);
            var p95 = Percentiles.OfSorted(posts, 95)!.Value;
            LastPostP95Ms = p95;
            if (p95 > _settings.MaxPostP95Ms)
            {
                _p95BreachSince ??= now;
                if (now - _p95BreachSince.Value >= TimeSpan.FromSeconds(_settings.SustainSeconds))
                {
                    return string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "POST /api/posts p95 {0:0} ms above {1:0} ms for {2:0} s ({3} POSTs in the last {4:0} s)",
                        p95, _settings.MaxPostP95Ms, (now - _p95BreachSince.Value).TotalSeconds, posts.Length, _settings.WindowSeconds);
                }
            }
            else
            {
                _p95BreachSince = null;
            }
        }

        return null;
    }
}

/// <summary>The series names used in samples, CSV and the summary.</summary>
internal static class Metrics
{
    public const string Join = "join";
    public const string Feed = "feed";
    public const string Post = "post";
    public const string Reply = "reply";
    public const string Reaction = "reaction";
    public const string ControllerPost = "controller-post";
    public const string Noise = "noise";
    public const string InjectFire = "inject-fire";
    public const string Refresh = "refresh";
}
