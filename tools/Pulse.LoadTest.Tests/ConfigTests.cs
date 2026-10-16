namespace Pulse.LoadTest.Tests;

using FluentAssertions;

public class ConfigTests
{
    private const string Demo = "7e1c2f00-1111-4222-8333-444455556666";

    private static LoadTestConfig Valid(params string[] extra) =>
        LoadTestConfig.Load(["--api-host", "loadtest-api.example.com", "--join-urls", "links.csv", "--demo-exercise-id", Demo, .. extra]);

    [Fact]
    public void Defaults_MatchTheDecisions()
    {
        var config = Valid();
        config.Validate().Should().BeEmpty();
        config.Steps.Should().Equal(20, 40, 100);
        config.StepMinutes.Should().Be(10);
        config.JoinsPerMinute.Should().Be(25);
        config.Activity.FeedReadSeconds.Should().Be(30);
        config.Activity.ReactionMeanSeconds.Should().Be(60);
        config.Activity.PostMeanSeconds.Should().Be(300);
        config.Burst.PostsPerMinute.Should().Be(120);
        config.Burst.DurationMinutes.Should().Be(2);
        config.StopRules.MaxErrorRate.Should().Be(0.05);
        config.StopRules.MaxPostP95Ms.Should().Be(5000);
        config.StopRules.SustainSeconds.Should().Be(60);
    }

    [Fact]
    public void Json_IsReadWithCommentsAndCamelCase_AndArgumentsOverrideIt()
    {
        const string json = """
            {
              // comment
              "apiHost": "from-json.example.com",
              "joinUrlFile": "a.csv",
              "demoExerciseId": "7e1c2f00-1111-4222-8333-444455556666",
              "steps": [5, 10],
              "stepMinutes": 3,
              "activity": { "feedReadSeconds": 15, "replyShare": 0.5 },
              "burst": { "postsPerMinute": 60, "pacedStartMinute": 1, "durationMinutes": 1 },
            }
            """;

        var config = LoadTestConfig.Load(["--config", "x.json", "--steps", "7,9", "--api-host", "override.example.com"], _ => json);

        config.ApiHost.Should().Be("override.example.com");
        config.JoinUrlFile.Should().Be("a.csv");
        config.Steps.Should().Equal(7, 9);
        config.StepMinutes.Should().Be(3);
        config.Activity.FeedReadSeconds.Should().Be(15);
        config.Activity.ReplyShare.Should().Be(0.5);
        config.Activity.PostMeanSeconds.Should().Be(300); // untouched default
        config.Burst.PostsPerMinute.Should().Be(60);
        config.Validate().Should().BeEmpty();
    }

