namespace Pulse.LoadTest.Tests;

using System.Net;
using FluentAssertions;

/// <summary>Regression tests for the Copilot review of PR #557 (findings 1–7).</summary>
public class FanOutRaceTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Finding1_EarlyFrame_Register_ThenLateFrame_NoDrop()
    {
        // The interleaving that used to lose a frame: one frame before the 201, the registration drains the buffer, and a
        // second frame lands right after. Every frame must be delivered; nothing may be settled as a drop.
        var tracker = new FanOutTracker(new FanOutSettings());
        tracker.OnFrame(2, "p1", T0.AddMilliseconds(10));
        tracker.Register(0, "p1", T0, T0.AddMilliseconds(20), FanOutTrackerTests.Clients(2, 3));
        tracker.OnFrame(3, "p1", T0.AddMilliseconds(21));
        tracker.Sweep(T0.AddMinutes(1));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(2);
        summary.FramesDropped.Should().Be(0);
        tracker.UntrackedFrames.Should().Be(0);
        tracker.Drops.Should().BeEmpty();
    }

    [Fact]
    public void Finding1_ConcurrentFramesAndRegistrations_NeverLoseAFrame()
    {
        // Hammers the race: for every post, all receivers deliver on other threads while the post is being registered
        // (before, during and after). Under the old buffer-then-drain design some frames ended in a drained bucket and
        // were counted as drops.
        const int posts = 200;
        const int receivers = 8;
        var tracker = new FanOutTracker(new FanOutSettings());
        var expected = FanOutTrackerTests.Clients(Enumerable.Range(1, receivers).ToArray());

        // Dedicated threads (not pool tasks) released together by a barrier, so the race is real and nothing starves.
        for (var i = 0; i < posts; i++)
        {
            var id = $"post-{i}";
            using var start = new Barrier(receivers + 1);
            var threads = Enumerable.Range(1, receivers).Select(client => new Thread(() =>
            {
                start.SignalAndWait();
                tracker.OnFrame(client, id, T0.AddMilliseconds(5));
            })).ToArray();
            foreach (var thread in threads)
            {
                thread.Start();
            }

            start.SignalAndWait();
            tracker.Register(0, id, T0, T0.AddMilliseconds(5), expected);
            foreach (var thread in threads)
            {
                thread.Join();
            }
        }

        tracker.Sweep(T0.AddMinutes(1));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(posts * receivers);
        summary.FramesDropped.Should().Be(0);
        tracker.UntrackedFrames.Should().Be(0);
    }

    [Fact]
    public void Finding4_Finish_ReportsYoungPendingFramesAsUnfinished_NotDropped()
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(0, "old", T0, T0, FanOutTrackerTests.Clients(2));            // past the horizon at the end: dropped
        tracker.Register(0, "young", T0.AddSeconds(50), T0.AddSeconds(50), FanOutTrackerTests.Clients(2, 3)); // 10 s old
        tracker.OnFrame(2, "young", T0.AddSeconds(50.1));

        tracker.Finish(T0.AddSeconds(60));

        var summary = tracker.Summary(0);
        summary.FramesDropped.Should().Be(1);
        summary.FramesUnfinished.Should().Be(1);
        summary.DropRate.Should().Be(0.5); // 1 dropped of 1 delivered + 1 dropped; unfinished is not in the rate
        tracker.Drops.Select(d => d.PostId).Should().Equal("old");
        tracker.PendingPosts.Should().Be(0);
    }

    [Fact]
    public void PendingPosts_CountsOnlyPostsStillWaiting()
    {
        var tracker = new FanOutTracker(new FanOutSettings());
        tracker.Register(0, "a", T0, T0, FanOutTrackerTests.Clients(2));
        tracker.Register(0, "b", T0, T0, FanOutTrackerTests.Clients(2));
        tracker.PendingPosts.Should().Be(2);
        tracker.OnFrame(2, "a", T0);
        tracker.PendingPosts.Should().Be(1);
    }

    [Fact]
    public void Finding6_TheDropRecordKeepsTheConnectionTimeAtSend()
    {
        var tracker = new FanOutTracker(new FanOutSettings());
        var connectedAtSend = T0.AddSeconds(-0.4);
        tracker.Register(0, "p1", T0, T0, new Dictionary<int, DateTimeOffset?> { [7] = connectedAtSend });
        tracker.Sweep(T0.AddMinutes(1));

        var drop = tracker.Drops.Should().ContainSingle().Subject;
        drop.MissingClients.Should().Equal(new MissingFrame(7, connectedAtSend));

        // A reconnect of client 7 after the post (which the runner would see as a newer ConnectedAt) changes nothing:
        // the row is computed from the snapshot, so secondsAfterConnect is positive, 0.400, a join-window artefact.
        var csv = LoadTestRunner.FormatDrops(tracker.Drops).Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        csv[0].Should().Be("step,postId,acceptedAt,clientId,clientConnectedAtSend,secondsAfterConnect");
        csv[1].Should().EndWith(",7," + connectedAtSend.ToString("O", System.Globalization.CultureInfo.InvariantCulture) + ",0.400");
    }
}

