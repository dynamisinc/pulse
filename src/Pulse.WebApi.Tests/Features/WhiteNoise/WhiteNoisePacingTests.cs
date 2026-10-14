namespace Pulse.WebApi.Tests.Features.WhiteNoise;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Features.WhiteNoise;
using Xunit;

/// <summary>
/// Story 05 (DF-12/DF-13), model-only: the rates and jitter bounds per level over a simulated window, the
/// no-catch-up timetable (stops, level changes, restart), the selection rules, the push throttle and the
/// <c>NoiseStateDto</c> wire shape. No host, no SQL, a hand-driven clock and pinned jitter.
/// </summary>
public sealed class WhiteNoisePacingTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 20, 14, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(NoiseRates.Off, 0)]
    [InlineData(NoiseRates.Low, 2)]
    [InlineData(NoiseRates.Medium, 6)]
    [InlineData(NoiseRates.High, 15)]
    public void EachLevel_HasItsFrozenRate(string level, int perMinute)
    {
        NoiseRates.IsLevel(level).Should().BeTrue();
        NoiseRates.PerMinute(level).Should().Be(perMinute, "DF-12 fixes 0 / 2 / 6 / 15 posts per minute");
    }

    [Theory]
    [InlineData("loud")]
    [InlineData("HIGH")]
    [InlineData(" low")]
    [InlineData("")]
    [InlineData(null)]
    public void AnythingElse_IsNotALevel(string? raw)
    {
        NoiseRates.IsLevel(raw).Should().BeFalse("only the four lowercase wire literals are levels");
        NoiseRates.PerMinute(raw).Should().Be(0);
    }

    [Theory]
    [InlineData(NoiseRates.Low)]
    [InlineData(NoiseRates.Medium)]
    [InlineData(NoiseRates.High)]
    public void AGap_StaysWithinFortyPercentOfItsMean(string level)
    {
        var mean = NoiseRates.MeanGap(level)!.Value;

        NoiseRates.Gap(level, 0).Should().Be(TimeSpan.FromTicks((long)(mean.Ticks * 0.6)));
        NoiseRates.Gap(level, 1).Should().Be(TimeSpan.FromTicks((long)(mean.Ticks * 1.4)));
        NoiseRates.Gap(level, 0.5).Should().Be(mean);
        NoiseRates.Gap(level, -3).Should().Be(NoiseRates.Gap(level, 0), "a draw outside [0, 1] is clamped");
        NoiseRates.Gap(level, 7).Should().Be(NoiseRates.Gap(level, 1));
    }

    [Theory]
    [InlineData(NoiseRates.Low, 2)]
    [InlineData(NoiseRates.Medium, 6)]
    [InlineData(NoiseRates.High, 15)]
    public void OverASimulatedHour_TheRateHoldsAndEveryGapIsWithinTheJitterBounds(string level, int perMinute)
    {
        var scheduler = new NoiseScheduler(new SeededJitter(seed: 501));
        var exercise = Guid.NewGuid();
        var posts = Simulate(scheduler, exercise, level, TimeSpan.FromHours(1));

        var mean = NoiseRates.MeanGap(level)!.Value.TotalSeconds;
        var gaps = posts.Zip(posts.Skip(1), (a, b) => (b - a).TotalSeconds).ToList();
        gaps.Should().OnlyContain(
            gap => gap >= (mean * 0.6) - 1 && gap <= (mean * 1.4) + 1,
            "each gap is the mean ±40 %, give or take the 1 s tick");

        posts.Count.Should().BeInRange(
            (int)(perMinute * 60 * 0.9),
            (int)(perMinute * 60 * 1.1),
            "over an hour the jitter averages out to the level's rate (the tick never erodes it)");
    }

    [Theory]
    [InlineData(NoiseRates.Low)]
    [InlineData(NoiseRates.Medium)]
    [InlineData(NoiseRates.High)]
    public void EvenAtTheShortestJitter_TheRateNeverExceedsItsBoundAndHighStaysFarBelowTheBurstBar(string level)
    {
        var scheduler = new NoiseScheduler(new FixedJitter(0));
        var posts = Simulate(scheduler, Guid.NewGuid(), level, TimeSpan.FromMinutes(10));

        var bound = NoiseRates.PerMinute(level) / 0.6 * 10;
        posts.Count.Should().BeLessThanOrEqualTo((int)Math.Ceiling(bound), "every gap is at least 60 % of the mean");
        (posts.Count / 10.0).Should().BeLessThan(120.0 / 4, "NFR-002: noise stays far below the 120/min burst bar");
    }

    [Fact]
    public void Off_NeverPosts()
    {
        var scheduler = new NoiseScheduler(new FixedJitter(0));
        Simulate(scheduler, Guid.NewGuid(), NoiseRates.Off, TimeSpan.FromMinutes(10)).Should().BeEmpty();
    }

    [Fact]
    public void AFirstSighting_IsOneGapOut_SoARestartNeverBursts()
    {
        // A restart is a fresh scheduler meeting an exercise whose persisted level is High.
        var scheduler = new NoiseScheduler(new FixedJitter(0.5));
        var exercise = Guid.NewGuid();

        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, Start).Should().BeFalse("the first sight only starts the timetable");
        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, Start.AddSeconds(3.9)).Should().BeFalse();
        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, Start.AddSeconds(4)).Should().BeTrue("one mean gap (4 s) later");
    }

    [Fact]
    public void AStop_DropsTheTimetable_AndTheFirstPostAfterItIsOneGapOut()
    {
        var scheduler = new NoiseScheduler(new FixedJitter(0.5));
        var exercise = Guid.NewGuid();
        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, Start);

        // Frozen for ten minutes: nothing is due, and nothing banks up.
        for (var second = 1; second <= 600; second++)
        {
            scheduler.IsDue(exercise, NoiseRates.High, stopped: true, Start.AddSeconds(second)).Should().BeFalse();
        }

        scheduler.DueAt(exercise).Should().BeNull("a stop drops the timetable");

        var resumed = Start.AddSeconds(601);
        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, resumed).Should().BeFalse("no catch-up after the stop clears");
        scheduler.DueAt(exercise).Should().Be(resumed.AddSeconds(4));
    }

    [Fact]
    public void ALevelChange_RestartsTheTimetableAtTheNewRate()
    {
        var scheduler = new NoiseScheduler(new FixedJitter(0.5));
        var exercise = Guid.NewGuid();
        scheduler.IsDue(exercise, NoiseRates.Low, stopped: false, Start);
        scheduler.DueAt(exercise).Should().Be(Start.AddSeconds(30));

        scheduler.IsDue(exercise, NoiseRates.High, stopped: false, Start.AddSeconds(5)).Should().BeFalse();
        scheduler.DueAt(exercise).Should().Be(Start.AddSeconds(9), "High's 4 s gap from the moment the level changed");
    }

    [Fact]
    public void NextDue_IsMeasuredFromThePreviousDue_ButNeverCatchesUp()
    {
        var gap = TimeSpan.FromSeconds(4);

        NoiseRates.NextDue(Start, Start.AddSeconds(0.7), gap).Should().Be(Start.AddSeconds(4), "tick lateness does not erode the rate");
        NoiseRates.NextDue(Start, Start.AddSeconds(30), gap).Should().Be(Start.AddSeconds(34), "a pacer that fell behind does not burst");
    }

    [Fact]
    public void TwoExercises_KeepIndependentTimetables()
    {
        var scheduler = new NoiseScheduler(new FixedJitter(0.5));
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        scheduler.IsDue(a, NoiseRates.High, stopped: false, Start);
        scheduler.IsDue(b, NoiseRates.Low, stopped: false, Start);

        scheduler.IsDue(a, NoiseRates.High, stopped: true, Start.AddSeconds(1));

        scheduler.DueAt(a).Should().BeNull("A was stopped");
        scheduler.DueAt(b).Should().Be(Start.AddSeconds(30), "stopping A never touches B (COR-001)");

        scheduler.Retain([b]);
        scheduler.Scheduled.Should().Equal(b);
    }

    [Fact]
    public void Selection_IsLeastPostedThenPoolOrder_AvoidingTheLastPersona()
    {
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();
        var first = new NoiseCandidate(Guid.NewGuid(), alice);
        var second = new NoiseCandidate(Guid.NewGuid(), alice);
        var third = new NoiseCandidate(Guid.NewGuid(), bob);
        var ordered = new[] { first, second, third };

        NoiseSelection.Pick(ordered, lastPersonaId: null).Should().Be(first, "least posted, then pool order");
        NoiseSelection.Pick(ordered, lastPersonaId: bob).Should().Be(first);
        NoiseSelection.Pick(ordered, lastPersonaId: alice).Should().Be(third, "never the same persona twice in a row when another is available");
    }

    [Fact]
    public void Selection_RepeatsThePersona_OnlyWhenNoOtherIsAvailable()
    {
        var alice = Guid.NewGuid();
        var ordered = new[] { new NoiseCandidate(Guid.NewGuid(), alice), new NoiseCandidate(Guid.NewGuid(), alice) };

        NoiseSelection.Pick(ordered, alice).Should().Be(ordered[0]);
    }

    [Fact]
    public void TheThrottle_AllowsOnePushPerTwoSecondsPerExercise()
    {
        var throttle = new NoiseStateThrottle();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        throttle.TryAcquire(a, Start).Should().BeTrue();
        throttle.TryAcquire(a, Start.AddSeconds(1.9)).Should().BeFalse();
        throttle.TryAcquire(b, Start.AddSeconds(1.9)).Should().BeTrue("the throttle is per exercise");
        throttle.TryAcquire(a, Start.AddSeconds(2)).Should().BeTrue();
    }

    [Fact]
    public void NoiseStateDto_MatchesTheFrozenWireShape()
    {
        var before = JsonSerializer.Serialize(new NoiseStateDto
        {
            Level = NoiseRates.Low,
            RatePerMinute = 2,
            PoolSize = 40,
            PostedCount = 0,
            Running = true,
        });
        using (var document = JsonDocument.Parse(before))
        {
            document.RootElement.EnumerateObject().Select(property => property.Name).Should().Equal(
                "level", "ratePerMinute", "poolSize", "postedCount", "running");
        }

        var after = JsonSerializer.Serialize(new NoiseStateDto
        {
            Level = NoiseRates.High,
            RatePerMinute = 15,
            PoolSize = 40,
            PostedCount = 3,
            LastPostedAt = "2026-10-20T09:00:00.0000000-05:00",
            Running = false,
        });
        using (var document = JsonDocument.Parse(after))
        {
            document.RootElement.GetProperty("lastPostedAt").GetString().Should().Be("2026-10-20T09:00:00.0000000-05:00");
        }
    }

    [Fact]
    public void BackoffDelay_DoublesToTheCap()
    {
        var options = new WhiteNoisePacerOptions();

        WhiteNoisePacer.BackoffDelay(1, options).Should().Be(TimeSpan.FromSeconds(1));
        WhiteNoisePacer.BackoffDelay(3, options).Should().Be(TimeSpan.FromSeconds(4));
        WhiteNoisePacer.BackoffDelay(40, options).Should().Be(TimeSpan.FromSeconds(60));
    }

    /// <summary>Ticks once a second for <paramref name="window"/>, publishing whenever a post is due.</summary>
    private static List<DateTimeOffset> Simulate(NoiseScheduler scheduler, Guid exercise, string level, TimeSpan window)
    {
        var posts = new List<DateTimeOffset>();
        for (var second = 0; second <= window.TotalSeconds; second++)
        {
            var now = Start.AddSeconds(second);
            if (scheduler.IsDue(exercise, level, stopped: false, now))
            {
                posts.Add(now);
                scheduler.Advance(exercise, now);
            }
        }

        return posts;
    }
}

/// <summary>A jitter source that always draws the same value.</summary>
internal sealed class FixedJitter : INoiseJitterSource
{
    private readonly double _value;

    public FixedJitter(double value) => _value = value;

    public double NextUnit() => _value;
}

/// <summary>A deterministic pseudo-random jitter source (tests only).</summary>
internal sealed class SeededJitter : INoiseJitterSource
{
#pragma warning disable CA5394 // Deterministic test jitter, not security.
    private readonly Random _random;

    public SeededJitter(int seed) => _random = new Random(seed);

    public double NextUnit() => _random.NextDouble();
#pragma warning restore CA5394
}
