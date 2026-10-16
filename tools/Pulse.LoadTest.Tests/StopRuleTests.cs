namespace Pulse.LoadTest.Tests;

using FluentAssertions;

public class StopRuleTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    private static List<RequestSample> Traffic(DateTimeOffset from, DateTimeOffset to, double perSecond, Func<int, bool> success, double latencyMs = 100, string metric = Metrics.Post)
    {
        var samples = new List<RequestSample>();
        var step = TimeSpan.FromSeconds(1 / perSecond);
        var n = 0;
        for (var at = from; at < to; at += step, n++)
        {
            var ok = success(n);
            samples.Add(new RequestSample(at, 0, metric, latencyMs, ok ? 201 : 503, ok));
        }

        return samples;
    }

    /// <summary>Ticks every 5 s from <paramref name="from"/> to <paramref name="to"/>; returns the first reason and when.</summary>
    private static (string? Reason, DateTimeOffset At) Run(StopRuleEvaluator evaluator, List<RequestSample> samples, DateTimeOffset from, DateTimeOffset to)
    {
        for (var now = from; now <= to; now += TimeSpan.FromSeconds(5))
        {
            if (evaluator.Evaluate(now, samples) is { } reason)
            {
                return (reason, now);
            }
        }

        return (null, to);
    }

    [Fact]
    public void HealthyTraffic_NeverStops()
    {
        var samples = Traffic(T0, T0.AddMinutes(10), 4, _ => true);
        Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0, T0.AddMinutes(10)).Reason.Should().BeNull();
    }

    [Fact]
    public void ErrorRateAboveFivePercent_SustainedSixtySeconds_Stops()
    {
        // From minute 2, one request in ten fails (10%).
        var samples = Traffic(T0, T0.AddMinutes(2), 4, _ => true);
        samples.AddRange(Traffic(T0.AddMinutes(2), T0.AddMinutes(6), 4, n => n % 10 != 0));

        var (reason, at) = Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0, T0.AddMinutes(6));

        reason.Should().NotBeNull().And.StartWith("error rate");
        // The trailing 60 s window passes 5% halfway into the bad traffic (minute 2.5); the rule then needs 60 more
        // seconds of breach, so it trips at minute 3.5, at the 5 s tick granularity.
        at.Should().BeOnOrAfter(T0.AddMinutes(3.5)).And.BeBefore(T0.AddMinutes(3.6));
    }

    [Fact]
    public void ErrorRateAtExactlyFivePercent_DoesNotStop()
    {
        var samples = Traffic(T0, T0.AddMinutes(5), 4, n => n % 20 != 0); // exactly 5%
        Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0.AddMinutes(1), T0.AddMinutes(5)).Reason.Should().BeNull();
    }

    [Fact]
    public void ErrorSpikeShorterThanSustain_DoesNotStop()
    {
        // 30 s of total failure, then healthy. A 10 s window keeps the window itself from stretching the outage, so
        // this isolates the sustain rule: 30 s of breach is not 60.
        var settings = new StopRuleSettings { WindowSeconds = 10, MinSamples = 5 };
        var samples = Traffic(T0, T0.AddMinutes(1), 4, _ => true);
        samples.AddRange(Traffic(T0.AddMinutes(1), T0.AddMinutes(1.5), 4, _ => false));
        samples.AddRange(Traffic(T0.AddMinutes(1.5), T0.AddMinutes(4), 4, _ => true));

        Run(new StopRuleEvaluator(settings), samples, T0, T0.AddMinutes(4)).Reason.Should().BeNull();
    }

    [Fact]
    public void BreachThatRecovers_ResetsTheSustainClock()
    {
        var settings = new StopRuleSettings { WindowSeconds = 10, MinSamples = 5 };
        var samples = new List<RequestSample>();
        // 50 s bad, 20 s good, 50 s bad: never 60 s in a row.
        samples.AddRange(Traffic(T0, T0.AddSeconds(50), 4, _ => false));
        samples.AddRange(Traffic(T0.AddSeconds(50), T0.AddSeconds(70), 4, _ => true));
        samples.AddRange(Traffic(T0.AddSeconds(70), T0.AddSeconds(120), 4, _ => false));

        Run(new StopRuleEvaluator(settings), samples, T0, T0.AddSeconds(120)).Reason.Should().BeNull();
    }

    [Fact]
    public void PostP95AboveFiveSeconds_SustainedSixtySeconds_Stops()
    {
        var samples = Traffic(T0, T0.AddMinutes(1), 2, _ => true, latencyMs: 300);
        samples.AddRange(Traffic(T0.AddMinutes(1), T0.AddMinutes(4), 2, _ => true, latencyMs: 6000));

        var (reason, at) = Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0, T0.AddMinutes(4));

        reason.Should().NotBeNull().And.StartWith("POST /api/posts p95");
        at.Should().BeAfter(T0.AddMinutes(2)).And.BeBefore(T0.AddMinutes(2.5));
    }

    [Fact]
    public void SlowFeedReads_DoNotTripThePostRule()
    {
        var samples = Traffic(T0, T0.AddMinutes(4), 2, _ => true, latencyMs: 9000, metric: Metrics.Feed);
        samples.AddRange(Traffic(T0, T0.AddMinutes(4), 2, _ => true, latencyMs: 200, metric: Metrics.ControllerPost));

        Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0, T0.AddMinutes(4)).Reason.Should().BeNull();
    }

    [Fact]
    public void ControllerPostsAndReplies_CountAsPosts()
    {
        StopRuleEvaluator.PostMetrics.Should().BeEquivalentTo([Metrics.Post, Metrics.Reply, Metrics.ControllerPost]);
    }

    [Fact]
    public void TooFewSamples_NeverStops()
    {
        // Every request fails, but only 10 in each 60 s window (< 20 minimum).
        var samples = Traffic(T0, T0.AddMinutes(5), 1.0 / 6, _ => false);
        Run(new StopRuleEvaluator(new StopRuleSettings()), samples, T0, T0.AddMinutes(5)).Reason.Should().BeNull();
    }

    [Fact]
    public void SamplesOutsideTheWindow_AreIgnored()
    {
        // A burst of failures 5 minutes ago, healthy since.
        var samples = Traffic(T0, T0.AddMinutes(1), 4, _ => false);
        samples.AddRange(Traffic(T0.AddMinutes(1), T0.AddMinutes(6), 4, _ => true));
        var evaluator = new StopRuleEvaluator(new StopRuleSettings());

        Run(evaluator, samples, T0.AddMinutes(3), T0.AddMinutes(6)).Reason.Should().BeNull();
        evaluator.LastErrorRate.Should().Be(0);
    }
}