public class CompletionWindowTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Finding2_TimeoutsCountWhenTheyFinish_AndTripTheRule()
    {
        // From minute 1 every request times out after 30 s. Each sample is supplied only once it has finished (as the
        // harness logs them), with its START time. Filtering by start time, a 15 s window never held one of them.
        var evaluator = new StopRuleEvaluator(new StopRuleSettings());
        var logged = new List<RequestSample>();
        var issued = new List<RequestSample>();
        for (var at = T0; at < T0.AddMinutes(5); at += TimeSpan.FromSeconds(0.25))
        {
            var timeout = at >= T0.AddMinutes(1);
            issued.Add(new RequestSample(at, 0, Metrics.Feed, timeout ? 30_000 : 50, timeout ? 0 : 200, !timeout));
        }

        string? reason = null;
        var trippedAt = DateTimeOffset.MinValue;
        for (var now = T0; now <= T0.AddMinutes(5) && reason is null; now += TimeSpan.FromSeconds(5))
        {
            logged.AddRange(issued.Where(s => s.CompletedAt <= now && !logged.Contains(s)));
            reason = evaluator.Evaluate(now, logged);
            trippedAt = now;
        }

        reason.Should().StartWith("error rate");
        // Timeouts begin finishing at minute 1.5; 60 s of breach later the rule trips.
        trippedAt.Should().BeOnOrAfter(T0.AddMinutes(2.5)).And.BeOnOrBefore(T0.AddMinutes(2.5).AddSeconds(15));
    }

    [Fact]
    public void Finding2_ASlowRequestIsJudgedInTheWindowItFinishesIn()
    {
        var sample = new RequestSample(T0, 0, Metrics.Post, 20_000, 201, true);
        sample.CompletedAt.Should().Be(T0.AddSeconds(20));
        var evaluator = new StopRuleEvaluator(new StopRuleSettings { MinSamples = 1 });
        evaluator.Evaluate(T0.AddSeconds(10), [sample]).Should().BeNull();
        evaluator.LastPostP95Ms.Should().BeNull("it has not finished at 10 s");
        evaluator.Evaluate(T0.AddSeconds(21), [sample]);
        evaluator.LastPostP95Ms.Should().Be(20_000);
    }
}

public class RunnerReviewTests
{
    [Theory]
    [InlineData(20, 20, null)]
    [InlineData(25, 20, null)]
    [InlineData(17, 20, "undersized population: 17 of 20 users joined")]
    [InlineData(0, 100, "undersized population: 0 of 100 users joined")]
    public void Finding3_AnUndersizedRamp_IsAStopReason(int joined, int wanted, string? reasonStart)
    {
        var reason = LoadTestRunner.UndersizedReason(joined, wanted);
        if (reasonStart is null)
        {
            reason.Should().BeNull();
        }
        else
        {
            reason.Should().StartWith(reasonStart).And.Contain("not run");
        }
    }

    [Fact]
    public async Task Finding4_DrainWaitsForPendingFrames_UpToTheLimit()
    {
        var delays = new List<TimeSpan>();
        Task Delay(TimeSpan span, CancellationToken _)
        {
            delays.Add(span);
            return Task.CompletedTask;
        }

        // Drains to zero after three polls.
        var pending = 3;
        (await LoadTestRunner.DrainAsync(() => pending--, TimeSpan.FromSeconds(30), TimeSpan.FromMilliseconds(250), CancellationToken.None, Delay))
            .Should().Be(0);
        delays.Should().HaveCount(3);

        // Never drains: stops at the limit (5 s after Ctrl+C) and reports what is left.
        delays.Clear();
        (await LoadTestRunner.DrainAsync(() => 4, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(250), CancellationToken.None, Delay))
            .Should().Be(4);
        delays.Should().HaveCount(20);

        // Nothing pending: no wait at all.
        delays.Clear();
        (await LoadTestRunner.DrainAsync(() => 0, TimeSpan.FromSeconds(30), TimeSpan.FromMilliseconds(250), CancellationToken.None, Delay))
            .Should().Be(0);
        delays.Should().BeEmpty();
    }

    [Fact]
    public async Task Finding7_ARequestCountsInTheStepItStartedIn()
    {
        var clock = new RunClock { Step = 0 };
        var log = new SampleLog();
        using var handler = new StepChangingHandler(clock);
        using var api = new PulseApi(new Uri("https://loadtest.example.test/"), TimeSpan.FromSeconds(5), log, clock, handler);
        var session = new PulseSession { Token = "t", ExerciseId = Guid.NewGuid().ToString() };

        await api.GetFeedAsync(session, CancellationToken.None); // step changes to 1 while the request is in flight

        clock.Step.Should().Be(1);
        log.Snapshot().Should().ContainSingle().Which.Step.Should().Be(0);
    }

    private sealed class StepChangingHandler(RunClock clock) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            clock.Step = 1;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[]") });
        }
    }
}