    [Theory]
    [InlineData("--bogus")]
    [InlineData("--steps")]
    [InlineData("--steps", "20,abc")]
    [InlineData("--step-minutes", "ten")]
    public void BadArguments_Throw(params string[] args)
    {
        var act = () => LoadTestConfig.Load(args);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void MissingRequiredValues_AreAllReported()
    {
        var problems = LoadTestConfig.Load([]).Validate();
        problems.Should().Contain(p => p.StartsWith("apiHost", StringComparison.Ordinal));
        problems.Should().Contain(p => p.StartsWith("joinUrlFile", StringComparison.Ordinal));
        problems.Should().Contain(p => p.StartsWith("demoExerciseId", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("26")]
    [InlineData("30")]
    [InlineData("0")]
    public void AJoinPaceAboveTwentyFive_IsRefused(string pace) =>
        Valid("--joins-per-minute", pace).Validate().Should().Contain(p => p.StartsWith("joinsPerMinute", StringComparison.Ordinal));

    [Fact]
    public void DecreasingSteps_AreRefused() =>
        Valid("--steps", "40,20").Validate().Should().Contain(p => p.Contains("must not decrease", StringComparison.Ordinal));

    [Fact]
    public void ABurstThatDoesNotFitTheStep_IsRefused() =>
        Valid("--step-minutes", "2").Validate().Should().Contain(p => p.StartsWith("burst.pacedStartMinute", StringComparison.Ordinal));

    [Theory]
    [InlineData("loadtest-api.example.com", "https://loadtest-api.example.com/")]
    [InlineData("https://LoadTest-API.example.com/", "https://loadtest-api.example.com/")]
    public void ApiHost_IsNormalizedToAnOrigin(string raw, string expected)
    {
        LoadTestConfig.TryNormalizeApiHost(raw, out var origin, out _).Should().BeTrue();
        origin.ToString().Should().Be(expected);
    }

    [Theory]
    [InlineData("http://loadtest-api.example.com")]
    [InlineData("http://localhost:5000")]
    [InlineData("loadtest-api.example.com:8443")]
    [InlineData("https://loadtest-api.example.com:443")]
    [InlineData("10.1.2.3")]
    [InlineData("https://[::1]")]
    [InlineData("https://loadtest-api.example.com/api")]
    [InlineData("https://user:pw@loadtest-api.example.com")]
    [InlineData("ftp://loadtest-api.example.com")]
    public void ApiHost_PlainHttpAPortAnIpOrAPath_IsRefused(string raw) =>
        LoadTestConfig.TryNormalizeApiHost(raw, out _, out _).Should().BeFalse();
}

public class FanOutTrackerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    internal static Dictionary<int, DateTimeOffset?> Clients(params int[] ids) => ids.ToDictionary(id => id, _ => (DateTimeOffset?)T0.AddMinutes(-5));

    [Fact]
    public void Lag_IsMeasuredFromAccept_ToEveryOtherClient()
    {
        var tracker = new FanOutTracker(new FanOutSettings());
        tracker.Register(0, "p1", T0, T0.AddMilliseconds(100), Clients(2, 3, 4));
        tracker.OnFrame(2, "p1", T0.AddMilliseconds(150));
        tracker.OnFrame(3, "p1", T0.AddMilliseconds(300));
        tracker.OnFrame(4, "p1", T0.AddMilliseconds(3100)); // late (> 2 s)
        tracker.OnFrame(1, "p1", T0.AddMilliseconds(120));  // the sender: ignored
        tracker.Sweep(T0.AddMinutes(1));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(3);
        summary.FramesLate.Should().Be(1);
        summary.FramesDropped.Should().Be(0);
        summary.LagMaxMs.Should().Be(3000);
        summary.LagP50Ms.Should().Be(200);
        summary.EndToEndMaxMs.Should().Be(3100);
    }

    [Fact]
    public void AFrameBeforeThe201_CountsAsZeroLag()
    {
        var tracker = new FanOutTracker(new FanOutSettings());
        tracker.OnFrame(2, "p1", T0.AddMilliseconds(40));
        tracker.Register(0, "p1", T0, T0.AddMilliseconds(90), Clients(2));
        tracker.Sweep(T0.AddMinutes(1));

        var summary = tracker.Summary(0);
        summary.FramesDelivered.Should().Be(1);
        summary.FramesBeforeAccept.Should().Be(1);
        summary.LagMaxMs.Should().Be(0);
        summary.EndToEndMaxMs.Should().Be(40);
    }

    [Fact]
    public void MissingFrames_AfterTheHorizon_AreDropped()
    {
        var tracker = new FanOutTracker(new FanOutSettings { DroppedAfterSeconds = 30 });
        tracker.Register(1, "p1", T0, T0, Clients(2, 3));
        tracker.OnFrame(2, "p1", T0.AddMilliseconds(50));

        tracker.Sweep(T0.AddSeconds(10));
        tracker.Summary(1).FramesDropped.Should().Be(0, "still inside the horizon");

        tracker.Sweep(T0.AddSeconds(31));
        var summary = tracker.Summary(1);
        summary.FramesDropped.Should().Be(1);
        summary.DropRate.Should().Be(0.5);
    }

    [Fact]
    public void FramesForPostsTheHarnessDidNotWrite_AreUntracked()
    {
        var tracker = new FanOutTracker(new FanOutSettings());
        tracker.OnFrame(2, "noise-1", T0);
        tracker.OnFrame(3, "noise-1", T0);
        tracker.Sweep(T0.AddMinutes(1));
        tracker.UntrackedFrames.Should().Be(2);
    }
}

public class ResultWriterTests
{
    [Fact]
    public void StepsCsv_HasOneRowPerSeries_PlusFanOut()
    {
        var series = new Dictionary<string, SeriesSummary>
        {
            ["post"] = new("post", 10, 1, 0.1, 100, 200, 300, 400),
        };
        var fan = new FanOutSummary(5, 1, 0, 0, 0, 0, 10, 20, 30, 40, 50, 60);
        var step = new StepSummary(1, 20, 20, 20, null, null, null, "error rate \"x\"", true, true, 240, series, fan, 2, 0, 0, []);
        var summary = new RunSummary("https://h/", "id", "Load test", DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch, false, "s", false, 0,
            new ConfigEcho([20], 10, 25, new(), new(), new(), new()), [step]);

        var lines = ResultWriter.StepsCsv(summary).Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);

        lines.Should().HaveCount(4);
        lines[1].Should().Be("1,20,\"post\",10,1,0.1,100,200,300,400,\"error rate \"\"x\"\"\"");
        lines[2].Should().StartWith("1,20,\"fan-out-lag\",5,0,0,10,20,,30,");
    }
}
