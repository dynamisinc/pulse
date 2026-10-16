namespace Pulse.LoadTest.Tests;

using FluentAssertions;

public class TargetGuardTests
{
    private const string Demo = "7e1c2f00-1111-4222-8333-444455556666";
    private const string LoadTest = "0b5e0b5e-2222-4333-8444-555566667777";

    [Fact]
    public void LoadTestExercise_NotTheDemo_IsAllowed() =>
        TargetGuard.Check(LoadTest, "Load test 2026-10-17 0830", Demo).Should().BeNull();

    [Fact]
    public void TheDemoExercise_IsRefused_EvenWhenNamedLoadTest() =>
        TargetGuard.Check(Demo, "Load test (renamed demo)", Demo).Should().Contain("IS the demo exercise");

    [Fact]
    public void TheDemoExercise_IsRefused_WhateverTheCaseOfTheId() =>
        TargetGuard.Check(Demo.ToUpperInvariant(), "Load test", Demo).Should().Contain("IS the demo exercise");

    [Theory]
    [InlineData("Kestrel County Flood Demo")]
    [InlineData("load test lowercase")]
    [InlineData("My Load test")]
    [InlineData("")]
    [InlineData(null)]
    public void ANameNotStartingWithLoadTest_IsRefused(string? name) =>
        TargetGuard.Check(LoadTest, name, Demo).Should().Contain("is not named 'Load test");

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void NoDemoIdConfigured_IsRefused(string? demo) =>
        TargetGuard.Check(LoadTest, "Load test", demo).Should().Contain("no demo exercise id");

    [Theory]
    [InlineData(null)]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void AHostThatResolvesToNoExercise_IsRefused(string? target) =>
        TargetGuard.Check(target, "Load test", Demo).Should().Contain("did not resolve");

    [Fact]
    public void ASessionForAnotherExercise_IsRefused()
    {
        var target = Guid.Parse(LoadTest);
        TargetGuard.CheckSession(LoadTest, target).Should().BeNull();
        TargetGuard.CheckSession(Demo, target).Should().NotBeNull();
        TargetGuard.CheckSession(null, target).Should().NotBeNull();
    }

    [Fact]
    public void Printable_DropsControlAndBidiCharacters() =>
        TargetGuard.Printable("Load\u001b[31m test‮").Should().Be("Load[31m test");
}

public class JoinPacerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 17, 9, 0, 0, TimeSpan.Zero);

    /// <summary>Simulates joins that each take <paramref name="joinSeconds"/>; returns every start time.</summary>
    private static List<DateTimeOffset> Simulate(int perMinute, int joins, double joinSeconds = 0.3)
    {
        var pacer = new JoinPacer(perMinute);
        var now = T0;
        var starts = new List<DateTimeOffset>();
        for (var i = 0; i < joins; i++)
        {
            now += pacer.DelayUntilNext(now);
            pacer.Record(now);
            starts.Add(now);
            now += TimeSpan.FromSeconds(joinSeconds);
        }

        return starts;
    }

    [Theory]
    [InlineData(25, 100)]
    [InlineData(10, 40)]
    [InlineData(1, 5)]
    public void NeverMoreThanPerMinuteInAnySixtySeconds(int perMinute, int joins)
    {
        var starts = Simulate(perMinute, joins);
        foreach (var start in starts)
        {
            starts.Count(s => s >= start && s < start + TimeSpan.FromMinutes(1)).Should().BeLessThanOrEqualTo(perMinute);
        }
    }

    [Fact]
    public void JoinsAreEvenlySpaced_SoAFixedWindowServerLimiterSeesNoEdgeBurst()
    {
        var starts = Simulate(25, 30);
        starts.Zip(starts.Skip(1)).Select(p => (p.Second - p.First).TotalSeconds)
            .Should().OnlyContain(gap => gap >= 2.4 - 1e-9);
    }

    [Fact]
    public void OneHundredUsers_TakeAboutFourMinutes()
    {
        var starts = Simulate(25, 100);
        (starts[^1] - starts[0]).TotalMinutes.Should().BeApproximately(99 * 2.4 / 60, 0.05);
    }

    [Fact]
    public void SlowJoins_NeverWaitLonger_ThanTheSpacing()
    {
        var pacer = new JoinPacer(25);
        pacer.Record(T0);
        pacer.DelayUntilNext(T0.AddSeconds(5)).Should().Be(TimeSpan.Zero);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(26)]
    [InlineData(30)]
    public void APaceAboveTwentyFive_IsRejected(int perMinute)
    {
        var act = () => new JoinPacer(perMinute);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}

public class JoinUrlFileTests
{
    private const string Header = "\"name\",\"signInName\",\"joinUrl\"\r\n";

    [Fact]
    public void Parse_ReadsImportRosterFormat_AndSkipsNpcRows()
    {
        var content = Header
            + "\"Load participant 001\",\"ltp001\",\"https://pulse-uat.cobrasoftware.com/join/AbC-123_x\"\r\n"
            + "\"Load NPC 01\",\"ltnpc01\",\"https://pulse-uat.cobrasoftware.com/join/npc-token\"\r\n"
            + "\"Load participant 002\",\"ltp002\",\"https://pulse-uat.cobrasoftware.com/join/tok%2B2\"\r\n";

        var entries = JoinUrlFile.Parse(content, "Load NPC");

        entries.Should().HaveCount(2);
        entries[0].Should().Be(new JoinEntry("Load participant 001", "ltp001", "AbC-123_x"));
        entries[1].Token.Should().Be("tok+2");
    }

    [Fact]
    public void Parse_SkipsRowsWithoutALink_AndDuplicateTokens()
    {
        var content = Header
            + "\"A\",\"a01\",\"\"\r\n"
            + "\"B\",\"b01\",\"https://x/join/t1\"\r\n"
            + "\"C\",\"c01\",\"https://x/join/t1\"\r\n";

        JoinUrlFile.Parse(content, "Load NPC").Select(e => e.Name).Should().Equal("B");
    }

    [Fact]
    public void Parse_UndoesTheFormulaSafePrefix_AndQuotedCommas()
    {
        var content = Header + "\"'=Smith, Jo\",\"jsmith\",\"https://x/join/t9\"\n";
        JoinUrlFile.Parse(content, "Load NPC")[0].Name.Should().Be("=Smith, Jo");
    }

    [Fact]
    public void Parse_KeepsAnApostropheThatWasNotAFormulaPrefix() =>
        JoinUrlFile.Unformula("'Brien").Should().Be("'Brien");

    [Theory]
    [InlineData("")]
    [InlineData("\"name\",\"other\"\r\n\"a\",\"b\"\r\n")]
    public void Parse_WrongShape_Throws(string content)
    {
        var act = () => JoinUrlFile.Parse(content, "Load NPC");
        act.Should().Throw<FormatException>();
    }

    [Fact]
    public void Parse_ALinkThatIsNotAJoinLink_Throws()
    {
        var act = () => JoinUrlFile.Parse(Header + "\"A\",\"a01\",\"https://x/login\"\r\n", "Load NPC");
        act.Should().Throw<FormatException>().WithMessage("*row 2*");
    }

    [Theory]
    [InlineData("https://site/join/abc", "abc")]
    [InlineData("https://site/base/join/abc/", "abc")]
    [InlineData("https://site/join/", null)]
    [InlineData("not a url", null)]
    public void TokenFrom_TakesTheSegmentAfterJoin(string url, string? token) =>
        JoinUrlFile.TokenFrom(url).Should().Be(token);
}