/// <summary>Regression tests for the second Copilot pass on PR #557.</summary>
public class SecondPassTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    // Deadline = accept (T0) + 30 s. One frame just before it, one just after; each processed either before any sweep,
    // or after a sweep that has already settled the post. The verdict must not depend on that order.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Finding2_AFrameBeforeTheDeadline_IsDelivered_WhateverTheSweepTiming(bool sweptFirst)
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(0, "p1", T0, T0, FanOutTrackerTests.Clients(2));
        if (sweptFirst)
        {
            tracker.Sweep(T0.AddSeconds(31)); // settles the post before the frame is processed
        }

        tracker.OnFrame(2, "p1", T0.AddSeconds(29.9));
        tracker.Sweep(T0.AddSeconds(45));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(1);
        summary.FramesLate.Should().Be(1);
        summary.FramesDropped.Should().Be(0);
        tracker.Drops.Should().BeEmpty();
        tracker.UntrackedFrames.Should().Be(0);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Finding2_AFrameAfterTheDeadline_IsDropped_WhateverTheSweepTiming(bool sweptFirst)
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(0, "p1", T0, T0, FanOutTrackerTests.Clients(2));
        if (sweptFirst)
        {
            tracker.Sweep(T0.AddSeconds(31));
        }

        tracker.OnFrame(2, "p1", T0.AddSeconds(30.1));
        tracker.Sweep(T0.AddSeconds(45));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(0);
        summary.FramesDropped.Should().Be(1);
        tracker.Drops.Should().ContainSingle().Which.MissingClients.Should().Equal(new MissingFrame(2, T0.AddMinutes(-5)));
        tracker.UntrackedFrames.Should().Be(0, "a frame for a known post is never 'untracked'");
    }

    [Fact]
    public void Finding2_AFrameExactlyAtTheDeadline_IsDelivered()
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(0, "p1", T0, T0, FanOutTrackerTests.Clients(2));
        tracker.OnFrame(2, "p1", T0.AddSeconds(30));
        tracker.Sweep(T0.AddSeconds(60));
        tracker.Summary(0).FramesDropped.Should().Be(0);
    }

    [Fact]
    public void Finding2_FinishAfterTheDeadline_DropsTheLateFrame()
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(0, "p1", T0, T0, FanOutTrackerTests.Clients(2, 3));
        tracker.OnFrame(2, "p1", T0.AddSeconds(1));
        tracker.OnFrame(3, "p1", T0.AddSeconds(31)); // after the deadline, no sweep yet
        tracker.Finish(T0.AddSeconds(32));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(1);
        summary.FramesDropped.Should().Be(1);
        summary.FramesUnfinished.Should().Be(0);
    }

    [Fact]
    public void Finding4_TwoSeparatedSpikesWithQuietTrafficBetween_DoNotStop()
    {
        // Low background traffic (1 request every 2 s: under 10 per 15 s window), with two 5 s spikes of failing
        // requests 50 s apart. Before the fix, the quiet windows left the breach clock running, so the second spike
        // looked like "60 s sustained".
        var samples = new List<RequestSample>();
        void Add(DateTimeOffset from, DateTimeOffset to, double perSecond, bool ok)
        {
            for (var at = from; at < to; at += TimeSpan.FromSeconds(1 / perSecond))
            {
                samples.Add(new RequestSample(at, 0, Metrics.Feed, 50, ok ? 200 : 503, ok));
            }
        }

        Add(T0, T0.AddMinutes(4), 0.5, true);                                   // quiet background
        Add(T0.AddSeconds(60), T0.AddSeconds(65), 8, false);                    // spike 1
        Add(T0.AddSeconds(115), T0.AddSeconds(120), 8, false);                  // spike 2, 55 s later

        var evaluator = new StopRuleEvaluator(new StopRuleSettings());
        for (var now = T0; now <= T0.AddMinutes(4); now += TimeSpan.FromSeconds(5))
        {
            evaluator.Evaluate(now, samples).Should().BeNull($"no sustained breach at {now:HH:mm:ss}");
        }
    }

    [Fact]
    public void Finding4_TheP95ClockAlsoRestarts_WhenPostsThinOut()
    {
        var samples = new List<RequestSample>();
        void Posts(DateTimeOffset from, DateTimeOffset to, double perSecond, double latency)
        {
            for (var at = from; at < to; at += TimeSpan.FromSeconds(1 / perSecond))
            {
                samples.Add(new RequestSample(at, 0, Metrics.ControllerPost, latency, 201, true));
            }
        }

        Posts(T0, T0.AddSeconds(40), 2, 7000);                 // 40 s slow
        Posts(T0.AddSeconds(40), T0.AddSeconds(80), 0.2, 7000); // too few POSTs to judge
        Posts(T0.AddSeconds(80), T0.AddSeconds(110), 2, 7000);  // 30 s slow again

        var evaluator = new StopRuleEvaluator(new StopRuleSettings());
        for (var now = T0; now <= T0.AddSeconds(150); now += TimeSpan.FromSeconds(5))
        {
            evaluator.Evaluate(now, samples).Should().BeNull();
        }
    }
}
